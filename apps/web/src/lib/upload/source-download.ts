import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export interface SourceOpenRequest {
  document_id: string;
  document_version_id: string;
  source_file_uri: string;
  file_hash?: string | null;
  viewer_mode: string;
}

export interface SourceOpenDecision {
  source_open_id: string;
  download_url: string | null;
  download_method: "GET";
  expires_at: string;
  source_file_uri: string;
  bucket: string;
  object_key: string;
  available: boolean;
  unavailable_reason: string | null;
  file: {
    filename: string;
    mime_type: string;
    size_bytes: number | null;
    sha256: string | null;
  };
  viewer_mode: string;
}

export interface SourceDownloadTokenPayload {
  source_open_id: string;
  document_id: string;
  document_version_id: string;
  bucket: string;
  object_key: string;
  source_file_uri: string;
  file_name: string;
  file_type: string;
  sha256: string | null;
  expires_at: string;
}

export interface SourceDownloadSettings {
  objectStorageRoot: string;
  bucket: string;
  signingSecret: string;
  publicDownloadBasePath: string;
  expiresInSeconds: number;
}

export class SourceDownloadError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "SourceDownloadError";
  }
}

const DEFAULT_EXPIRES_IN_SECONDS = 5 * 60;
const FULL_SHA256_PATTERN = /^sha256:[a-fA-F0-9]{64}$/;

const EXTENSION_MIME_TYPES = new Map<string, string>([
  [".csv", "text/csv"],
  [".doc", "application/msword"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".gif", "image/gif"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".md", "text/markdown"],
  [".markdown", "text/markdown"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".rtf", "application/rtf"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain"],
  [".webp", "image/webp"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]
]);

export function getSourceDownloadSettings(
  env: Record<string, string | undefined> = process.env
): SourceDownloadSettings {
  const environment = env.AKL_ENV ?? "development";
  const signingSecret = env.AKL_WEB_DOWNLOAD_SIGNING_SECRET ?? env.AKL_WEB_UPLOAD_SIGNING_SECRET ?? env.AKL_DEV_ACCESS_TOKEN ?? "";
  if (environment === "production" && !signingSecret) {
    throw new SourceDownloadError(
      500,
      "DOWNLOAD_SIGNING_SECRET_MISSING",
      "AKL_WEB_DOWNLOAD_SIGNING_SECRET or AKL_WEB_UPLOAD_SIGNING_SECRET is required in production."
    );
  }

  const basePath = env.NEXT_PUBLIC_AKL_BASE_PATH?.replace(/\/+$/, "") ?? "";

  return {
    objectStorageRoot: env.AKL_WEB_OBJECT_STORAGE_ROOT ?? "./object-storage",
    bucket: env.AKL_WEB_UPLOAD_BUCKET ?? "akl-documents",
    signingSecret: signingSecret || "akl-local-download-signing-secret",
    publicDownloadBasePath: env.AKL_WEB_DOWNLOAD_PUBLIC_BASE_PATH ?? `${basePath}/api/documents/source/content`,
    expiresInSeconds: parsePositiveInteger(env.AKL_WEB_DOWNLOAD_TOKEN_TTL_SECONDS, DEFAULT_EXPIRES_IN_SECONDS)
  };
}

export async function createSourceOpenDecision(
  request: SourceOpenRequest,
  settings: SourceDownloadSettings = getSourceDownloadSettings()
): Promise<SourceOpenDecision> {
  const documentId = normalizeId(request.document_id, "document_id");
  const versionId = normalizeId(request.document_version_id, "document_version_id");
  const { bucket, objectKey } = parseSourceFileUri(request.source_file_uri, settings);
  const filename = normalizeFilename(path.posix.basename(objectKey));
  const mimeType = mimeTypeFor(filename);
  const targetPath = resolveObjectPath({ bucket, object_key: objectKey }, settings);
  const sourceOpenId = `src_${randomUUID().replaceAll("-", "")}`;
  const expiresAt = new Date(Date.now() + settings.expiresInSeconds * 1000).toISOString();
  const expectedHash = normalizeOptionalSha256(request.file_hash);
  const payload: SourceDownloadTokenPayload = {
    source_open_id: sourceOpenId,
    document_id: documentId,
    document_version_id: versionId,
    bucket,
    object_key: objectKey,
    source_file_uri: `s3://${bucket}/${objectKey}`,
    file_name: filename,
    file_type: mimeType,
    sha256: expectedHash,
    expires_at: expiresAt
  };
  const objectStat = await stat(targetPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  });

  return {
    source_open_id: sourceOpenId,
    download_url: objectStat
      ? `${settings.publicDownloadBasePath}?token=${encodeURIComponent(signSourceDownloadToken(payload, settings))}`
      : null,
    download_method: "GET",
    expires_at: expiresAt,
    source_file_uri: payload.source_file_uri,
    bucket,
    object_key: objectKey,
    available: objectStat !== null,
    unavailable_reason: objectStat ? null : "SOURCE_OBJECT_NOT_FOUND",
    file: {
      filename,
      mime_type: mimeType,
      size_bytes: objectStat?.size ?? null,
      sha256: expectedHash
    },
    viewer_mode: request.viewer_mode
  };
}

