import { NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import { createSourceOpenDecision, SourceDownloadError } from "@/lib/upload/source-download";

import { documentWorkflowBadRequest, documentWorkflowBridgeError } from "../../../../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    documentId: string;
    versionId: string;
  }>;
}

function viewerModeForUri(uri: string): string {
  const value = uri.toLowerCase();
  if (value.endsWith(".pdf")) return "pdf";
  if (value.endsWith(".md") || value.endsWith(".markdown")) return "markdown";
  if (value.endsWith(".docx") || value.endsWith(".doc") || value.endsWith(".odt")) return "text";
  if (value.endsWith(".xlsx") || value.endsWith(".csv")) return "table";
  if (value.match(/\.(png|jpe?g|gif|webp|svg)$/)) return "image";
  return "binary";
}

function sourceDownloadErrorResponse(error: SourceDownloadError) {
  return NextResponse.json(
    {
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        trace_id: "web-source-open"
      }
    },
    { status: error.status }
  );
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { documentId, versionId } = await context.params;
    const requestContext = await getServerRequestContext();
    const clients = getServerApiClients();
    const [document, versions, authorization] = await Promise.all([
      clients.registry.getDocument(documentId, requestContext),
      clients.registry.listDocumentVersions(documentId, requestContext),
      clients.registry.getAuthorizationHints(requestContext)
    ]);
    if (!authorization.can_read) {
      return documentWorkflowBadRequest("Document read is not allowed in this session.", 403);
    }

    const version = versions.find((candidate) => candidate.document_version_id === versionId);
    if (!version || version.document_id !== document.document_id) {
      return documentWorkflowBadRequest("Document version does not belong to this document.", 404);
    }

    const sourceOpen = await createSourceOpenDecision({
      document_id: document.document_id,
      document_version_id: version.document_version_id,
      source_file_uri: version.source_file_uri,
      file_hash: version.file_hash,
      viewer_mode: viewerModeForUri(version.source_file_uri),
      policy_binding_id: version.policy_binding_id,
      policy_version: version.policy_version,
      policy_hash: version.policy_hash
    });

    void clients.registry.createAuditEvent(
      {
        actor_id: requestContext.subjectId,
        event_type: "source.open_requested",
        resource_type: "document_version",
        resource_id: version.document_version_id,
        severity: sourceOpen.available ? "info" : "warning",
        metadata: {
          document_id: document.document_id,
          document_version_id: version.document_version_id,
          source_open_id: sourceOpen.source_open_id,
          source_file_uri: sourceOpen.source_file_uri,
          available: sourceOpen.available,
          unavailable_reason: sourceOpen.unavailable_reason
        }
      },
      requestContext
    ).catch(() => undefined);

    return NextResponse.json({ source_open: sourceOpen }, { status: 201 });
  } catch (error) {
    if (error instanceof SourceDownloadError) {
      return sourceDownloadErrorResponse(error);
    }
    return documentWorkflowBridgeError(error);
  }
}
