import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export type ObjectStorageMode = "local" | "s3";

export interface ObjectStorageSettings {
  objectStorageRoot: string;
  bucket: string;
  storageMode?: ObjectStorageMode;
  s3Endpoint?: string;
  s3Region?: string;
  s3ForcePathStyle?: boolean;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  localFallbackRead?: boolean;
  legacyBuckets?: string[];
}

export interface StoredObjectDescriptor {
  bucket: string;
  key: string;
  size_bytes: number;
  sha256: string | null;
  content_type: string | null;
  original_filename: string | null;
}

export interface StoredObject extends StoredObjectDescriptor {
  content: Uint8Array;
}

export class ObjectStorageBackendError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly causeValue?: unknown,
  ) {
    super(message);
    this.name = "ObjectStorageBackendError";
  }
}

const clients = new Map<string, S3Client>();

export function objectStorageSettingsFromEnv(
  env: Record<string, string | undefined> = process.env,
): Pick<
  ObjectStorageSettings,
  | "storageMode"
  | "s3Endpoint"
  | "s3Region"
  | "s3ForcePathStyle"
  | "s3AccessKeyId"
  | "s3SecretAccessKey"
  | "localFallbackRead"
  | "legacyBuckets"
> {
  const storageMode = (env.AKL_OBJECT_STORAGE_MODE ?? "local").trim().toLowerCase();
  if (storageMode !== "local" && storageMode !== "s3") {
    throw new ObjectStorageBackendError(
      "OBJECT_STORAGE_MODE_INVALID",
      "AKL_OBJECT_STORAGE_MODE must be local or s3.",
    );
  }
  const s3AccessKeyId = storageMode === "s3"
    ? secretValue(
        env.AKL_S3_ACCESS_KEY_ID,
        env.AKL_S3_ACCESS_KEY_ID_FILE,
        "AKL_S3_ACCESS_KEY_ID_FILE",
      )
    : undefined;
  const s3SecretAccessKey = storageMode === "s3"
    ? secretValue(
        env.AKL_S3_SECRET_ACCESS_KEY,
        env.AKL_S3_SECRET_ACCESS_KEY_FILE,
        "AKL_S3_SECRET_ACCESS_KEY_FILE",
      )
    : undefined;
  const settings: ReturnTypeShape = {
    storageMode,
    s3Endpoint: env.AKL_S3_ENDPOINT?.trim() || undefined,
    s3Region: env.AKL_S3_REGION?.trim() || "us-east-1",
    s3ForcePathStyle: parseBoolean(env.AKL_S3_FORCE_PATH_STYLE, true),
    s3AccessKeyId,
    s3SecretAccessKey,
    localFallbackRead: parseBoolean(env.AKL_OBJECT_STORAGE_LOCAL_FALLBACK_READ, false),
    legacyBuckets: parseCsv(env.AKL_OBJECT_STORAGE_LEGACY_BUCKETS),
  };
  if (storageMode === "s3") {
    if (!settings.s3Endpoint) {
      throw new ObjectStorageBackendError(
        "S3_ENDPOINT_MISSING",
        "AKL_S3_ENDPOINT is required when AKL_OBJECT_STORAGE_MODE=s3.",
      );
    }
    if (!s3AccessKeyId || !s3SecretAccessKey) {
      throw new ObjectStorageBackendError(
        "S3_CREDENTIALS_MISSING",
        "S3 credentials are required when AKL_OBJECT_STORAGE_MODE=s3.",
      );
    }
  }
  return settings;
}

