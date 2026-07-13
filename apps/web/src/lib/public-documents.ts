import {
  createSourceOpenDecision,
  openVerifiedSourceObject,
  sourceContentTypeHeader,
  verifySourceDownloadToken,
  type VerifiedSourceObject
} from "@/lib/upload/source-download";

const FULL_SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const PUBLIC_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_MIME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+\-/]{0,158}$/;
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const MAX_UPSTREAM_BODY_BYTES = 32 * 1024;

export interface PublicDocumentSnapshotFile {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

export interface PublicDocumentSnapshot {
  schemaVersion: "akb-public-document-1";
  documentId: string;
  documentVersionId: string;
  title: string;
  documentType: string;
  versionLabel: string;
  validFrom: string | null;
  validTo: string | null;
  publishedAt: string;
  description: string | null;
  file: PublicDocumentSnapshotFile;
}

export interface PublicDocumentMetadata {
  snapshot: PublicDocumentSnapshot;
  decision_id: string;
}

export interface InternalPublicDocumentSource {
  publication_id: string;
  public_slug: string;
  document_id: string;
  document_version_id: string;
  source_version: string;
  source_file_uri: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  policy_binding_id: string;
  policy_version: string;
  policy_hash: string;
  decision_id: string;
}

export interface OpenPublicSource {
  sizeBytes: number;
  filename: string;
  mimeType: string;
  sha256: string;
  openStream(start?: number, end?: number): ReadableStream<Uint8Array>;
  close(): Promise<void>;
}

export interface PublicByteRange {
  start: number;
  end: number;
  length: number;
}

export class PublicDocumentDeliveryError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "PublicDocumentDeliveryError";
  }
}

export function normalizePublicSlug(value: string): string {
  const slug = String(value ?? "").trim();
  if (slug.length < 3 || slug.length > 120 || !PUBLIC_SLUG_PATTERN.test(slug)) {
    throw new PublicDocumentDeliveryError(404, "PUBLIC_DOCUMENT_UNAVAILABLE", "The public document is unavailable.");
  }
  return slug;
}

export function parsePublicDocumentMetadata(value: unknown): PublicDocumentMetadata {
  const body = exactRecord(value, ["snapshot", "decision_id"], "public metadata response");
  const snapshot = exactRecord(
    body.snapshot,
    [
      "schemaVersion",
      "documentId",
      "documentVersionId",
      "title",
      "documentType",
      "versionLabel",
      "validFrom",
      "validTo",
      "publishedAt",
      "description",
      "file"
    ],
    "public document snapshot"
  );
  const file = exactRecord(
    snapshot.file,
    ["filename", "mimeType", "sizeBytes", "sha256"],
    "public document file snapshot"
  );
  if (snapshot.schemaVersion !== "akb-public-document-1") {
    throw invalidUpstream("The public document snapshot schema is unsupported.");
  }
  const parsed: PublicDocumentMetadata = {
    snapshot: {
      schemaVersion: "akb-public-document-1",
      documentId: safeIdentifier(snapshot.documentId, "documentId"),
      documentVersionId: safeIdentifier(snapshot.documentVersionId, "documentVersionId"),
      title: safeText(snapshot.title, "title", 300, true) as string,
      documentType: safeIdentifier(snapshot.documentType, "documentType"),
      versionLabel: safeText(snapshot.versionLabel, "versionLabel", 80, true) as string,
      validFrom: optionalDateString(snapshot.validFrom, "validFrom"),
      validTo: optionalDateString(snapshot.validTo, "validTo"),
      publishedAt: requiredDateString(snapshot.publishedAt, "publishedAt"),
      description: safeText(snapshot.description, "description", 2000, false),
      file: {
        filename: safeFilename(file.filename),
        mimeType: safeMime(file.mimeType),
        sizeBytes: safeSize(file.sizeBytes),
        sha256: safeSha256(file.sha256)
      }
    },
    decision_id: safeIdentifier(body.decision_id, "decision_id")
  };
  return parsed;
}

