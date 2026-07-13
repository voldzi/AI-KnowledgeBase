import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface UploadPreflightRequest {
  document_id: string;
  file_name: string;
  file_size: number;
  file_type?: string | null;
  sha256: string;
  policy_binding_id?: string | null;
  policy_version?: string | null;
  policy_hash?: string | null;
}

export interface UploadPreflightDecision {
  upload_session_id: string;
  upload_url: string;
  upload_method: "PUT";
  source_file_uri: string;
  expires_at: string;
  required_headers: Record<string, string>;
  bucket: string;
  object_key: string;
  policy_binding_id: string | null;
  policy_version: string | null;
  policy_hash: string | null;
  file: {
    filename: string;
    mime_type: string;
    size_bytes: number;
    sha256: string;
  };
  limits: {
    max_file_bytes: number;
    accepted_mime_types: string[];
  };
}

export interface UploadTokenPayload {
  session_id: string;
  document_id: string;
  bucket: string;
  object_key: string;
  source_file_uri: string;
  file_name: string;
  file_size: number;
  file_type: string;
  sha256: string;
  expires_at: string;
  policy_binding_id: string | null;
  policy_version: string | null;
  policy_hash: string | null;
}

export interface UploadSettings {
  objectStorageRoot: string;
  bucket: string;
  signingSecret: string;
  maxFileBytes: number;
  publicUploadBasePath: string;
  expiresInSeconds: number;
}

export class UploadPreflightError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "UploadPreflightError";
  }
}

const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024;
const DEFAULT_EXPIRES_IN_SECONDS = 15 * 60;
const SHA256_PATTERN = /^sha256:[a-fA-F0-9]{64}$/;

const ACCEPTED_MIME_TYPES = [
  "application/bpmn+xml",
  "application/mermaid",
  "application/json",
  "application/msword",
  "application/pdf",
  "application/rtf",
  "application/vnd.asyncapi",
  "application/vnd.asyncapi+json",
  "application/vnd.jgraph.mxfile",
  "application/vnd.ms-excel.sheet.macroEnabled.12",
  "application/vnd.oai.openapi",
  "application/vnd.oai.openapi+json",
  "application/vnd.opengroup.archimate.exchange+xml",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/xhtml+xml",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
  "text/csv",
  "text/html",
  "text/markdown",
  "text/plain",
  "text/rtf",
  "text/vnd.mermaid",
  "text/xml",
  "text/x-plantuml",
  "text/x-yaml",
  "text/yaml"
];