export async function putStoredObject(
  settings: ObjectStorageSettings,
  input: {
    bucket: string;
    key: string;
    content: Uint8Array;
    sha256: string;
    contentType: string;
    originalFilename: string;
  },
): Promise<StoredObjectDescriptor> {
  assertObjectCoordinates(settings, input.bucket, input.key);
  if (mode(settings) === "local") {
    const target = localPath(settings, input.bucket, input.key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, input.content, { flag: "wx", mode: 0o640 }).catch(async (error) => {
      if (!isAlreadyExists(error)) throw error;
      const existing = await headStoredObject(settings, input.bucket, input.key);
      if (!existing || existing.size_bytes !== input.content.byteLength) {
        throw new ObjectStorageBackendError(
          "OBJECT_STORAGE_CONFLICT",
          "The object key already contains different content.",
        );
      }
      const bytes = await readFile(target);
      if (sha256(bytes) !== input.sha256) {
        throw new ObjectStorageBackendError(
          "OBJECT_STORAGE_CONFLICT",
          "The object key already contains different content.",
        );
      }
    });
    return {
      bucket: input.bucket,
      key: input.key,
      size_bytes: input.content.byteLength,
      sha256: input.sha256,
      content_type: input.contentType,
      original_filename: input.originalFilename,
    };
  }

  const client = s3Client(settings);
  try {
    await client.send(new PutObjectCommand({
      Bucket: physicalS3Bucket(settings, input.bucket),
      Key: input.key,
      Body: input.content,
      ContentLength: input.content.byteLength,
      ContentType: input.contentType,
      IfNoneMatch: "*",
      Metadata: {
        sha256: input.sha256,
        "original-filename": encodeURIComponent(input.originalFilename),
      },
    }));
  } catch (error) {
    if (!isPreconditionFailed(error)) {
      throw storageFailure("OBJECT_STORAGE_WRITE_FAILED", "S3 object upload failed.", error);
    }
    const existing = await headStoredObject(settings, input.bucket, input.key);
    if (
      !existing ||
      existing.size_bytes !== input.content.byteLength ||
      existing.sha256 !== input.sha256
    ) {
      throw new ObjectStorageBackendError(
        "OBJECT_STORAGE_CONFLICT",
        "The S3 object key already contains different content.",
      );
    }
  }
  return {
    bucket: input.bucket,
    key: input.key,
    size_bytes: input.content.byteLength,
    sha256: input.sha256,
    content_type: input.contentType,
    original_filename: input.originalFilename,
  };
}

export async function headStoredObject(
  settings: ObjectStorageSettings,
  bucket: string,
  key: string,
): Promise<StoredObjectDescriptor | null> {
  assertObjectCoordinates(settings, bucket, key);
  if (mode(settings) === "local") {
    return headLocal(settings, bucket, key);
  }
  try {
    const response = await s3Client(settings).send(new HeadObjectCommand({
      Bucket: physicalS3Bucket(settings, bucket),
      Key: key,
    }));
    return {
      bucket,
      key,
      size_bytes: response.ContentLength ?? 0,
      sha256: normalizeSha256Metadata(response.Metadata?.sha256),
      content_type: response.ContentType ?? null,
      original_filename: decodeFilename(response.Metadata?.["original-filename"]),
    };
  } catch (error) {
    if (isNotFound(error)) {
      if (settings.localFallbackRead) return headLocal(settings, bucket, key);
      return null;
    }
    throw storageFailure("OBJECT_STORAGE_HEAD_FAILED", "S3 object metadata lookup failed.", error);
  }
}

export async function readStoredObject(
  settings: ObjectStorageSettings,
  bucket: string,
  key: string,
): Promise<StoredObject> {
  assertObjectCoordinates(settings, bucket, key);
  if (mode(settings) === "local") return readLocal(settings, bucket, key);
  try {
    const response = await s3Client(settings).send(new GetObjectCommand({
      Bucket: physicalS3Bucket(settings, bucket),
      Key: key,
    }));
    if (!response.Body) {
      throw new ObjectStorageBackendError(
        "OBJECT_STORAGE_READ_FAILED",
        "S3 returned an empty object body.",
      );
    }
    const content = await response.Body.transformToByteArray();
    return {
      bucket,
      key,
      content,
      size_bytes: content.byteLength,
      sha256: normalizeSha256Metadata(response.Metadata?.sha256) ?? sha256(content),
      content_type: response.ContentType ?? null,
      original_filename: decodeFilename(response.Metadata?.["original-filename"]),
    };
  } catch (error) {
    if (isNotFound(error) && settings.localFallbackRead) return readLocal(settings, bucket, key);
    if (error instanceof ObjectStorageBackendError) throw error;
    throw storageFailure("OBJECT_STORAGE_READ_FAILED", "S3 object read failed.", error);
  }
}

