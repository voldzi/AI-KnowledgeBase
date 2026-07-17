import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { retryCurrentGovernedIngestionAttempt } from "@/lib/ingestion/governed-operations";
import { ingestionServiceRequestContext } from "@/lib/ingestion/service-identity";
import { createDefaultInformationPolicy } from "@/lib/stratos/information-policy";
import {
  createUploadPreflightDecision,
  getUploadSettings,
  persistUploadedObject,
  validateUploadFileMetadata,
} from "@/lib/upload/preflight";
import type {
  ApiClients,
  ApiRequestContext,
  Document,
  DocumentVersion,
  IngestionJob,
} from "@/lib/types";

import { publicSourceCollection } from "./catalog";
import { assertCzechLawOpenDataSourceUrl, assertPublicSourceUrl } from "./discovery";

const MAX_REDIRECTS = 5;
const DOWNLOAD_TIMEOUT_MS = 45_000;
const PUBLIC_SOURCE_TAG = "official-public-reference";

export interface PublicSourceSyncRequest {
  collectionId: string;
  sourceUrl: string;
  canonicalUrl?: string;
  title: string;
}

export interface PublicSourceSyncResult {
  action: "created" | "updated" | "unchanged";
  document: Document;
  version: DocumentVersion;
  job: IngestionJob | null;
  sourceUrl: string;
  sha256: string;
}

export async function synchronizePublicSource(
  input: PublicSourceSyncRequest,
  clients: ApiClients,
  context: ApiRequestContext,
  fetcher: typeof fetch = fetch,
  transportContextFactory: (correlationId: string) => Promise<ApiRequestContext> = ingestionServiceRequestContext,
): Promise<PublicSourceSyncResult> {
  const collection = publicSourceCollection(input.collectionId);
  if (!collection) throw new Error("Unknown public source collection.");
  const sourceUrl = assertPublicSourceUrl(collection.id, input.sourceUrl);
  if (collection.id === "czech-law") assertCzechLawOpenDataSourceUrl(sourceUrl);
  const canonicalUrl = assertPublicSourceUrl(
    collection.id,
    input.canonicalUrl || input.sourceUrl,
  );
  const downloaded = await downloadOfficialDocument(sourceUrl, collection.id, fetcher);
  const stableId = officialSourceStableId(collection.id, canonicalUrl.toString());
  const stableTag = `official-source-id:${stableId}`;
  const existing = await clients.registry.listDocuments(context, { tag: stableTag });
  if (existing.length > 1) {
    throw new Error("The official source identity resolves to multiple AKB documents.");
  }

  const document = existing[0] ?? await createOfficialDocument(
    input,
    collection,
    canonicalUrl,
    stableTag,
    clients,
    context,
  );
  const versions = await clients.registry.listDocumentVersions(document.document_id, context);
  const sameVersion = versions[0]?.file_hash === downloaded.sha256 ? versions[0] : null;
  if (sameVersion) {
    if (sameVersion.status !== "valid" || document.status !== "valid") {
      await approveAndPublishOfficialVersion(document, sameVersion, clients, context);
    }
    const effectiveDocument = document.status === "valid"
      ? document
      : { ...document, status: "valid" as const };
    const effectiveVersion = sameVersion.status === "valid"
      ? sameVersion
      : { ...sameVersion, status: "valid" as const };
    const currentAttempt = await clients.registry.getDocumentIngestionAttempt(
      document.document_id,
      context,
    );
    let job: IngestionJob | null = null;
    if (
      currentAttempt?.document_version_id === sameVersion.document_version_id
      && currentAttempt.ingestion_status === "FAILED"
    ) {
      const retried = await retryCurrentGovernedIngestionAttempt(
        clients,
        context,
        document.document_id,
        `official-source-${randomUUID()}`,
        { transportContextFactory },
      );
      job = retried.job;
    } else if (currentAttempt?.document_version_id === sameVersion.document_version_id) {
      job = ingestionJobProjection(currentAttempt);
    } else {
      job = await createIngestionJob(
        effectiveDocument,
        effectiveVersion,
        clients,
        context,
        transportContextFactory,
      );
    }
    return {
      action: "unchanged",
      document: effectiveDocument,
      version: effectiveVersion,
      job,
      sourceUrl: sourceUrl.toString(),
      sha256: downloaded.sha256,
    };
  }

  const uploadSettings = getUploadSettings();
  const file = validateUploadFileMetadata(
    {
      file_name: downloaded.filename,
      file_size: downloaded.bytes.byteLength,
      file_type: downloaded.mimeType,
      sha256: downloaded.sha256,
    },
    uploadSettings,
  );
  const preflight = createUploadPreflightDecision(
    {
      document_id: document.document_id,
      file_name: file.file_name,
      file_size: file.file_size,
      file_type: file.file_type,
      sha256: file.sha256,
      policy_binding_id: document.policy_binding_id,
      policy_version: document.policy_version,
      policy_hash: document.policy_hash,
    },
    uploadSettings,
  );
  await persistUploadedObject(
    {
      session_id: preflight.upload_session_id,
      document_id: document.document_id,
      bucket: preflight.bucket,
      object_key: preflight.object_key,
      source_file_uri: preflight.source_file_uri,
      file_name: preflight.file.filename,
      file_size: preflight.file.size_bytes,
      file_type: preflight.file.mime_type,
      sha256: preflight.file.sha256,
      expires_at: preflight.expires_at,
      policy_binding_id: preflight.policy_binding_id,
      policy_version: preflight.policy_version,
      policy_hash: preflight.policy_hash,
      external_document_id: null,
      expected_current_document_version_id: null,
      governed_document_resource_id: null,
      source_governed_resource_id: null,
      source_resource_id: null,
      source_version: null,
      governance_scope: null,
      governance_actor_subject_id: null,
      governance_registered_by_subject_id: null,
      governance_correlation_id: null,
      governance_idempotency_key: null,
    },
    downloaded.bytes,
    uploadSettings,
  );

  const capturedAt = new Date().toISOString();
  const version = await clients.registry.createDocumentVersion(
    document.document_id,
    {
      version_label: sourceVersionLabel(downloaded, capturedAt),
      valid_from: capturedAt.slice(0, 10),
      valid_to: null,
      source_file_uri: preflight.source_file_uri,
      source_location: {
        kind: "url",
        uri: sourceUrl.toString(),
        display_url: canonicalUrl.toString(),
        file_name: downloaded.filename,
        content_type: downloaded.mimeType,
        sha256: downloaded.sha256,
        captured_at: capturedAt,
        version: downloaded.etag ?? downloaded.lastModified ?? downloaded.sha256,
      },
      file_hash: downloaded.sha256,
      change_summary: versions.length === 0
        ? "První automaticky zachycená verze oficiálního veřejného zdroje."
        : "Nová verze oficiálního veřejného zdroje zjištěná změnou obsahu.",
      file: {
        filename: downloaded.filename,
        mime_type: downloaded.mimeType,
        size_bytes: downloaded.bytes.byteLength,
        sha256: downloaded.sha256,
        uploaded_by: context.subjectId,
      },
    },
    context,
  );

  await approveAndPublishOfficialVersion(document, version, clients, context);
  const job = await createIngestionJob(
    document,
    version,
    clients,
    context,
    transportContextFactory,
  );
  return {
    action: existing.length === 0 ? "created" : "updated",
    document: { ...document, status: "valid" },
    version: { ...version, status: "valid" },
    job,
    sourceUrl: sourceUrl.toString(),
    sha256: downloaded.sha256,
  };
}