const EXTENSION_MIME_TYPES = new Map<string, string>([
  [".archimate", "application/vnd.opengroup.archimate.exchange+xml"],
  [".archimate3", "application/vnd.opengroup.archimate.exchange+xml"],
  [".asyncapi", "application/vnd.asyncapi"],
  [".bpmn", "application/bpmn+xml"],
  [".csv", "text/csv"],
  [".dio", "application/vnd.jgraph.mxfile"],
  [".doc", "application/msword"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".drawio", "application/vnd.jgraph.mxfile"],
  [".gif", "image/gif"],
  [".htm", "text/html"],
  [".html", "text/html"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".json", "application/json"],
  [".md", "text/markdown"],
  [".markdown", "text/markdown"],
  [".mermaid", "text/vnd.mermaid"],
  [".mmd", "text/vnd.mermaid"],
  [".openapi", "application/vnd.oai.openapi"],
  [".pdf", "application/pdf"],
  [".plantuml", "text/x-plantuml"],
  [".png", "image/png"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".puml", "text/x-plantuml"],
  [".rtf", "application/rtf"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain"],
  [".webp", "image/webp"],
  [".xlsm", "application/vnd.ms-excel.sheet.macroEnabled.12"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".xhtml", "application/xhtml+xml"],
  [".xml", "application/xml"],
  [".yaml", "application/yaml"],
  [".yml", "application/yaml"]
]);

export function getUploadSettings(env: Record<string, string | undefined> = process.env): UploadSettings {
  const environment = env.AKL_ENV ?? "development";
  const signingSecret = env.AKL_WEB_UPLOAD_SIGNING_SECRET ?? env.AKL_DEV_ACCESS_TOKEN ?? "";
  if (environment === "production" && !signingSecret) {
    throw new UploadPreflightError(
      500,
      "UPLOAD_SIGNING_SECRET_MISSING",
      "AKL_WEB_UPLOAD_SIGNING_SECRET is required in production."
    );
  }

  return {
    objectStorageRoot: env.AKL_WEB_OBJECT_STORAGE_ROOT ?? "./object-storage",
    bucket: env.AKL_WEB_UPLOAD_BUCKET ?? "akl-documents",
    signingSecret: signingSecret || "akl-local-upload-signing-secret",
    maxFileBytes: parsePositiveInteger(env.AKL_WEB_UPLOAD_MAX_FILE_BYTES, DEFAULT_MAX_FILE_BYTES),
    publicUploadBasePath: env.AKL_WEB_UPLOAD_PUBLIC_BASE_PATH ?? "/api/controlled-document/upload/sessions",
    expiresInSeconds: parsePositiveInteger(env.AKL_WEB_UPLOAD_TOKEN_TTL_SECONDS, DEFAULT_EXPIRES_IN_SECONDS)
  };
}

export function createUploadPreflightDecision(
  request: UploadPreflightRequest,
  settings: UploadSettings = getUploadSettings()
): UploadPreflightDecision {
  const documentId = normalizeDocumentId(request.document_id);
  const filename = normalizeFilename(request.file_name);
  const sizeBytes = normalizeFileSize(request.file_size, settings.maxFileBytes);
  const sha256 = normalizeSha256(request.sha256);
  const mimeType = normalizeMimeType(filename, request.file_type);
  const sessionId = `upl_${randomUUID().replaceAll("-", "")}`;
  const objectKey = `${documentId}/draft/${new Date().toISOString().slice(0, 10)}/${sessionId}/${filename}`;
  const sourceFileUri = `s3://${settings.bucket}/${objectKey}`;
  const expiresAt = new Date(Date.now() + settings.expiresInSeconds * 1000).toISOString();
  const payload: UploadTokenPayload = {
    session_id: sessionId,
    document_id: documentId,
    bucket: settings.bucket,
    object_key: objectKey,
    source_file_uri: sourceFileUri,
    file_name: filename,
    file_size: sizeBytes,
    file_type: mimeType,
    sha256,
    expires_at: expiresAt,
    policy_binding_id: request.policy_binding_id ?? null,
    policy_version: request.policy_version ?? null,
    policy_hash: request.policy_hash ?? null
  };
  const uploadToken = signUploadToken(payload, settings);

  return {
    upload_session_id: sessionId,
    upload_url: `${settings.publicUploadBasePath}/${encodeURIComponent(sessionId)}/content`,
    upload_method: "PUT",
    source_file_uri: sourceFileUri,
    expires_at: expiresAt,
    required_headers: {
      "Content-Type": mimeType,
      "X-AKL-Content-SHA256": sha256,
      "X-AKL-Upload-Token": uploadToken
    },
    bucket: settings.bucket,
    object_key: objectKey,
    policy_binding_id: payload.policy_binding_id,
    policy_version: payload.policy_version,
    policy_hash: payload.policy_hash,
    file: {
      filename,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      sha256
    },
    limits: {
      max_file_bytes: settings.maxFileBytes,
      accepted_mime_types: ACCEPTED_MIME_TYPES
    }
  };
}

export function verifyUploadToken(token: string, settings: UploadSettings = getUploadSettings()): UploadTokenPayload {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    throw new UploadPreflightError(401, "INVALID_UPLOAD_TOKEN", "Upload token is malformed.");
  }

  const expectedSignature = signValue(encodedPayload, settings.signingSecret);
  if (!safeEqual(signature, expectedSignature)) {
    throw new UploadPreflightError(401, "INVALID_UPLOAD_TOKEN", "Upload token signature is invalid.");
  }

  let payload: UploadTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as UploadTokenPayload;
  } catch {
    throw new UploadPreflightError(401, "INVALID_UPLOAD_TOKEN", "Upload token payload is invalid.");
  }

  if (new Date(payload.expires_at).getTime() <= Date.now()) {
    throw new UploadPreflightError(410, "UPLOAD_TOKEN_EXPIRED", "Upload token has expired.");
  }

  normalizeDocumentId(payload.document_id);
  normalizeFilename(payload.file_name);
  normalizeFileSize(payload.file_size, settings.maxFileBytes);
  normalizeSha256(payload.sha256);
  normalizeMimeType(payload.file_name, payload.file_type);
  if (payload.bucket !== settings.bucket) {
    throw new UploadPreflightError(401, "INVALID_UPLOAD_TOKEN", "Upload token bucket is not valid.");
  }
  if (payload.source_file_uri !== `s3://${payload.bucket}/${payload.object_key}`) {
    throw new UploadPreflightError(401, "INVALID_UPLOAD_TOKEN", "Upload token source URI is inconsistent.");
  }
  if (payload.policy_hash && !SHA256_PATTERN.test(payload.policy_hash)) {
    throw new UploadPreflightError(401, "INVALID_UPLOAD_TOKEN", "Upload token policy hash is invalid.");
  }

  return payload;
}