export async function listStoredObjects(
  settings: ObjectStorageSettings,
  bucket: string,
  prefix: string,
): Promise<StoredObjectDescriptor[]> {
  assertObjectCoordinates(settings, bucket, prefix || "prefix");
  if (mode(settings) === "local") return listLocal(settings, bucket, prefix);
  const result: StoredObjectDescriptor[] = [];
  let continuationToken: string | undefined;
  try {
    do {
      const response = await s3Client(settings).send(new ListObjectsV2Command({
        Bucket: physicalS3Bucket(settings, bucket),
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }));
      for (const item of response.Contents ?? []) {
        if (!item.Key) continue;
        result.push({
          bucket,
          key: item.Key,
          size_bytes: item.Size ?? 0,
          sha256: null,
          content_type: null,
          original_filename: null,
        });
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
    return result;
  } catch (error) {
    throw storageFailure("OBJECT_STORAGE_LIST_FAILED", "S3 object listing failed.", error);
  }
}

export async function deleteStoredObject(
  settings: ObjectStorageSettings,
  bucket: string,
  key: string,
): Promise<void> {
  assertObjectCoordinates(settings, bucket, key);
  if (mode(settings) === "local") {
    await unlink(localPath(settings, bucket, key)).catch((error) => {
      if (!isNotFound(error)) throw error;
    });
    return;
  }
  try {
    await s3Client(settings).send(new DeleteObjectCommand({
      Bucket: physicalS3Bucket(settings, bucket),
      Key: key,
    }));
  } catch (error) {
    throw storageFailure("OBJECT_STORAGE_DELETE_FAILED", "S3 object deletion failed.", error);
  }
}

export async function checkObjectStorageReadiness(settings: ObjectStorageSettings): Promise<void> {
  if (mode(settings) === "local") {
    const rootStat = await stat(settings.objectStorageRoot);
    if (!rootStat.isDirectory()) throw new Error("Local object storage root is not a directory.");
    return;
  }
  try {
    await s3Client(settings).send(new HeadBucketCommand({ Bucket: settings.bucket }));
  } catch (error) {
    throw storageFailure("OBJECT_STORAGE_NOT_READY", "S3 bucket is not ready.", error);
  }
}

function mode(settings: ObjectStorageSettings): ObjectStorageMode {
  return settings.storageMode ?? "local";
}

function s3Client(settings: ObjectStorageSettings): S3Client {
  if (!settings.s3Endpoint || !settings.s3AccessKeyId || !settings.s3SecretAccessKey) {
    throw new ObjectStorageBackendError(
      "S3_CONFIGURATION_INCOMPLETE",
      "S3 endpoint and credentials are required.",
    );
  }
  const cacheKey = JSON.stringify([
    settings.s3Endpoint,
    settings.s3Region ?? "us-east-1",
    settings.s3ForcePathStyle ?? true,
    settings.s3AccessKeyId,
  ]);
  let client = clients.get(cacheKey);
  if (!client) {
    client = new S3Client({
      endpoint: settings.s3Endpoint,
      region: settings.s3Region ?? "us-east-1",
      forcePathStyle: settings.s3ForcePathStyle ?? true,
      credentials: {
        accessKeyId: settings.s3AccessKeyId,
        secretAccessKey: settings.s3SecretAccessKey,
      },
      maxAttempts: 3,
    });
    clients.set(cacheKey, client);
  }
  return client;
}

async function headLocal(
  settings: ObjectStorageSettings,
  bucket: string,
  key: string,
): Promise<StoredObjectDescriptor | null> {
  const target = localPath(settings, bucket, key);
  const item = await stat(target).catch((error) => {
    if (isNotFound(error)) return null;
    throw error;
  });
  if (!item?.isFile()) return null;
  return {
    bucket,
    key,
    size_bytes: item.size,
    sha256: null,
    content_type: null,
    original_filename: path.posix.basename(key),
  };
}

async function readLocal(
  settings: ObjectStorageSettings,
  bucket: string,
  key: string,
): Promise<StoredObject> {
  try {
    const content = await readFile(localPath(settings, bucket, key));
    return {
      bucket,
      key,
      content,
      size_bytes: content.byteLength,
      sha256: sha256(content),
      content_type: null,
      original_filename: path.posix.basename(key),
    };
  } catch (error) {
    if (isNotFound(error)) {
      throw new ObjectStorageBackendError("OBJECT_STORAGE_NOT_FOUND", "Object was not found.", error);
    }
    throw storageFailure("OBJECT_STORAGE_READ_FAILED", "Local object read failed.", error);
  }
}

async function listLocal(
  settings: ObjectStorageSettings,
  bucket: string,
  prefix: string,
): Promise<StoredObjectDescriptor[]> {
  const bucketRoot = localPath(settings, bucket, "prefix");
  const root = path.join(path.dirname(bucketRoot), ...prefix.split("/").filter(Boolean));
  const result: StoredObjectDescriptor[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if (isNotFound(error)) return [];
      throw error;
    });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      if (!entry.isFile()) continue;
      const item = await stat(absolute);
      result.push({
        bucket,
        key: path.relative(path.join(settings.objectStorageRoot, bucket), absolute).split(path.sep).join("/"),
        size_bytes: item.size,
        sha256: null,
        content_type: null,
        original_filename: entry.name,
      });
    }
  }
  await visit(root);
  return result;
}

