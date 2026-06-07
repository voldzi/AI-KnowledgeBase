import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import { readGovernanceSourceContent } from "@/lib/upload/governance-source-content";
import type {
  Classification,
  Document,
  DocumentGovernanceRunResponse,
  DocumentStatus,
  DocumentVersion,
  GovernanceActionKind,
  GovernanceDocumentStatus,
  GovernanceDraftDocumentInput,
  GovernanceSourceDocument,
  GovernanceVersionContent
} from "@/lib/types";

import { documentWorkflowBadRequest, documentWorkflowBridgeError } from "../../errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{
    documentId: string;
  }>;
}

interface GovernanceContentBundle {
  content: string;
  citations: GovernanceSourceDocument["citations"];
  limitations: string[];
}

export async function POST(request: NextRequest, context: RouteContext) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return documentWorkflowBadRequest("Request body must be valid JSON.");
  }

  if (!isGovernanceActionRequest(body)) {
    return documentWorkflowBadRequest("Request body must contain a valid governance action.");
  }

  try {
    const { documentId } = await context.params;
    const requestContext = getServerRequestContext();
    const clients = getServerApiClients();
    const [document, versions] = await Promise.all([
      clients.registry.getDocument(documentId, requestContext),
      clients.registry.listDocumentVersions(documentId, requestContext)
    ]);
    const sortedVersions = sortVersions(versions);
    const currentVersion = selectVersion(sortedVersions, body.right_version_id) ?? sortedVersions[0];

    if (!currentVersion) {
      return documentWorkflowBadRequest("Document has no version available for governance execution.", 409);
    }

    const response = await runGovernanceAction({
      action: body.action,
      document,
      versions: sortedVersions,
      currentVersion,
      leftVersionId: body.left_version_id,
      requestContext,
      clients
    });

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof GovernanceBridgeError) {
      return documentWorkflowBadRequest(error.message, error.status);
    }
    return documentWorkflowBridgeError(error);
  }
}

async function runGovernanceAction({
  action,
  document,
  versions,
  currentVersion,
  leftVersionId,
  requestContext,
  clients
}: {
  action: GovernanceActionKind;
  document: Document;
  versions: DocumentVersion[];
  currentVersion: DocumentVersion;
  leftVersionId?: string;
  requestContext: ReturnType<typeof getServerRequestContext>;
  clients: ReturnType<typeof getServerApiClients>;
}): Promise<DocumentGovernanceRunResponse> {
  if (action === "compare_versions") {
    const leftVersion = selectVersion(versions, leftVersionId) ?? versions.find((version) => version.document_version_id !== currentVersion.document_version_id);
    if (!leftVersion) {
      throw new GovernanceBridgeError("Version comparison needs at least two document versions.");
    }
    const result = await clients.governance.compareVersions(
      {
        subject_id: requestContext.subjectId,
        left_version: await versionContent(document, leftVersion),
        right_version: await versionContent(document, currentVersion),
        include_unchanged: false
      },
      requestContext
    );
    return governanceRunResponse(action, result, await sourceLimitationsFor(document, leftVersion, currentVersion));
  }

  if (action === "check_compliance") {
    const draft = await draftContent(document, currentVersion);
    const result = await clients.governance.checkCompliance(
      {
        subject_id: requestContext.subjectId,
        draft,
        filters: {
          document_types: ["directive", "methodology", "policy"],
          only_valid: true,
          classification_max: classificationCeiling(document.classification),
          tags: document.tags.slice(0, 6)
        },
        max_control_chunks: 8
      },
      requestContext
    );
    return governanceRunResponse(action, result, await sourceLimitationsFor(document, currentVersion));
  }

  const sourceDocuments = await conflictSourceDocuments(clients, requestContext, document, currentVersion);
  if (sourceDocuments.length < 2) {
    throw new GovernanceBridgeError("Conflict detection needs at least two documents with versions.");
  }
  const result = await clients.governance.detectConflicts(
    {
      subject_id: requestContext.subjectId,
      documents: sourceDocuments,
      topic: document.title
    },
    requestContext
  );
  return governanceRunResponse(action, result, sourceDocuments.flatMap((source) => source.citations.length > 0 ? [] : ["SOURCE_DOCUMENT_WITHOUT_CITATION"]));
}

