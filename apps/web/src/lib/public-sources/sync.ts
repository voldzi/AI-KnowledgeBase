import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { retryCurrentGovernedIngestionAttempt } from "@/lib/ingestion/governed-operations";
import { ingestionServiceRequestContext } from "@/lib/ingestion/service-identity";
import { createDefaultInformationPolicy } from "@/lib/stratos/information-policy";
import {
  createUploadPreflightDecision,
  getUploadSettings,
  validateUploadFileMetadata,
  verifyUploadToken,
} from "@/lib/upload/preflight";
import {
  acceptDocumentIntakeBytes,
  applyDocumentIntakeSettings,
} from "@/lib/upload/document-intake";
import type {
  ApiClients,
  ApiRequestContext,
  Document,
  DocumentVersion,
  IngestionJob,
} from "@/lib/types";

import { publicSourceCollection } from "./catalog";
import { assertCzechLawSourceUrl, assertPublicSourceUrl } from "./discovery";

const MAX_REDIRECTS = 5;
const DOWNLOAD_TIMEOUT_MS = 45_000;
const DOWNLOAD_ATTEMPTS = 2;
const PUBLIC_SOURCE_TAG = "official-public-reference";
const E_SBIRKA_PUBLIC_ORIGIN = "https://e-sbirka.gov.cz";
const E_SBIRKA_ASYNC_POLL_ATTEMPTS = 24;
const E_SBIRKA_ASYNC_POLL_INTERVAL_MS = 500;

export interface PublicSourceSyncRequest {
  collectionId: string;
  sourceUrl: string;
  canonicalUrl?: string;
  title: string;
  versionLabel?: string;
  effectiveFrom?: string;
  effectiveTo?: string | null;
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
  const legalVersion = collection.id === "czech-law"
    ? assertCzechLawSourceUrl(sourceUrl)
    : null;
  const effectiveFrom = legalVersion?.effectiveDate ?? input.effectiveFrom;
  const effectiveTo = effectiveFrom ? (input.effectiveTo ?? null) : input.effectiveTo;
  assertTemporalVersionInput({
    effectiveFrom,
    effectiveTo,
    expectedEffectiveFrom: legalVersion?.effectiveDate,
  });
  const canonicalUrl = assertPublicSourceUrl(
    collection.id,
    input.canonicalUrl || input.sourceUrl,
  );
  const downloaded = await downloadOfficialDocument(sourceUrl, collection, fetcher);
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
  const currentVersion = versions[0] ?? null;
  const sameContent = currentVersion?.file_hash === downloaded.sha256;
  const sameVersion = versions.find((version) => (
    version.file_hash === downloaded.sha256
    && currentVersionMatchesDownloadMetadata(version, downloaded)
    && (
      !effectiveFrom
      || (
        version.valid_from === effectiveFrom
        && version.valid_to === effectiveTo
      )
    )
  )) ?? null;
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

