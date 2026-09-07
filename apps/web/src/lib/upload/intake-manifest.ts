import { createHash, createHmac } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { putStoredObject } from "@/lib/storage/object-storage";
import type { UploadSettings, UploadTokenPayload } from "@/lib/upload/preflight";

export const INTAKE_MANIFEST_PREFIX = ".intake/manifests/";
const DOMAIN = "akb-intake-manifest-1\0";

/** Durable identity, not an upload credential. Never include policy, actor or token. */
export function createIntakeManifest(payload: UploadTokenPayload, signingSecret: string): string {
  const encoded = Buffer.from(JSON.stringify({
    schema_version: "akb-intake-manifest-1",
    kid: createHash("sha256").update(signingSecret).digest("hex").slice(0, 16),
    session_id: payload.session_id,
    document_id: payload.document_id,
    bucket: payload.bucket,
    object_key: payload.object_key,
    source_file_uri: payload.source_file_uri,
    file_name: payload.file_name,
    file_size: payload.file_size,
    sha256: payload.sha256,
    expires_at: payload.expires_at,
  }), "utf8").toString("base64url");
  const signature = createHmac("sha256", signingSecret).update(DOMAIN + encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

/** Persist both crash-recovery locations before any quarantine bytes are written. */
export async function persistIntakeManifest(payload: UploadTokenPayload, settings: UploadSettings): Promise<void> {
  const content = Buffer.from(createIntakeManifest(payload, settings.signingSecret), "utf8");
  const root = path.resolve(settings.quarantineRoot ?? settings.objectStorageRoot);
  if (!/^upl_[a-f0-9]{32}$/.test(payload.session_id)) throw new Error("Invalid intake manifest session");
  const directory = path.join(root, "manifests");
  await persistLocalManifest(directory, `${payload.session_id}.manifest`, content);
  if (settings.storageMode !== "s3") {
    await persistLocalManifest(path.join(settings.objectStorageRoot, payload.bucket, INTAKE_MANIFEST_PREFIX), `${payload.session_id}.manifest`, content);
    return;
  }
  await putStoredObject(settings, {
    bucket: payload.bucket,
    key: `${INTAKE_MANIFEST_PREFIX}${payload.session_id}.manifest`,
    content,
    sha256: `sha256:${createHash("sha256").update(content).digest("hex")}`,
    contentType: "application/octet-stream",
    originalFilename: `${payload.session_id}.manifest`,
  });
}

async function persistLocalManifest(directory: string, filename: string, content: Buffer): Promise<void> {
  const firstCreated = await mkdir(directory, { recursive: true, mode: 0o750 });
  const target = path.join(directory, filename);
  let file;
  try {
    file = await open(target, "wx", 0o640);
    await file.writeFile(content);
    await file.sync();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (!(await readFile(target)).equals(content)) throw new Error("Intake manifest identity conflict");
  } finally {
    await file?.close();
  }
  const folder = await open(directory, "r");
  try { await folder.sync(); } finally { await folder.close(); }
  // Sync only newly created directory entries and their first existing parent.
  if (firstCreated) {
    const stop = path.dirname(firstCreated);
    for (let ancestor = path.dirname(directory); ; ancestor = path.dirname(ancestor)) {
      const parent = await open(ancestor, "r");
      try { await parent.sync(); } finally { await parent.close(); }
      if (ancestor === stop || ancestor === path.dirname(ancestor)) break;
    }
  }
}