export function parseInternalPublicDocumentSource(value: unknown): InternalPublicDocumentSource {
  const body = exactRecord(
    value,
    [
      "publication_id",
      "public_slug",
      "document_id",
      "document_version_id",
      "source_version",
      "source_file_uri",
      "filename",
      "mime_type",
      "size_bytes",
      "sha256",
      "policy_binding_id",
      "policy_version",
      "policy_hash",
      "decision_id"
    ],
    "internal public source response"
  );
  const source: InternalPublicDocumentSource = {
    publication_id: safeIdentifier(body.publication_id, "publication_id"),
    public_slug: normalizePublicSlug(String(body.public_slug ?? "")),
    document_id: safeIdentifier(body.document_id, "document_id"),
    document_version_id: safeIdentifier(body.document_version_id, "document_version_id"),
    source_version: safeIdentifier(body.source_version, "source_version"),
    source_file_uri: safeSourceUri(body.source_file_uri),
    filename: safeFilename(body.filename),
    mime_type: safeMime(body.mime_type),
    size_bytes: safeSize(body.size_bytes),
    sha256: safeSha256(body.sha256),
    policy_binding_id: safeIdentifier(body.policy_binding_id, "policy_binding_id"),
    policy_version: safeIdentifier(body.policy_version, "policy_version"),
    policy_hash: safeSha256(body.policy_hash),
    decision_id: safeIdentifier(body.decision_id, "decision_id")
  };
  if (source.source_version !== source.document_version_id) {
    throw invalidUpstream("The immutable public source version does not match its document version.");
  }
  return source;
}

export async function fetchPublicDocumentMetadata(
  publicSlug: string,
  options: {
    env?: Record<string, string | undefined>;
    fetcher?: typeof fetch;
  } = {}
): Promise<PublicDocumentMetadata> {
  const slug = normalizePublicSlug(publicSlug);
  const baseUrl = registryBaseUrl(options.env ?? process.env);
  const response = await (options.fetcher ?? fetch)(
    `${baseUrl}/public/documents/${encodeURIComponent(slug)}`,
    {
      cache: "no-store",
      headers: { Accept: "application/json" }
    }
  ).catch(() => {
    throw new PublicDocumentDeliveryError(503, "PUBLIC_POLICY_UNAVAILABLE", "Public policy verification is unavailable.");
  });
  if (!response.ok) {
    throw upstreamStatusError(response);
  }
  return parsePublicDocumentMetadata(await boundedJson(response));
}

export async function resolveInternalPublicDocumentSource(
  publicSlug: string,
  options: {
    env?: Record<string, string | undefined>;
    fetcher?: typeof fetch;
  } = {}
): Promise<InternalPublicDocumentSource> {
  const slug = normalizePublicSlug(publicSlug);
  const env = options.env ?? process.env;
  const internalToken = env.AKL_PUBLIC_DELIVERY_INTERNAL_TOKEN ?? "";
  if (internalToken.length < 32) {
    throw new PublicDocumentDeliveryError(503, "PUBLIC_DELIVERY_UNAVAILABLE", "Public source delivery is unavailable.");
  }
  const response = await (options.fetcher ?? fetch)(
    `${registryBaseUrl(env)}/internal/public/documents/${encodeURIComponent(slug)}/source`,
    {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "X-AKB-Public-Delivery-Token": internalToken
      }
    }
  ).catch(() => {
    throw new PublicDocumentDeliveryError(503, "PUBLIC_POLICY_UNAVAILABLE", "Public policy verification is unavailable.");
  });
  if (!response.ok) {
    throw upstreamStatusError(response);
  }
  const parsed = parseInternalPublicDocumentSource(await boundedJson(response));
  if (parsed.public_slug !== slug) {
    throw invalidUpstream("The public source slug does not match the request.");
  }
  return parsed;
}