  const uploadSettings = applyDocumentIntakeSettings(getUploadSettings());
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
      purpose: "official-public-source-sync",
    },
    uploadSettings,
  );
  const uploadToken = preflight.required_headers["X-AKL-Upload-Token"];
  if (!uploadToken) {
    throw new Error("Official source intake did not issue an upload token.");
  }
  const acceptedUpload = await acceptDocumentIntakeBytes({
    content: downloaded.bytes,
    sessionId: preflight.upload_session_id,
    uploadToken,
    payload: verifyUploadToken(uploadToken, uploadSettings),
    settings: uploadSettings,
  });

  const capturedAt = new Date().toISOString();
  const metadataCorrection = sameContent && currentVersion !== null;
  const version = await clients.registry.createDocumentVersion(
    document.document_id,
    {
      version_label: uniqueSourceVersionLabel(downloaded, capturedAt, versions),
      valid_from: effectiveFrom ?? capturedAt.slice(0, 10),
      valid_to: effectiveTo ?? null,
      source_file_uri: preflight.source_file_uri,
      source_location: {
        kind: "url",
        uri: sourceUrl.toString(),
        display_url: canonicalUrl.toString(),
        file_name: downloaded.filename,
        content_type: downloaded.mimeType,
        sha256: downloaded.sha256,
        captured_at: capturedAt,
        version: input.versionLabel
          ?? effectiveFrom
          ?? downloaded.etag
          ?? downloaded.lastModified
          ?? downloaded.sha256,
      },
      file_hash: downloaded.sha256,
      change_summary: metadataCorrection
        ? "Opravná neměnná verze se správným názvem a typem původního souboru."
        : versions.length === 0
          ? "První automaticky zachycená verze oficiálního veřejného zdroje."
          : effectiveFrom
            ? `Oficiální znění účinné od ${effectiveFrom}${effectiveTo ? ` do ${effectiveTo}` : " dosud"}.`
            : "Nová verze oficiálního veřejného zdroje zjištěná změnou obsahu.",
      file: {
        filename: downloaded.filename,
        mime_type: downloaded.mimeType,
        size_bytes: downloaded.bytes.byteLength,
        sha256: downloaded.sha256,
        uploaded_by: context.subjectId,
        intake_receipt: acceptedUpload.upload_receipt,
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
  collection: NonNullable<ReturnType<typeof publicSourceCollection>>,
  fetcher: typeof fetch,
): Promise<DownloadedOfficialDocument> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      return await downloadOfficialDocumentOnce(input, collection, fetcher);
    } catch (error) {
      lastError = error;
      if (attempt === DOWNLOAD_ATTEMPTS || !isRetryableOfficialDownloadError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

async function downloadOfficialDocumentOnce(
  input: URL,
  collection: NonNullable<ReturnType<typeof publicSourceCollection>>,
  fetcher: typeof fetch,
): Promise<DownloadedOfficialDocument> {
  const collectionId = collection.id;
  if (collectionId === "czech-law") {
    return downloadCzechLawOfficialPdf(input, collection, fetcher);
  }
  const allowHtml = collection.allowHtml === true || collectionId === "eu-law";
  let current = assertPublicSourceUrl(collectionId, input.toString());
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const maxBytes = getUploadSettings().maxFileBytes;
    const response = await fetcher(current, {
      headers: {
        Accept: collectionId === "eu-law"
            ? "application/xhtml+xml"
            : allowHtml
              ? "text/html,application/xhtml+xml,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;q=0.9,*/*;q=0.1"
              : "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/msword;q=0.8,*/*;q=0.1",
        ...(collectionId === "eu-law"
          ? {
              "Accept-Language": "ces",
              "Accept-Max-Cs-Size": String(maxBytes),
            }
          : {}),
        "User-Agent": "STRATOS-AKB-Public-Sources/1.0 (+https://stratos.zeleznalady.cz/akb)",
      },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Official source returned a redirect without Location.");
      const redirectUrl = new URL(location, current);
      if (
        collectionId === "eu-law"
        && redirectUrl.protocol === "http:"
        && redirectUrl.hostname === "publications.europa.eu"
      ) {
        redirectUrl.protocol = "https:";
      }
      current = assertPublicSourceUrl(collectionId, redirectUrl.toString());
      continue;
    }
    if (!response.ok) throw new Error(`Official source download returned HTTP ${response.status}.`);
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
      false,
      allowHtml,
    );
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

async function downloadCzechLawOfficialPdf(
  input: URL,
  collection: NonNullable<ReturnType<typeof publicSourceCollection>>,
  fetcher: typeof fetch,
): Promise<DownloadedOfficialDocument> {
  const source = assertPublicSourceUrl(collection.id, input.toString());
  const legalVersion = assertCzechLawSourceUrl(source);
  const stablePath = `/sb/${legalVersion.year}/${legalVersion.number}/${legalVersion.effectiveDate}`;
  const encodedStablePath = encodeURIComponent(stablePath);
  const linksUrl = new URL(
    `/sbr-externi/dokumenty-sbirky/${encodedStablePath}/odkazy-ke-stazeni`,
    E_SBIRKA_PUBLIC_ORIGIN,
  );
  const links = await fetchCzechLawJson(linksUrl, collection, fetcher);
  const documentId = positiveInteger(
    nestedValue(links, ["informativniZneni", "odkazPdf", "dokumentId"]),
    "The e-Sbírka download catalogue has no valid informative PDF.",
  );

  const prepareUrl = new URL(
    `/sbr-externi/stahni/informativni-zneni/${documentId}/PDF`,
    E_SBIRKA_PUBLIC_ORIGIN,
  );
  let prepared = await fetchCzechLawJson(prepareUrl, collection, fetcher);
  let state = stringValue(prepared, "stavPozadavku");
  const requestId = optionalIdentifier(prepared, "pozadavekId");
  for (
    let attempt = 0;
    state === "PROBIHA" && requestId && attempt < E_SBIRKA_ASYNC_POLL_ATTEMPTS;
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, E_SBIRKA_ASYNC_POLL_INTERVAL_MS));
    const statusUrl = new URL(
      `/souborove-sluzby/verejne-pozadavky-dokumenty/pozadavky/${requestId}`,
      E_SBIRKA_PUBLIC_ORIGIN,
    );
    prepared = await fetchCzechLawJson(statusUrl, collection, fetcher);
    state = stringValue(prepared, "stavPozadavku");
  }
  if (state !== "OK") {
    throw new Error(
      state === "PROBIHA"
        ? "The e-Sbírka informative PDF was not prepared before the timeout."
        : "The e-Sbírka informative PDF preparation failed.",
    );
  }
  const fileId = requiredIdentifier(prepared, "id");
  const fileUrl = new URL(`/souborove-sluzby/soubory/${fileId}`, E_SBIRKA_PUBLIC_ORIGIN);
  const response = await fetchCzechLawResponse(
    fileUrl,
    collection,
    fetcher,
    "application/pdf",
  );
  const maxBytes = getUploadSettings().maxFileBytes;
  const declaredSize = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    throw new Error("Official document exceeds the AKB upload limit.");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (
    bytes.byteLength === 0
    || bytes.byteLength > maxBytes
    || !startsWithAscii(bytes, "%PDF-")
  ) {
    throw new Error("The e-Sbírka download did not return a valid PDF within the AKB limit.");
  }
  const filename = officialFilename(
    response.headers.get("content-disposition"),
    fileUrl,
    "application/pdf",
    collection.id,
  );
  return {
    bytes,
    filename,
    mimeType: "application/pdf",
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
  };
}

async function fetchCzechLawJson(
  input: URL,
  collection: NonNullable<ReturnType<typeof publicSourceCollection>>,
  fetcher: typeof fetch,
): Promise<Record<string, unknown>> {
  const response = await fetchCzechLawResponse(
    input,
    collection,
    fetcher,
    "application/json",
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > 256 * 1024) {
    throw new Error("The e-Sbírka control response is empty or too large.");
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("The e-Sbírka control response is not valid UTF-8 JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The e-Sbírka control response has an unsupported shape.");
  }
  return value as Record<string, unknown>;
}

async function fetchCzechLawResponse(
  input: URL,
  collection: NonNullable<ReturnType<typeof publicSourceCollection>>,
  fetcher: typeof fetch,
  accept: string,
): Promise<Response> {
  const url = assertPublicSourceUrl(collection.id, input.toString());
  if (url.origin !== E_SBIRKA_PUBLIC_ORIGIN) {
    throw new Error("The e-Sbírka download step left the approved origin.");
  }
  const response = await fetcher(url, {
    headers: {
      Accept: accept,
      "User-Agent": "STRATOS-AKB-Public-Sources/1.0 (+https://stratos.zeleznalady.cz/akb)",
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Official source download returned HTTP ${response.status}.`);
  return response;
}

function nestedValue(value: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function positiveInteger(value: unknown, error: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(error);
  return Number(value);
}

function stringValue(value: Record<string, unknown>, key: string): string {
  const candidate = value[key];
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new Error(`The e-Sbírka response has no valid ${key}.`);
  }
  return candidate;
}

function optionalIdentifier(value: Record<string, unknown>, key: string): string | null {
  const candidate = value[key];
  return typeof candidate === "string" && /^[a-zA-Z0-9-]{1,128}$/.test(candidate)
    ? candidate
    : null;
}

function requiredIdentifier(value: Record<string, unknown>, key: string): string {
  const candidate = optionalIdentifier(value, key);
  if (!candidate) throw new Error(`The e-Sbírka response has no valid ${key}.`);
  return candidate;
}

function isRetryableOfficialDownloadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "TimeoutError" || /aborted due to timeout/i.test(error.message)) return true;
  const status = error.message.match(/HTTP (\d{3})/)?.[1];
  return status === "429" || (status !== undefined && Number(status) >= 500);
}

function normalizeOfficialMimeType(
  value: string | null,
  bytes: Uint8Array,
  allowJson: boolean,
  allowHtml: boolean,
): string {
  const declared = value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (startsWithAscii(bytes, "%PDF-")) return "application/pdf";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    const detected = detectOoxmlMimeType(bytes);
    if (detected) return detected;
  }
  if (declared === "application/msword") return declared;
  const firstContentByte = bytes.find((value) => ![0x09, 0x0a, 0x0d, 0x20].includes(value));
  if (
    allowHtml
    && ["application/xhtml+xml", "text/html"].includes(declared)
    && firstContentByte === 0x3c
  ) {
    return declared;
  }
  if (
    allowJson
    && ["application/json", "application/ld+json", "application/sparql-results+json"].includes(declared)
    && (firstContentByte === 0x7b || firstContentByte === 0x5b)
  ) {
    return "application/json";
  }
  throw new Error("Official source did not return a supported PDF, OOXML or approved open-data JSON original.");
}

function detectOoxmlMimeType(bytes: Uint8Array): string | null {
  const packageBytes = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (packageBytes.includes(Buffer.from("word/document.xml", "ascii"))) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (packageBytes.includes(Buffer.from("ppt/presentation.xml", "ascii"))) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (packageBytes.includes(Buffer.from("xl/workbook.xml", "ascii"))) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return null;
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
  const extensions = officialExtensions(mimeType);
  const currentExtension = filename.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "";
  if (!extensions.includes(currentExtension)) {
    filename = currentExtension
      ? filename.slice(0, -(currentExtension.length + 1)) + `.${extensions[0]}`
      : `${filename}.${extensions[0]}`;
  }
  return filename.slice(0, 300);
}

function officialExtensions(mimeType: string): readonly string[] {
  if (mimeType === "application/pdf") return ["pdf"];
  if (mimeType === "application/json") return ["json"];
  if (mimeType === "application/xhtml+xml") return ["xhtml"];
  if (mimeType === "text/html") return ["html", "htm"];
  if (mimeType === "application/msword") return ["doc"];
  if (mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
    return ["pptx"];
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    return ["xlsx"];
  }
  return ["docx"];
}

function czechLawOpenDataFilename(url: URL): string | null {
  const match = url.pathname.match(/\/sb\/(\d{4})\/(\d+)\/(\d{4}-\d{2}-\d{2})/);
  return match ? `sb-${match[1]}-${match[2]}-${match[3]}.pdf` : null;
}

function sourceVersionLabel(downloaded: DownloadedOfficialDocument, capturedAt: string): string {
  const sourceDate = downloaded.lastModified ? new Date(downloaded.lastModified) : new Date(capturedAt);
  const date = Number.isFinite(sourceDate.getTime())
    ? sourceDate.toISOString().slice(0, 10)
    : capturedAt.slice(0, 10);
  return `${date}-${downloaded.sha256.slice(-12)}`;
}

function uniqueSourceVersionLabel(
  downloaded: DownloadedOfficialDocument,
  capturedAt: string,
  versions: readonly DocumentVersion[],
): string {
  const base = sourceVersionLabel(downloaded, capturedAt);
  const labels = new Set(versions.map((version) => version.version_label));
  if (!labels.has(base)) return base;
  for (let revision = 1; revision <= 999; revision += 1) {
    const candidate = `${base}-r${revision}`;
    if (!labels.has(candidate)) return candidate;
  }
  throw new Error("Official source exhausted corrective version labels.");
}

function currentVersionMatchesDownloadMetadata(
  version: DocumentVersion,
  downloaded: DownloadedOfficialDocument,
): boolean {
  const sourceLocation = (version as DocumentVersion & {
    source_location?: {
      file_name?: string | null;
      content_type?: string | null;
      sha256?: string | null;
    } | null;
  }).source_location;
  return sourceLocation?.file_name === downloaded.filename
    && sourceLocation.content_type === downloaded.mimeType
    && sourceLocation.sha256 === downloaded.sha256;
}

function assertTemporalVersionInput({
  effectiveFrom,
  effectiveTo,
  expectedEffectiveFrom,
}: {
  effectiveFrom?: string;
  effectiveTo?: string | null;
  expectedEffectiveFrom?: string;
}): void {
  if (!effectiveFrom && effectiveTo) {
    throw new Error("Temporal source version requires an effective-from date.");
  }
  if (effectiveFrom && !isIsoDate(effectiveFrom)) {
    throw new Error("Effective-from must be a valid ISO date.");
  }
  if (effectiveTo && !isIsoDate(effectiveTo)) {
    throw new Error("Effective-to must be a valid ISO date.");
  }
  if (expectedEffectiveFrom && effectiveFrom !== expectedEffectiveFrom) {
    throw new Error("The requested effective date does not match the official e-Sbírka version.");
  }
  if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) {
    throw new Error("Effective-to cannot precede effective-from.");
  }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}


function normalizeDocumentTitle(value: string, url: URL): string {
  const title = value.replace(/\s+/g, " ").trim();
  if (title) return title.slice(0, 300);
  return decodeURIComponent(url.pathname.split("/").pop() || "Oficiální veřejný dokument")
    .replace(/\.(pdf|docx|pptx|xlsx|doc)$/i, "")
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