function localPath(settings: ObjectStorageSettings, bucket: string, key: string): string {
  const root = path.resolve(settings.objectStorageRoot);
  const target = path.resolve(root, bucket, ...key.split("/"));
  if (target === root || !target.startsWith(`${root}${path.sep}`)) {
    throw new ObjectStorageBackendError("OBJECT_STORAGE_PATH_FORBIDDEN", "Object path escapes storage root.");
  }
  return target;
}

function assertObjectCoordinates(settings: ObjectStorageSettings, bucket: string, key: string): void {
  if (!bucket || (bucket !== settings.bucket && !(settings.legacyBuckets ?? []).includes(bucket))) {
    throw new ObjectStorageBackendError("OBJECT_STORAGE_BUCKET_FORBIDDEN", "Object bucket is not allowed.");
  }
  if (!key || key.includes("\0") || key.startsWith("/") || key.split("/").includes("..")) {
    throw new ObjectStorageBackendError("OBJECT_STORAGE_KEY_INVALID", "Object key is invalid.");
  }
}

function physicalS3Bucket(settings: ObjectStorageSettings, logicalBucket: string): string {
  return logicalBucket === settings.bucket ? logicalBucket : settings.bucket;
}

function secretValue(value: string | undefined, file: string | undefined, fileKey: string): string | undefined {
  if (file) {
    try {
      const result = readFileSync(file, "utf8").trim();
      if (!result) throw new Error("empty secret file");
      return result;
    } catch (error) {
      throw new ObjectStorageBackendError("S3_SECRET_FILE_INVALID", `${fileKey} could not be read.`, error);
    }
  }
  return value?.trim() || undefined;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseCsv(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(",").map((item) => item.trim()).filter(Boolean))];
}

type ReturnTypeShape = Pick<
  ObjectStorageSettings,
  | "storageMode"
  | "s3Endpoint"
  | "s3Region"
  | "s3ForcePathStyle"
  | "s3AccessKeyId"
  | "s3SecretAccessKey"
  | "localFallbackRead"
  | "legacyBuckets"
>;

function normalizeSha256Metadata(value: string | undefined): string | null {
  if (!value) return null;
  return value.startsWith("sha256:") ? value : `sha256:${value}`;
}

function decodeFilename(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function sha256(content: Uint8Array): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function storageFailure(code: string, message: string, cause: unknown): ObjectStorageBackendError {
  return new ObjectStorageBackendError(code, message, cause);
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = "$metadata" in error
    ? (error as Error & { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
    : undefined;
  return status === 404 || ("code" in error && error.code === "ENOENT") || error.name === "NotFound" || error.name === "NoSuchKey";
}

function isPreconditionFailed(error: unknown): boolean {
  if (!(error instanceof Error) || !("$metadata" in error)) return false;
  return (error as Error & { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 412;
}