export async function openPublicSource(
  resolution: InternalPublicDocumentSource
): Promise<OpenPublicSource> {
  const sourceOpen = await createSourceOpenDecision({
    document_id: resolution.document_id,
    document_version_id: resolution.document_version_id,
    source_file_uri: resolution.source_file_uri,
    file_hash: resolution.sha256,
    viewer_mode: "binary",
    policy_binding_id: resolution.policy_binding_id,
    policy_version: resolution.policy_version,
    policy_hash: resolution.policy_hash
  });
  if (!sourceOpen.available || !sourceOpen.download_url) {
    throw new PublicDocumentDeliveryError(404, "PUBLIC_DOCUMENT_UNAVAILABLE", "The public document is unavailable.");
  }
  const token = new URL(sourceOpen.download_url, "http://akb.local").searchParams.get("token");
  if (!token) {
    throw invalidUpstream("The internal public source token is unavailable.");
  }
  const payload = verifySourceDownloadToken(token);
  if (
    payload.file_name !== resolution.filename ||
    payload.file_type !== resolution.mime_type ||
    payload.document_id !== resolution.document_id ||
    payload.document_version_id !== resolution.document_version_id ||
    payload.source_file_uri !== resolution.source_file_uri ||
    payload.sha256 !== resolution.sha256 ||
    payload.policy_binding_id !== resolution.policy_binding_id ||
    payload.policy_version !== resolution.policy_version ||
    payload.policy_hash !== resolution.policy_hash
  ) {
    throw invalidUpstream("The internal public source descriptor is inconsistent.");
  }
  const source: VerifiedSourceObject = await openVerifiedSourceObject(
    payload,
    resolution.size_bytes
  );
  if (
    source.size_bytes !== resolution.size_bytes ||
    source.sha256 !== resolution.sha256 ||
    source.filename !== resolution.filename ||
    source.mime_type !== resolution.mime_type
  ) {
    await source.close();
    throw new PublicDocumentDeliveryError(404, "PUBLIC_DOCUMENT_UNAVAILABLE", "The public document is unavailable.");
  }
  return {
    sizeBytes: source.size_bytes,
    filename: resolution.filename,
    mimeType: sourceContentTypeHeader(resolution.mime_type),
    sha256: source.sha256,
    openStream: source.openStream,
    close: source.close
  };
}

export function parsePublicByteRange(value: string | null, sizeBytes: number): PublicByteRange | null {
  if (!value) return null;
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || value.length > 200 || value.includes(",")) {
    throw rangeNotSatisfiable();
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) throw rangeNotSatisfiable();
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) throw rangeNotSatisfiable();
    start = Math.max(0, sizeBytes - suffixLength);
    end = sizeBytes - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : sizeBytes - 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start >= sizeBytes ||
      end < start
    ) {
      throw rangeNotSatisfiable();
    }
    end = Math.min(end, sizeBytes - 1);
  }
  return { start, end, length: end - start + 1 };
}

export function publicSourceEtag(sha256: string): string {
  return `"${safeSha256(sha256).slice("sha256:".length)}"`;
}

export function publicEtagMatches(value: string | null, etag: string): boolean {
  if (!value) return false;
  return value
    .split(",")
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === "*" || candidate === etag || candidate === `W/${etag}`);
}

export function publicContentDisposition(filename: string): string {
  const safe = safeFilename(filename);
  const ascii = safe.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

function registryBaseUrl(env: Record<string, string | undefined>): string {
  const value = (env.AKL_REGISTRY_API_BASE_URL ?? "").replace(/\/+$/, "");
  if (!value) {
    throw new PublicDocumentDeliveryError(503, "PUBLIC_DELIVERY_UNAVAILABLE", "Public document delivery is unavailable.");
  }
  return value;
}

async function boundedJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_UPSTREAM_BODY_BYTES) {
    throw invalidUpstream("The public document response is too large.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw invalidUpstream("The public document response is not valid JSON.");
  }
}

