import net from "node:net";

import { UploadPreflightError } from "@/lib/upload/preflight";

export type ContentSecurityStatus = "clean" | "infected" | "error" | "not_performed";

export interface ContentSecurityResult {
  status: ContentSecurityStatus;
  engine: "clamav" | "disabled";
  engine_version: string | null;
  signature_version: string | null;
  signature_name: string | null;
  scanned_at: string;
  duration_ms: number;
}

export interface ContentSecuritySettings {
  mode: "disabled" | "clamd";
  required: boolean;
  host: string;
  port: number;
  connectTimeoutMs: number;
  scanTimeoutMs: number;
  maxFileBytes: number;
}

const DEFAULT_CLAMD_ENDPOINT = "tcp://clamav:3310";
const DEFAULT_MAX_FILE_BYTES = 100 * 1024 * 1024;
const CLAMD_CHUNK_BYTES = 64 * 1024;
const MAX_CLAMD_RESPONSE_BYTES = 8 * 1024;

export function getContentSecuritySettings(
  env: Record<string, string | undefined> = process.env,
): ContentSecuritySettings {
  const mode = (env.STRATOS_CONTENT_SECURITY_MODE ?? "disabled").trim().toLowerCase();
  if (mode !== "disabled" && mode !== "clamd") {
    throw new UploadPreflightError(
      500,
      "CONTENT_SECURITY_MODE_INVALID",
      "STRATOS_CONTENT_SECURITY_MODE must be disabled or clamd.",
    );
  }
  const endpoint = parseClamdEndpoint(
    env.STRATOS_CONTENT_SECURITY_ENDPOINT?.trim() || DEFAULT_CLAMD_ENDPOINT,
  );
  return {
    mode,
    required: parseBoolean(env.STRATOS_CONTENT_SECURITY_REQUIRED, false),
    host: endpoint.host,
    port: endpoint.port,
    connectTimeoutMs: parsePositiveInteger(
      env.STRATOS_CONTENT_SECURITY_CONNECT_TIMEOUT_MS,
      3_000,
    ),
    scanTimeoutMs: parsePositiveInteger(
      env.STRATOS_CONTENT_SECURITY_SCAN_TIMEOUT_MS,
      120_000,
    ),
    maxFileBytes: parsePositiveInteger(
      env.STRATOS_CONTENT_SECURITY_MAX_FILE_BYTES,
      DEFAULT_MAX_FILE_BYTES,
    ),
  };
}

export function effectiveIntakeMaxFileBytes(
  configuredMaxFileBytes: number,
  settings: ContentSecuritySettings = getContentSecuritySettings(),
): number {
  return settings.required || settings.mode === "clamd"
    ? Math.min(configuredMaxFileBytes, settings.maxFileBytes)
    : configuredMaxFileBytes;
}

export async function inspectDocumentContent(
  content: Uint8Array,
  declaredMimeType: string,
  settings: ContentSecuritySettings = getContentSecuritySettings(),
): Promise<ContentSecurityResult> {
  if (content.byteLength > settings.maxFileBytes) {
    throw new UploadPreflightError(
      413,
      "CONTENT_SECURITY_FILE_TOO_LARGE",
      "The file exceeds the configured content-security scan limit.",
      {
        size_bytes: content.byteLength,
        max_file_bytes: settings.maxFileBytes,
      },
    );
  }
  assertContentMatchesDeclaredType(content, declaredMimeType);

  if (settings.mode === "disabled") {
    if (settings.required) {
      throw new UploadPreflightError(
        503,
        "CONTENT_SECURITY_UNAVAILABLE",
        "Document intake requires content security, but the scanner is disabled.",
      );
    }
    return {
      status: "not_performed",
      engine: "disabled",
      engine_version: null,
      signature_version: null,
      signature_name: null,
      scanned_at: new Date().toISOString(),
      duration_ms: 0,
    };
  }

  const startedAt = performance.now();
  const [versionResponse, scanResponse] = await Promise.all([
    clamdCommand("zVERSION\0", settings),
    clamdInstream(content, settings),
  ]);
  const version = parseClamdVersion(versionResponse);
  const verdict = parseClamdScanResponse(scanResponse);
  const result: ContentSecurityResult = {
    status: verdict.status,
    engine: "clamav",
    engine_version: version.engineVersion,
    signature_version: version.signatureVersion,
    signature_name: verdict.signatureName,
    scanned_at: new Date().toISOString(),
    duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
  };

  if (result.status === "infected") {
    throw new UploadPreflightError(
      422,
      "UPLOAD_MALWARE_DETECTED",
      "The uploaded document was blocked by the content-security policy.",
      { signature_name: result.signature_name },
    );
  }
  return result;
}