async function createOfficialDocument(
  input: PublicSourceSyncRequest,
  collection: NonNullable<ReturnType<typeof publicSourceCollection>>,
  canonicalUrl: URL,
  stableTag: string,
  clients: ApiClients,
  context: ApiRequestContext,
): Promise<Document> {
  const title = normalizeDocumentTitle(input.title, canonicalUrl);
  const policy = createDefaultInformationPolicy({
    classification: "public",
    ownerSubjectId: context.subjectId,
    contentCategories: ["PUBLIC_INFORMATION"],
  });
  return clients.registry.createDocument(
    {
      title,
      document_type: collection.documentType,
      owner_id: context.subjectId,
      gestor_unit: `Veřejné zdroje · ${collection.authority}`.slice(0, 128),
      classification: "public",
      information_policy: policy,
      tags: [
        PUBLIC_SOURCE_TAG,
        stableTag,
        `official-source-collection:${collection.id}`,
        collection.topic,
      ],
      metadata: {
        source_model: "official-public-reference-v1",
        source_public: true,
        audience: "organization",
        anonymous_publication: false,
        collection_id: collection.id,
        authority: collection.authority,
        canonical_url: canonicalUrl.toString(),
        license_note: collection.licenseNote,
        lifecycle: "CURRENT",
        collection_approved_by: context.subjectId,
        collection_approved_at: new Date().toISOString(),
      },
      assignments: [
        {
          role: "owner",
          subject_type: "user",
          subject_id: context.subjectId,
          display_label: context.subjectId,
          is_primary: true,
          active: true,
          metadata: { source: "official-public-reference-v1" },
        },
        {
          role: "approver",
          subject_type: "user",
          subject_id: context.subjectId,
          display_label: context.subjectId,
          is_primary: true,
          active: true,
          metadata: { source: "collection-level-approval" },
        },
      ],
      access_policies: [
        {
          subjects: ["role:reader", "role:stratos_user", "role:document_manager", "role:admin"],
          actions: ["document.read", "rag.query"],
          constraints: { classification_max: "public", valid_only: true },
        },
        {
          subjects: [`user:${context.subjectId}`, "role:document_manager", "role:admin", "role:service_ingestion"],
          actions: [
            "document.update",
            "document.read",
            "document.ingest",
            "document.reindex",
            "document.version.create",
            "document.version.publish",
            "document.version.archive",
          ],
          constraints: { classification_max: "public" },
        },
      ],
    },
    context,
  );
}