async function conflictSourceDocuments(
  clients: ReturnType<typeof getServerApiClients>,
  requestContext: ReturnType<typeof getServerRequestContext>,
  currentDocument: Document,
  currentVersion: DocumentVersion
): Promise<GovernanceSourceDocument[]> {
  const documents = await clients.registry.listDocuments(requestContext);
  const candidates = [
    currentDocument,
    ...documents
      .filter((candidate) => candidate.document_id !== currentDocument.document_id)
      .filter((candidate) => candidate.document_type === currentDocument.document_type || candidate.status === "valid")
      .slice(0, 4)
  ];
  const entries: GovernanceSourceDocument[] = [];
  for (const candidate of candidates) {
    if (candidate.document_id === currentDocument.document_id) {
      entries.push(await sourceDocument(currentDocument, currentVersion));
      continue;
    }
    const versions = sortVersions(await clients.registry.listDocumentVersions(candidate.document_id, requestContext));
    const version = versions.find((item) => item.status === "valid") ?? versions[0];
    if (version) {
      entries.push(await sourceDocument(candidate, version));
    }
    if (entries.length >= 5) {
      break;
    }
  }
  return entries;
}

function governanceRunResponse(
  action: GovernanceActionKind,
  result: DocumentGovernanceRunResponse["result"],
  limitations: string[]
): DocumentGovernanceRunResponse {
  return {
    action,
    result,
    source_limitations: uniqueStrings(limitations),
    generated_at: new Date().toISOString()
  };
}

async function versionContent(document: Document, version: DocumentVersion): Promise<GovernanceVersionContent> {
  const source = await governanceContentFor(document, version);
  return {
    document_id: document.document_id,
    document_version_id: version.document_version_id,
    document_title: document.title,
    version_label: version.version_label,
    status: governanceStatus(version.status),
    classification: document.classification,
    valid_from: version.valid_from,
    valid_to: version.valid_to,
    source_uri: version.source_file_uri,
    content: source.content,
    citations: source.citations
  };
}

async function draftContent(document: Document, version: DocumentVersion): Promise<GovernanceDraftDocumentInput> {
  const source = await governanceContentFor(document, version);
  return {
    title: document.title,
    document_type: document.document_type,
    classification: document.classification,
    content: source.content,
    document_id: document.document_id,
    document_version_id: version.document_version_id,
    owner_id: document.owner_id,
    gestor_unit: document.gestor_unit,
    valid_from: version.valid_from,
    valid_to: version.valid_to,
    tags: document.tags,
    citations: source.citations
  };
}

async function sourceDocument(document: Document, version: DocumentVersion): Promise<GovernanceSourceDocument> {
  const source = await governanceContentFor(document, version);
  return {
    document_id: document.document_id,
    document_version_id: version.document_version_id,
    document_title: document.title,
    version_label: version.version_label,
    status: governanceStatus(version.status),
    classification: document.classification,
    content: source.content,
    source_uri: version.source_file_uri,
    citations: source.citations
  };
}

async function governanceContentFor(document: Document, version: DocumentVersion): Promise<GovernanceContentBundle> {
  if (!version.source_file_uri) {
    return {
      content: synthesizedContent(document, version, ["SOURCE_FILE_URI_MISSING"]),
      citations: [governanceCitation(document, version, "Registry metadata fallback", "SOURCE_FILE_URI_MISSING")],
      limitations: ["SOURCE_FILE_URI_MISSING", "WEB_BRIDGE_METADATA_FALLBACK"]
    };
  }

  const extracted = await readGovernanceSourceContent({
    document_id: document.document_id,
    document_version_id: version.document_version_id,
    source_file_uri: version.source_file_uri,
    file_hash: version.file_hash,
    viewer_mode: viewerModeForSourceUri(version.source_file_uri)
  });

  if (extracted.extracted && extracted.content.trim()) {
    return {
      content: sourceContentEnvelope(document, version, extracted.content, extracted.warnings),
      citations: [governanceCitation(document, version, "Extracted source", extracted.content)],
      limitations: extracted.warnings
    };
  }

  return {
    content: synthesizedContent(document, version, extracted.warnings),
    citations: [governanceCitation(document, version, "Registry metadata fallback", extracted.warnings.join(", ") || "SOURCE_TEXT_UNAVAILABLE")],
    limitations: [...extracted.warnings, "WEB_BRIDGE_METADATA_FALLBACK"]
  };
}

async function sourceLimitationsFor(document: Document, ...versions: DocumentVersion[]): Promise<string[]> {
  const bundles = await Promise.all(versions.map((version) => governanceContentFor(document, version)));
  const limitations = bundles.flatMap((bundle) => bundle.limitations);
  return limitations.length > 0 ? limitations : ["SOURCE_TEXT_EXTRACTED"];
}