export async function contentSecurityReadiness(
  settings: ContentSecuritySettings = getContentSecuritySettings(),
): Promise<"ready" | "disabled" | "not_ready"> {
  if (settings.mode === "disabled") {
    return settings.required ? "not_ready" : "disabled";
  }
  try {
    parseClamdVersion(await clamdCommand("zVERSION\0", settings));
    return "ready";
  } catch {
    return "not_ready";
  }
}

export function assertContentMatchesDeclaredType(
  content: Uint8Array,
  declaredMimeType: string,
): void {
  const mimeType = declaredMimeType.trim().toLowerCase();
  const matches = contentMatchesMimeType(content, mimeType);
  if (!matches) {
    throw new UploadPreflightError(
      415,
      "UPLOAD_CONTENT_SIGNATURE_MISMATCH",
      "The file content does not match the declared document type.",
      { declared_mime_type: mimeType },
    );
  }
}

async function clamdCommand(
  command: string,
  settings: ContentSecuritySettings,
): Promise<string> {
  return exchangeWithClamd(settings, (socket) => {
    socket.end(command);
  });
}

async function clamdInstream(
  content: Uint8Array,
  settings: ContentSecuritySettings,
): Promise<string> {
  return exchangeWithClamd(settings, (socket) => {
    socket.write("zINSTREAM\0");
    for (let offset = 0; offset < content.byteLength; offset += CLAMD_CHUNK_BYTES) {
      const chunk = content.subarray(
        offset,
        Math.min(offset + CLAMD_CHUNK_BYTES, content.byteLength),
      );
      const length = Buffer.allocUnsafe(4);
      length.writeUInt32BE(chunk.byteLength, 0);
      socket.write(length);
      socket.write(chunk);
    }
    socket.end(Buffer.alloc(4));
  });
}

function exchangeWithClamd(
  settings: ContentSecuritySettings,
  writeRequest: (socket: net.Socket) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: settings.host, port: settings.port });
    const chunks: Buffer[] = [];
    let responseBytes = 0;
    let settled = false;
    const totalTimer = setTimeout(() => {
      fail(
        new UploadPreflightError(
          503,
          "CONTENT_SECURITY_TIMEOUT",
          "The content-security scanner did not complete within the configured timeout.",
        ),
      );
    }, settings.scanTimeoutMs);

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      socket.destroy();
      const response = Buffer.concat(chunks).toString("utf8").replace(/\0+$/u, "").trim();
      if (!response) {
        reject(
          new UploadPreflightError(
            503,
            "CONTENT_SECURITY_INVALID_RESPONSE",
            "The content-security scanner returned an empty response.",
          ),
        );
        return;
      }
      resolve(response);
    };

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      socket.destroy();
      if (error instanceof UploadPreflightError) {
        reject(error);
        return;
      }
      reject(
        new UploadPreflightError(
          503,
          "CONTENT_SECURITY_UNAVAILABLE",
          "The content-security scanner is unavailable.",
        ),
      );
    };

    socket.setTimeout(settings.connectTimeoutMs, () => {
      fail(
        new UploadPreflightError(
          503,
          "CONTENT_SECURITY_UNAVAILABLE",
          "The content-security scanner connection timed out.",
        ),
      );
    });
    socket.once("connect", () => {
      socket.setTimeout(0);
      try {
        writeRequest(socket);
      } catch (error) {
        fail(error);
      }
    });
    socket.on("data", (chunk: Buffer) => {
      responseBytes += chunk.byteLength;
      if (responseBytes > MAX_CLAMD_RESPONSE_BYTES) {
        fail(
          new UploadPreflightError(
            503,
            "CONTENT_SECURITY_INVALID_RESPONSE",
            "The content-security scanner response exceeded the allowed size.",
          ),
        );
        return;
      }
      chunks.push(chunk);
      if (chunk.includes(0)) finish();
    });
    socket.once("end", finish);
    socket.once("error", fail);
  });
}