async function approveAndPublishOfficialVersion(
  document: Document,
  version: DocumentVersion,
  clients: ApiClients,
  context: ApiRequestContext,
): Promise<void> {
  await clients.registry.updateDocument(
    document.document_id,
    { status: "review" },
    context,
  );
  await clients.registry.updateDocument(
    document.document_id,
    { status: "approved" },
    context,
  );
  await clients.registry.publishDocumentVersion(
    document.document_id,
    version.document_version_id,
    context,
  );
}

async function createIngestionJob(
  document: Document,
  version: DocumentVersion,
  clients: ApiClients,
  context: ApiRequestContext,
  transportContextFactory: (correlationId: string) => Promise<ApiRequestContext>,
): Promise<IngestionJob> {
  const currentAttempt = await clients.registry.getDocumentIngestionAttempt(
    document.document_id,
    context,
  );
  const idempotencyKey = `official-source:${version.document_version_id}`;
  const correlationId = context.correlationId ?? context.requestId ?? randomUUID();
  const actorContext = { ...context, requestId: correlationId, correlationId };
  const authorization = await clients.registry.createIngestionAuthorization(
    document.document_id,
    version.document_version_id,
    {
      action: "document.ingest",
      correlation_id: correlationId,
      idempotency_key: idempotencyKey,
    },
    actorContext,
  );
  const transportContext = await transportContextFactory(correlationId);
  return clients.ingestion.createJob(
    {
      idempotency_key: idempotencyKey,
      document_id: document.document_id,
      document_version_id: version.document_version_id,
      source_file_uri: version.source_file_uri,
      parser_profile: "controlled_document",
      ocr_enabled: true,
      chunking_strategy: "legal_structured",
      embedding_profile: "default",
      expected_current_ingestion_job_id: currentAttempt?.ingestion_job_id ?? null,
    },
    transportContext,
    {
      delegatedActorSubjectId: authorization.confirmed_subject_id,
      authorizationToken: authorization.authorization_token,
    },
  );
}

interface DownloadedOfficialDocument {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
  sha256: string;
  etag: string | null;
  lastModified: string | null;
}