export async function persistUploadedObject(
  payload: UploadTokenPayload,
  content: Uint8Array,
  settings: UploadSettings = getUploadSettings()
): Promise<{ path: string; sha256: string; size_bytes: number }> {
  if (content.byteLength !== payload.file_size) {
    throw new UploadPreflightError(
      400,
      "UPLOAD_SIZE_MISMATCH",
      "Uploaded content size does not match the preflight metadata.",
      { expected_size_bytes: payload.file_size, actual_size_bytes: content.byteLength }
    );
  }

  const sha256 = `sha256:${createHash("sha256").update(content).digest("hex")}`;
  if (sha256 !== payload.sha256) {
    throw new UploadPreflightError(
      400,
      "UPLOAD_HASH_MISMATCH",
      "Uploaded content SHA-256 does not match the preflight metadata.",
      { expected_sha256: payload.sha256, actual_sha256: sha256 }
    );
  }

  const targetPath = resolveObjectPath(payload, settings);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, { mode: 0o640 });
  return { path: targetPath, sha256, size_bytes: content.byteLength };
}

export function assertUploadMatchesIngestionPayload(
  token: string,
  request: {
    document_id: string;
    upload_session_id?: string | null;
    source_file_uri: string;
    file_hash?: string | null;
    file_name?: string | null;
    file_size?: number | null;
    file_type?: string | null;
  },
  settings: UploadSettings = getUploadSettings()
): UploadTokenPayload {
  const payload = verifyUploadToken(token, settings);
  const mismatches: string[] = [];
  if (payload.document_id !== request.document_id) mismatches.push("document_id");
  if (request.upload_session_id && payload.session_id !== request.upload_session_id) mismatches.push("upload_session_id");
  if (payload.source_file_uri !== request.source_file_uri) mismatches.push("source_file_uri");
  if (request.file_hash && payload.sha256 !== normalizeSha256(request.file_hash)) mismatches.push("file_hash");
  if (request.file_name && payload.file_name !== normalizeFilename(request.file_name)) mismatches.push("file_name");
  if (request.file_size !== undefined && request.file_size !== null && payload.file_size !== request.file_size) {
    mismatches.push("file_size");
  }
  if (request.file_type && payload.file_type !== normalizeMimeType(payload.file_name, request.file_type)) {
    mismatches.push("file_type");
  }

  if (mismatches.length > 0) {
    throw new UploadPreflightError(
      400,
      "UPLOAD_PREFLIGHT_MISMATCH",
      "Upload preflight metadata does not match the ingestion request.",
      { fields: mismatches }
    );
  }

  return payload;
}

function signUploadToken(payload: UploadTokenPayload, settings: UploadSettings): string {
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

function normalizeDocumentId(value: string): string {
  const documentId = String(value ?? "").trim();
  if (!documentId) {
    throw new UploadPreflightError(400, "DOCUMENT_ID_REQUIRED", "document_id is required.");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(documentId)) {
    throw new UploadPreflightError(400, "DOCUMENT_ID_INVALID", "document_id contains unsupported characters.");
  }
  return documentId;
}

function normalizeFilename(value: string): string {
  const base = path.posix.basename(String(value ?? "").replaceAll("\\", "/")).trim();
  const filename = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  if (!filename) {
    throw new UploadPreflightError(400, "FILE_NAME_REQUIRED", "file_name is required.");
  }
  if (!EXTENSION_MIME_TYPES.has(path.extname(filename).toLowerCase())) {
    throw new UploadPreflightError(415, "FILE_EXTENSION_UNSUPPORTED", "File extension is not supported.", {
      accepted_extensions: Array.from(EXTENSION_MIME_TYPES.keys())
    });
  }
  return filename;
}

function normalizeFileSize(value: number, maxFileBytes: number): number {
  const sizeBytes = Number(value);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new UploadPreflightError(400, "FILE_SIZE_INVALID", "file_size must be a positive integer.");
  }
  if (sizeBytes > maxFileBytes) {
    throw new UploadPreflightError(413, "FILE_TOO_LARGE", "File is larger than the configured upload limit.", {
      size_bytes: sizeBytes,
      max_file_bytes: maxFileBytes
    });
  }
  return sizeBytes;
}