function upstreamStatusError(response: Response): PublicDocumentDeliveryError {
  if (response.status === 404) {
    return new PublicDocumentDeliveryError(404, "PUBLIC_DOCUMENT_UNAVAILABLE", "The public document is unavailable.");
  }
  if (response.status === 429) {
    const parsedRetry = Number(response.headers.get("retry-after") ?? "");
    const retryAfterSeconds =
      Number.isInteger(parsedRetry) && parsedRetry > 0 && parsedRetry <= 3600
        ? parsedRetry
        : 60;
    return new PublicDocumentDeliveryError(
      429,
      "PUBLIC_RATE_LIMITED",
      "Public document delivery is temporarily busy.",
      retryAfterSeconds
    );
  }
  if (response.status === 503) {
    return new PublicDocumentDeliveryError(503, "PUBLIC_POLICY_UNAVAILABLE", "Public policy verification is unavailable.");
  }
  return new PublicDocumentDeliveryError(502, "PUBLIC_DELIVERY_UPSTREAM_INVALID", "Public document delivery failed closed.");
}

function invalidUpstream(message: string): PublicDocumentDeliveryError {
  return new PublicDocumentDeliveryError(502, "PUBLIC_DELIVERY_UPSTREAM_INVALID", message);
}

function rangeNotSatisfiable(): PublicDocumentDeliveryError {
  return new PublicDocumentDeliveryError(
    416,
    "PUBLIC_RANGE_NOT_SATISFIABLE",
    "The requested public source byte range is not satisfiable."
  );
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidUpstream(`${label} is invalid.`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw invalidUpstream(`${label} contains unsupported fields.`);
  }
  return record;
}

function safeIdentifier(value: unknown, field: string): string {
  const candidate = String(value ?? "").trim();
  if (!candidate || candidate.length > 200 || !/^[A-Za-z0-9_.:+-]+$/.test(candidate)) {
    throw invalidUpstream(`${field} is invalid.`);
  }
  return candidate;
}

function safeText(value: unknown, field: string, maxLength: number, required: boolean): string | null {
  if (value === null && !required) return null;
  if (typeof value !== "string") throw invalidUpstream(`${field} is invalid.`);
  const candidate = value.normalize("NFC").trim();
  if ((required && !candidate) || candidate.length > maxLength || CONTROL_PATTERN.test(candidate)) {
    throw invalidUpstream(`${field} is invalid.`);
  }
  return candidate || null;
}

function safeFilename(value: unknown): string {
  const candidate = safeText(value, "filename", 300, true) as string;
  if (candidate.includes("/") || candidate.includes("\\") || candidate === "." || candidate === "..") {
    throw invalidUpstream("filename is invalid.");
  }
  return candidate;
}

function safeMime(value: unknown): string {
  const candidate = String(value ?? "");
  if (!SAFE_MIME_PATTERN.test(candidate)) throw invalidUpstream("mime type is invalid.");
  return candidate;
}

function safeSize(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw invalidUpstream("file size is invalid.");
  return Number(value);
}

function safeSha256(value: unknown): string {
  const candidate = String(value ?? "").toLowerCase();
  if (!FULL_SHA256_PATTERN.test(candidate)) throw invalidUpstream("sha256 is invalid.");
  return candidate;
}

function safeSourceUri(value: unknown): string {
  const candidate = String(value ?? "");
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw invalidUpstream("The internal source URI is invalid.");
  }
  if (parsed.protocol !== "s3:" || !parsed.hostname || !parsed.pathname || candidate.length > 1024) {
    throw invalidUpstream("The internal source URI is invalid.");
  }
  return candidate;
}

function optionalDateString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requiredDateString(value, field);
}

function requiredDateString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value || !Number.isFinite(Date.parse(value))) {
    throw invalidUpstream(`${field} is invalid.`);
  }
  return value;
}
