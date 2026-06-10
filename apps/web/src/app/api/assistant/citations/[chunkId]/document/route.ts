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

function sourceUrlWithPageFragment(sourceUrl: string, pageNumber: number | null): string {
  if (!pageNumber || !Number.isFinite(pageNumber)) {
    return sourceUrl;
  }
  const page = Math.max(1, Math.trunc(pageNumber));
  const [baseUrl] = sourceUrl.split("#");
  return `${baseUrl}#page=${page}`;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { chunkId } = await context.params;
    const requestContext = await getServerRequestContext();
    const clients = getServerApiClients();
    const sourceContext = await clients.rag.openAssistantCitation(chunkId, requestContext);

    if (!sourceContext.source_file_uri) {
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

    const sourceOpen = await createSourceOpenDecision({
      document_id: sourceContext.document_id,
      document_version_id: sourceContext.document_version_id,
      source_file_uri: sourceContext.source_file_uri,
      file_hash: sourceContext.source_sha256,
      viewer_mode: viewerModeForSource(sourceContext.source_file_uri, sourceContext.source_mime_type)
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

    const redirectUrl = sourceUrlWithPageFragment(sourceOpen.download_url, sourceContext.location.page_number);
    return NextResponse.redirect(redirectUrl, { status: 307 });
  } catch (error) {
    if (error instanceof SourceDownloadError) {
      return sourceDownloadErrorResponse(error);
    }
    return assistantBridgeError(error);
  }
}
