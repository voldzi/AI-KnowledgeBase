import { NextRequest, NextResponse } from "next/server";

import { buildNativeSourcePreview } from "@/lib/upload/ooxml-preview";
import { readSourceObject, SourceDownloadError, verifySourceDownloadToken } from "@/lib/upload/source-download";

function sourcePreviewErrorResponse(error: SourceDownloadError) {
  return NextResponse.json(
    {
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        trace_id: "web-source-preview"
      }
    },
    { status: error.status }
  );
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get("token") ?? "";
    const payload = verifySourceDownloadToken(token);
    const source = await readSourceObject(payload);
    const preview = buildNativeSourcePreview({
      bytes: source.bytes,
      filename: source.filename,
      mimeType: source.mime_type
    });

    return NextResponse.json(
      {
        source_preview: {
          ...preview,
          sha256: source.sha256,
          mime_type: source.mime_type,
          source_open_id: payload.source_open_id,
          document_id: payload.document_id,
          document_version_id: payload.document_version_id
        }
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "X-AKL-Source-Open-Id": payload.source_open_id,
          "X-Content-Type-Options": "nosniff"
        }
      }
    );
  } catch (error) {
    if (error instanceof SourceDownloadError) {
      return sourcePreviewErrorResponse(error);
    }
    return NextResponse.json(
      {
        error: {
          code: "SOURCE_PREVIEW_ERROR",
          message: "Source preview failed.",
          trace_id: "web-source-preview"
        }
      },
      { status: 500 }
    );
  }
}