function synthesizedContent(document: Document, version: DocumentVersion, warnings: string[] = []): string {
  return [
    `Title: ${document.title}`,
    `Document ID: ${document.document_id}`,
    `Document type: ${document.document_type}`,
    `Document status: ${document.status}`,
    `Classification: ${document.classification}`,
    `Owner: ${document.owner_id}`,
    `Gestor unit: ${document.gestor_unit ?? "n/a"}`,
    `Tags: ${document.tags.join(", ") || "n/a"}`,
    `Version: ${version.version_label}`,
    `Version status: ${version.status}`,
    `Valid from: ${version.valid_from ?? "n/a"}`,
    `Valid to: ${version.valid_to ?? "n/a"}`,
    `Source URI: ${version.source_file_uri}`,
    `File hash: ${version.file_hash ?? "n/a"}`,
    `Change summary: ${version.change_summary ?? "n/a"}`,
    `Source extraction warnings: ${warnings.join(", ") || "n/a"}`,
    "Source limitation: web governance bridge used Registry metadata fallback because extracted source text was not available."
  ].join("\n");
}

function sourceContentEnvelope(document: Document, version: DocumentVersion, content: string, warnings: string[]): string {
  return [
    `Title: ${document.title}`,
    `Document ID: ${document.document_id}`,
    `Document type: ${document.document_type}`,
    `Document status: ${document.status}`,
    `Classification: ${document.classification}`,
    `Owner: ${document.owner_id}`,
    `Gestor unit: ${document.gestor_unit ?? "n/a"}`,
    `Tags: ${document.tags.join(", ") || "n/a"}`,
    `Version: ${version.version_label}`,
    `Version status: ${version.status}`,
    `Valid from: ${version.valid_from ?? "n/a"}`,
    `Valid to: ${version.valid_to ?? "n/a"}`,
    `Source URI: ${version.source_file_uri}`,
    `File hash: ${version.file_hash ?? "n/a"}`,
    `Change summary: ${version.change_summary ?? "n/a"}`,
    `Source extraction warnings: ${warnings.join(", ") || "n/a"}`,
    "",
    "Extracted source text:",
    content
  ].join("\n");
}

function governanceCitation(document: Document, version: DocumentVersion, section: string, excerptSource: string): GovernanceSourceDocument["citations"][number] {
  const excerpt = excerptSource.replace(/\s+/g, " ").trim().slice(0, 500) || null;
  return {
    document_id: document.document_id,
    document_version_id: version.document_version_id,
    document_title: document.title,
    version_label: version.version_label,
    section_path: [section],
    page_number: null,
    chunk_id: `governance:${version.document_version_id}`,
    source_excerpt: excerpt
  };
}

function viewerModeForSourceUri(sourceUri: string): string {
  const normalized = sourceUri.toLowerCase();
  if (normalized.endsWith(".pdf")) return "pdf";
  if (normalized.endsWith(".md") || normalized.endsWith(".markdown")) return "markdown";
  if (normalized.endsWith(".csv") || normalized.endsWith(".xlsx")) return "table";
  if (normalized.endsWith(".doc") || normalized.endsWith(".docx") || normalized.endsWith(".txt")) return "text";
  if (normalized.endsWith(".pptx")) return "presentation";
  if (normalized.match(/\.(png|jpe?g|gif|webp|svg)$/)) return "image";
  return "binary";
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function governanceStatus(status: DocumentStatus): GovernanceDocumentStatus {
  return status === "approved" ? "review" : status;
}

function classificationCeiling(classification: Classification): Classification {
  if (classification === "confidential") {
    return "confidential";
  }
  if (classification === "restricted") {
    return "restricted";
  }
  if (classification === "public") {
    return "public";
  }
  return "internal";
}

function sortVersions(versions: DocumentVersion[]): DocumentVersion[] {
  return [...versions].sort((left, right) => right.created_at.localeCompare(left.created_at));
}

function selectVersion(versions: DocumentVersion[], versionId: string | undefined): DocumentVersion | undefined {
  return versionId ? versions.find((version) => version.document_version_id === versionId) : undefined;
}

function isGovernanceActionRequest(value: unknown): value is {
  action: GovernanceActionKind;
  left_version_id?: string;
  right_version_id?: string;
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.action !== "compare_versions" &&
    candidate.action !== "check_compliance" &&
    candidate.action !== "detect_conflicts"
  ) {
    return false;
  }
  if (candidate.left_version_id !== undefined && typeof candidate.left_version_id !== "string") {
    return false;
  }
  if (candidate.right_version_id !== undefined && typeof candidate.right_version_id !== "string") {
    return false;
  }
  return true;
}

class GovernanceBridgeError extends Error {
  readonly status = 409;
  readonly code = "GOVERNANCE_INPUT_NOT_READY";
  readonly traceId = "web-document-governance";
}
