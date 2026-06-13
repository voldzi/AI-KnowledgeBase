import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import { createSourceOpenDecision, SourceDownloadError } from "@/lib/upload/source-download";

import { assistantBridgeError } from "../../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    chunkId: string;
  }>;
}

function sourceDownloadErrorResponse(error: SourceDownloadError) {
  return NextResponse.json(
    {
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        trace_id: "web-assistant-source-document"
      }
    },
    { status: error.status }
  );
}

function viewerModeForSource(sourceFileUri: string | null, sourceMimeType: string | null): string {
  const uri = sourceFileUri?.toLowerCase() ?? "";
  const mimeType = sourceMimeType?.toLowerCase() ?? "";

  if (uri.endsWith(".pdf") || mimeType === "application/pdf") return "pdf";
  if (uri.endsWith(".md") || uri.endsWith(".markdown") || mimeType === "text/markdown") return "markdown";
  if (
    uri.endsWith(".docx") ||
    uri.endsWith(".doc") ||
    uri.endsWith(".odt") ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword"
  ) {
    return "text";
  }
  if (
    uri.endsWith(".xlsx") ||
    uri.endsWith(".csv") ||
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "text/csv"
  ) {
    return "table";
  }
  if (uri.endsWith(".pptx") || mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
    return "presentation";
  }
  if (uri.match(/\.(png|jpe?g|gif|webp|svg)$/) || mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("text/")) return "text";
  return "binary";
}

function pdfSearchPhrase(chunkText: string): string | null {
  const normalized = chunkText
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s.,:;!?()[\]{}'"-]/gu, "")
    .trim();
  if (!normalized) {
    return null;
  }
  return normalized.length > 96 ? normalized.slice(0, 96).trim() : normalized;
}

function sourceUrlWithPdfFragment({
  chunkText,
  pageNumber,
  sourceUrl,
  viewerMode
}: {
  chunkText: string;
  pageNumber: number | null;
  sourceUrl: string;
  viewerMode: string;
}): string {
  const [baseUrl] = sourceUrl.split("#");
  const fragmentParts: string[] = [];
  if (pageNumber && Number.isFinite(pageNumber)) {
    fragmentParts.push(`page=${Math.max(1, Math.trunc(pageNumber))}`);
  }
  if (viewerMode === "pdf") {
    const searchPhrase = pdfSearchPhrase(chunkText);
    if (searchPhrase) {
      fragmentParts.push(`search=${encodeURIComponent(searchPhrase)}`);
    }
  }
  return fragmentParts.length ? `${baseUrl}#${fragmentParts.join("&")}` : sourceUrl;
}

function sourceRedirectResponse(sourceUrl: string): Response {
  return new Response(null, {
    status: 307,
    headers: {
      "Cache-Control": "private, no-store",
      Location: sourceUrl
    }
  });
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { chunkId } = await context.params;
    const requestContext = await getServerRequestContext();
    const clients = getServerApiClients();
    const sourceContext = await clients.rag.openAssistantCitation(chunkId, requestContext);
    const [document, versions, authorization] = await Promise.all([
      clients.registry.getDocument(sourceContext.document_id, requestContext),
      clients.registry.listDocumentVersions(sourceContext.document_id, requestContext),
      clients.registry.getAuthorizationHints(requestContext)
    ]);

    if (!authorization.can_read) {
      return NextResponse.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Document read is not allowed in this session.",
            trace_id: "web-assistant-source-document"
          }
        },
        { status: 403 }
      );
    }

    const version = versions.find((candidate) => candidate.document_version_id === sourceContext.document_version_id);

    if (!version || version.document_id !== document.document_id) {
      return NextResponse.json(
        {
          error: {
            code: "DOCUMENT_VERSION_NOT_FOUND",
            message: "Document version does not belong to the cited document.",
            trace_id: "web-assistant-source-document"
          }
        },
        { status: 404 }
      );
    }

    if (!version.source_file_uri) {
      return NextResponse.json(
        {
          error: {
            code: "SOURCE_UNAVAILABLE",
            message: "Source file URI is not available for this citation.",
            trace_id: "web-assistant-source-document"
          }
        },
        { status: 404 }
      );
    }

    const viewerMode = viewerModeForSource(version.source_file_uri, sourceContext.source_mime_type);
    const sourceOpen = await createSourceOpenDecision({
      document_id: document.document_id,
      document_version_id: version.document_version_id,
      source_file_uri: version.source_file_uri,
      file_hash: version.file_hash,
      viewer_mode: viewerMode
    });

    if (!sourceOpen.available || !sourceOpen.download_url) {
      return NextResponse.json(
        {
          error: {
            code: sourceOpen.unavailable_reason ?? "SOURCE_UNAVAILABLE",
            message: "Source object is not available for direct opening.",
            trace_id: "web-assistant-source-document"
          }
        },
        { status: 404 }
      );
    }

    const redirectUrl = sourceUrlWithPdfFragment({
      chunkText: sourceContext.chunk_text,
      pageNumber: sourceContext.location.page_number,
      sourceUrl: sourceOpen.download_url,
      viewerMode
    });
    return sourceRedirectResponse(redirectUrl);
  } catch (error) {
    if (error instanceof SourceDownloadError) {
      return sourceDownloadErrorResponse(error);
    }
    return assistantBridgeError(error);
  }
}