function normalizeSha256(value: string): string {
  const sha256 = String(value ?? "").trim().toLowerCase();
  if (!SHA256_PATTERN.test(sha256)) {
    throw new UploadPreflightError(400, "FILE_HASH_INVALID", "sha256 must use sha256:<64 hex chars> format.");
  }
  return sha256;
}

function normalizeMimeType(filename: string, value?: string | null): string {
  const extension = path.extname(filename).toLowerCase();
  const expected = EXTENSION_MIME_TYPES.get(extension);
  if (!expected) {
    throw new UploadPreflightError(415, "FILE_EXTENSION_UNSUPPORTED", "File extension is not supported.");
  }

  const provided = String(value ?? "").trim().toLowerCase();
  if (!provided || provided === "application/octet-stream") {
    return expected;
  }

  if (
    provided === expected ||
    (extension === ".rtf" && provided === "text/rtf") ||
    (extension === ".xml" && provided === "text/xml") ||
    (extension === ".svg" && provided === "application/xml") ||
    (extension === ".htm" && provided === "text/html") ||
    (ARCHITECTURE_XML_EXTENSIONS.has(extension) && XML_MIME_ALIASES.has(provided)) ||
    (ARCHITECTURE_TEXT_EXTENSIONS.has(extension) && TEXT_MIME_ALIASES.has(provided)) ||
    (YAML_EXTENSIONS.has(extension) && YAML_MIME_ALIASES.has(provided)) ||
    (API_SPEC_EXTENSIONS.has(extension) && API_SPEC_MIME_ALIASES.has(provided))
  ) {
    return provided;
  }

  throw new UploadPreflightError(415, "FILE_TYPE_UNSUPPORTED", "File MIME type does not match an accepted document type.", {
    expected_mime_type: expected,
    provided_mime_type: provided
  });
}

const ARCHITECTURE_XML_EXTENSIONS = new Set([".archimate", ".archimate3", ".bpmn", ".dio", ".drawio"]);
const ARCHITECTURE_TEXT_EXTENSIONS = new Set([".mermaid", ".mmd", ".plantuml", ".puml"]);
const YAML_EXTENSIONS = new Set([".yaml", ".yml"]);
const API_SPEC_EXTENSIONS = new Set([".asyncapi", ".openapi"]);
const XML_MIME_ALIASES = new Set([
  "application/xml",
  "text/xml",
  "application/bpmn+xml",
  "application/vnd.jgraph.mxfile",
  "application/vnd.opengroup.archimate.exchange+xml"
]);
const TEXT_MIME_ALIASES = new Set(["application/mermaid", "text/plain", "text/vnd.mermaid", "text/x-plantuml"]);
const YAML_MIME_ALIASES = new Set(["application/yaml", "application/x-yaml", "text/yaml", "text/x-yaml", "text/plain"]);
const API_SPEC_MIME_ALIASES = new Set([
  "application/json",
  "application/vnd.asyncapi",
  "application/vnd.asyncapi+json",
  "application/vnd.oai.openapi",
  "application/vnd.oai.openapi+json",
  "application/yaml",
  "application/x-yaml",
  "text/yaml",
  "text/x-yaml"
]);

function resolveObjectPath(payload: UploadTokenPayload, settings: UploadSettings): string {
  const root = path.resolve(settings.objectStorageRoot);
  const bucketRoot = path.resolve(root, payload.bucket);
  const targetPath = path.resolve(bucketRoot, ...payload.object_key.split("/"));
  if (!targetPath.startsWith(`${bucketRoot}${path.sep}`)) {
    throw new UploadPreflightError(400, "OBJECT_KEY_INVALID", "Upload object key is outside the configured bucket.");
  }
  return targetPath;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}