export function verifySourceDownloadToken(
  token: string,
  settings: SourceDownloadSettings = getSourceDownloadSettings()
): SourceDownloadTokenPayload {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    throw new SourceDownloadError(401, "INVALID_SOURCE_DOWNLOAD_TOKEN", "Source download token is malformed.");
  }

  const expectedSignature = signValue(encodedPayload, settings.signingSecret);
  if (!safeEqual(signature, expectedSignature)) {
    throw new SourceDownloadError(401, "INVALID_SOURCE_DOWNLOAD_TOKEN", "Source download token signature is invalid.");
  }

  let payload: SourceDownloadTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as SourceDownloadTokenPayload;
  } catch {
    throw new SourceDownloadError(401, "INVALID_SOURCE_DOWNLOAD_TOKEN", "Source download token payload is invalid.");
  }

  if (new Date(payload.expires_at).getTime() <= Date.now()) {
    throw new SourceDownloadError(410, "SOURCE_DOWNLOAD_TOKEN_EXPIRED", "Source download token has expired.");
  }

  normalizeId(payload.document_id, "document_id");
  normalizeId(payload.document_version_id, "document_version_id");
  normalizeId(payload.source_open_id, "source_open_id");
  normalizeFilename(payload.file_name);
  normalizeOptionalSha256(payload.sha256);
  if (payload.bucket !== settings.bucket) {
    throw new SourceDownloadError(401, "INVALID_SOURCE_DOWNLOAD_TOKEN", "Source download bucket is not valid.");
  }
  if (payload.source_file_uri !== `s3://${payload.bucket}/${payload.object_key}`) {
    throw new SourceDownloadError(401, "INVALID_SOURCE_DOWNLOAD_TOKEN", "Source download URI is inconsistent.");
  }
  mimeTypeFor(payload.file_name);
  resolveObjectPath({ bucket: payload.bucket, object_key: payload.object_key }, settings);
  return payload;
}

export async function readSourceObject(
  payload: SourceDownloadTokenPayload,
  settings: SourceDownloadSettings = getSourceDownloadSettings()
): Promise<{ bytes: Uint8Array; mime_type: string; filename: string; sha256: string }> {
  const targetPath = resolveObjectPath({ bucket: payload.bucket, object_key: payload.object_key }, settings);
  const bytes = await readFile(targetPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      throw new SourceDownloadError(404, "SOURCE_OBJECT_NOT_FOUND", "Source object is not available in object storage.");
    }
    throw error;
  });
  const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (payload.sha256 && payload.sha256 !== sha256) {
    throw new SourceDownloadError(409, "SOURCE_HASH_MISMATCH", "Source object SHA-256 does not match Registry metadata.", {
      expected_sha256: payload.sha256,
      actual_sha256: sha256
    });
  }
  return { bytes, mime_type: payload.file_type, filename: payload.file_name, sha256 };
}

export function sourceContentTypeHeader(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (
    normalized.startsWith("text/") ||
    normalized === "application/rtf" ||
    normalized === "application/xml" ||
    normalized === "image/svg+xml"
  ) {
    return `${mimeType}; charset=utf-8`;
  }
  return mimeType;
}

function signSourceDownloadToken(payload: SourceDownloadTokenPayload, settings: SourceDownloadSettings): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${signValue(encodedPayload, settings.signingSecret)}`;
}

function signValue(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function parseSourceFileUri(sourceFileUri: string, settings: SourceDownloadSettings): { bucket: string; objectKey: string } {
  let parsed: URL;
  try {
    parsed = new URL(sourceFileUri);
  } catch {
    throw new SourceDownloadError(400, "SOURCE_FILE_URI_INVALID", "source_file_uri must be a valid s3:// URI.");
  }
  if (parsed.protocol !== "s3:") {
    throw new SourceDownloadError(400, "SOURCE_FILE_URI_INVALID", "source_file_uri must use s3://.");
  }
  const bucket = parsed.hostname;
  const objectKey = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (bucket !== settings.bucket) {
    throw new SourceDownloadError(403, "SOURCE_BUCKET_NOT_ALLOWED", "Source bucket is not allowed for this web boundary.");
  }
  if (!objectKey || objectKey.includes("\0")) {
    throw new SourceDownloadError(400, "SOURCE_OBJECT_KEY_INVALID", "Source object key is invalid.");
  }
  return { bucket, objectKey };
}

function resolveObjectPath(
  payload: { bucket: string; object_key: string },
  settings: SourceDownloadSettings
): string {
  const root = path.resolve(settings.objectStorageRoot);
  const bucketRoot = path.resolve(root, payload.bucket);
  const targetPath = path.resolve(bucketRoot, ...payload.object_key.split("/"));
  if (!targetPath.startsWith(`${bucketRoot}${path.sep}`)) {
    throw new SourceDownloadError(400, "SOURCE_OBJECT_KEY_INVALID", "Source object key is outside the configured bucket.");
  }
  return targetPath;
}

function normalizeId(value: string, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new SourceDownloadError(400, `${field.toUpperCase()}_REQUIRED`, `${field} is required.`);
  }
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new SourceDownloadError(400, `${field.toUpperCase()}_INVALID`, `${field} contains unsupported characters.`);
  }
  return normalized;
}

function normalizeFilename(value: string): string {
  const filename = path.posix.basename(String(value ?? "").replaceAll("\\", "/")).trim();
  if (!filename || filename === "." || filename === "..") {
    throw new SourceDownloadError(400, "SOURCE_FILE_NAME_INVALID", "Source file name is invalid.");
  }
  return filename;
}

function normalizeOptionalSha256(value?: string | null): string | null {
  const candidate = String(value ?? "").trim().toLowerCase();
  if (!candidate) {
    return null;
  }
  return FULL_SHA256_PATTERN.test(candidate) ? candidate : null;
}

function mimeTypeFor(filename: string): string {
  return EXTENSION_MIME_TYPES.get(path.extname(filename).toLowerCase()) ?? "application/octet-stream";
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}