function parseClamdScanResponse(response: string): {
  status: "clean" | "infected";
  signatureName: string | null;
} {
  if (/(?:^|:\s)OK$/u.test(response)) {
    return { status: "clean", signatureName: null };
  }
  const found = response.match(/:\s(.+)\sFOUND$/u);
  if (found?.[1]) {
    return { status: "infected", signatureName: found[1].trim() };
  }
  throw new UploadPreflightError(
    503,
    "CONTENT_SECURITY_SCAN_ERROR",
    "The content-security scanner could not produce a safe verdict.",
  );
}

function parseClamdVersion(response: string): {
  engineVersion: string | null;
  signatureVersion: string | null;
} {
  const match = response.match(/^ClamAV\s+([^/\s]+)\/([^/\s]+)(?:\/|$)/u);
  return {
    engineVersion: match?.[1] ?? null,
    signatureVersion: match?.[2] ?? null,
  };
}

function contentMatchesMimeType(content: Uint8Array, mimeType: string): boolean {
  if (content.byteLength === 0) return false;
  if (mimeType === "application/pdf") return startsWithAscii(content, "%PDF-");
  if (mimeType === "image/png") return startsWithBytes(content, [0x89, 0x50, 0x4e, 0x47]);
  if (mimeType === "image/jpeg") return startsWithBytes(content, [0xff, 0xd8, 0xff]);
  if (mimeType === "image/gif") {
    return startsWithAscii(content, "GIF87a") || startsWithAscii(content, "GIF89a");
  }
  if (mimeType === "image/webp") {
    return (
      startsWithAscii(content, "RIFF")
      && asciiAt(content, 8, 4) === "WEBP"
    );
  }
  if (mimeType === "application/msword") {
    return startsWithBytes(content, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    || mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    || mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    || mimeType === "application/vnd.ms-excel.sheet.macroenabled.12"
  ) {
    return startsWithBytes(content, [0x50, 0x4b, 0x03, 0x04]);
  }
  if (mimeType === "application/rtf" || mimeType === "text/rtf") {
    return startsWithAscii(content, "{\\rtf");
  }

  const text = decodeText(content);
  if (text === null) return false;
  const trimmed = text.trimStart();
  if (mimeType === "application/json") {
    try {
      JSON.parse(text);
      return true;
    } catch {
      return false;
    }
  }
  if (
    mimeType.includes("xml")
    || mimeType === "text/html"
    || mimeType === "image/svg+xml"
  ) {
    return trimmed.startsWith("<");
  }
  return true;
}

function decodeText(content: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return null;
  }
}

function startsWithAscii(content: Uint8Array, expected: string): boolean {
  return asciiAt(content, 0, expected.length) === expected;
}

function asciiAt(content: Uint8Array, offset: number, length: number): string {
  if (content.byteLength < offset + length) return "";
  return Buffer.from(content.subarray(offset, offset + length)).toString("ascii");
}

function startsWithBytes(content: Uint8Array, expected: number[]): boolean {
  return expected.every((value, index) => content[index] === value);
}

function parseClamdEndpoint(value: string): { host: string; port: number } {
  const normalized = value.includes("://") ? value : `tcp://${value}`;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new UploadPreflightError(
      500,
      "CONTENT_SECURITY_ENDPOINT_INVALID",
      "STRATOS_CONTENT_SECURITY_ENDPOINT is invalid.",
    );
  }
  const port = Number(url.port || "3310");
  if (url.protocol !== "tcp:" || !url.hostname || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new UploadPreflightError(
      500,
      "CONTENT_SECURITY_ENDPOINT_INVALID",
      "STRATOS_CONTENT_SECURITY_ENDPOINT must be a tcp://host:port endpoint.",
    );
  }
  return { host: url.hostname, port };
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || !value.trim()) return fallback;
  if (value.trim().toLowerCase() === "true") return true;
  if (value.trim().toLowerCase() === "false") return false;
  throw new UploadPreflightError(
    500,
    "CONTENT_SECURITY_CONFIGURATION_INVALID",
    "STRATOS_CONTENT_SECURITY_REQUIRED must be true or false.",
  );
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