async function downloadOfficialDocument(
  input: URL,
  collectionId: string,
  fetcher: typeof fetch,
): Promise<DownloadedOfficialDocument> {
  let current = assertPublicSourceUrl(collectionId, input.toString());
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetcher(current, {
      headers: {
        Accept: collectionId === "czech-law"
          ? "application/sparql-results+json,application/ld+json,application/json;q=0.9"
          : "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword;q=0.8,*/*;q=0.1",
        "User-Agent": "STRATOS-AKB-Public-Sources/1.0 (+https://stratos.zeleznalady.cz/akb)",
      },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Official source returned a redirect without Location.");
      current = assertPublicSourceUrl(collectionId, new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Official source download returned HTTP ${response.status}.`);
    const maxBytes = getUploadSettings().maxFileBytes;
    const declaredSize = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
      throw new Error("Official document exceeds the AKB upload limit.");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
      throw new Error("Official document is empty or exceeds the AKB upload limit.");
    }
    const mimeType = normalizeOfficialMimeType(
      response.headers.get("content-type"),
      bytes,
      collectionId === "czech-law",
    );
    if (collectionId === "czech-law") assertCzechLawSparqlPayload(bytes);
    const filename = officialFilename(
      response.headers.get("content-disposition"),
      current,
      mimeType,
      collectionId,
    );
    const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    return {
      bytes,
      filename,
      mimeType,
      sha256,
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
    };
  }
  throw new Error("Official source exceeded the redirect limit.");
}

function normalizeOfficialMimeType(
  value: string | null,
  bytes: Uint8Array,
  allowJson: boolean,
): string {
  const declared = value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (startsWithAscii(bytes, "%PDF-")) return "application/pdf";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (declared === "application/msword") return declared;
  const firstContentByte = bytes.find((value) => ![0x09, 0x0a, 0x0d, 0x20].includes(value));
  if (
    allowJson
    && ["application/json", "application/ld+json", "application/sparql-results+json"].includes(declared)
    && (firstContentByte === 0x7b || firstContentByte === 0x5b)
  ) {
    return "application/json";
  }
  throw new Error("Official source did not return a supported PDF, Word or approved open-data JSON original.");
}

function assertCzechLawSparqlPayload(bytes: Uint8Array): void {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("The e-Sbírka open-data response is not valid UTF-8 JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The e-Sbírka open-data response has an unsupported shape.");
  }
  const results = (value as { results?: unknown }).results;
  const bindings = results && typeof results === "object" && !Array.isArray(results)
    ? (results as { bindings?: unknown }).bindings
    : null;
  if (
    !Array.isArray(bindings)
    || bindings.length === 0
    || bindings.some((binding) => {
      if (!binding || typeof binding !== "object" || Array.isArray(binding)) return true;
      const text = (binding as { text?: unknown }).text;
      return !text
        || typeof text !== "object"
        || Array.isArray(text)
        || typeof (text as { value?: unknown }).value !== "string";
    })
  ) {
    throw new Error("The e-Sbírka open-data response contains no valid legal fragments.");
  }
}

function officialFilename(
  contentDisposition: string | null,
  url: URL,
  mimeType: string,
  collectionId: string,
): string {
  const encoded = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = contentDisposition?.match(/filename="?([^";]+)"?/i)?.[1];
  let filename = encoded ? decodeURIComponent(encoded) : plain;
  if (!filename && collectionId === "czech-law") {
    filename = czechLawOpenDataFilename(url) ?? undefined;
  }
  if (!filename) filename = decodeURIComponent(url.pathname.split("/").pop() || "official-document");
  filename = filename.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim();
  const extension = mimeType === "application/pdf"
    ? ".pdf"
    : mimeType === "application/json"
      ? ".json"
      : ".docx";
  if (!/\.(pdf|docx|doc|json)$/i.test(filename)) filename += extension;
  return filename.slice(0, 300);
}

function czechLawOpenDataFilename(url: URL): string | null {
  const query = url.searchParams.get("query") ?? "";
  const match = query.match(/\/eli\/cz\/sb\/(\d{4})\/(\d+)\/(\d{4}-\d{2}-\d{2})>/);
  return match ? `sb-${match[1]}-${match[2]}-${match[3]}.json` : null;
}

function sourceVersionLabel(downloaded: DownloadedOfficialDocument, capturedAt: string): string {
  const sourceDate = downloaded.lastModified ? new Date(downloaded.lastModified) : new Date(capturedAt);
  const date = Number.isFinite(sourceDate.getTime())
    ? sourceDate.toISOString().slice(0, 10)
    : capturedAt.slice(0, 10);
  return `${date}-${downloaded.sha256.slice(-12)}`;
}

function normalizeDocumentTitle(value: string, url: URL): string {
  const title = value.replace(/\s+/g, " ").trim();
  if (title) return title.slice(0, 300);
  return decodeURIComponent(url.pathname.split("/").pop() || "Oficiální veřejný dokument")
    .replace(/\.(pdf|docx|doc)$/i, "")
    .replace(/[-_]+/g, " ")
    .slice(0, 300);
}

function officialSourceStableId(collectionId: string, canonicalUrl: string): string {
  return createHash("sha256").update(`${collectionId}\n${canonicalUrl}`).digest("hex").slice(0, 24);
}

function startsWithAscii(bytes: Uint8Array, value: string): boolean {
  return [...value].every((character, index) => bytes[index] === character.charCodeAt(0));
}

function ingestionJobProjection(
  attempt: NonNullable<Awaited<ReturnType<ApiClients["registry"]["getDocumentIngestionAttempt"]>>>,
): IngestionJob {
  const status = {
    QUEUED: "queued",
    INGESTING: "running",
    INDEXED: "completed",
    FAILED: "failed",
  }[attempt.ingestion_status] as IngestionJob["status"];
  return {
    job_id: attempt.ingestion_job_id,
    status,
    document_id: attempt.document_id,
    document_version_id: attempt.document_version_id,
    parser_profile: "controlled_document",
    ocr_enabled: true,
    chunking_strategy: "legal_structured",
    embedding_profile: "default",
    created_at: attempt.created_at,
    started_at: null,
    finished_at: status === "completed" || status === "failed" ? attempt.updated_at : null,
  };
}
