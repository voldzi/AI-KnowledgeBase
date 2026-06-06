import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import { readSourceObject, SourceDownloadError, verifySourceDownloadToken } from "@/lib/upload/source-download";

function sourceDownloadErrorResponse(error: SourceDownloadError) {
  return NextResponse.json(
    {
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        trace_id: "web-source-download"
      }
    },
    { status: error.status }
  );
}

function contentDispositionFilename(filename: string): string {
  const safeFilename = filename.replace(/["\\\r\n]/g, "_");
  return `inline; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get("token") ?? "";
    const payload = verifySourceDownloadToken(token);
    const source = await readSourceObject(payload);
    const clients = getServerApiClients();
    const context = getServerRequestContext();
    void clients.registry.createAuditEvent(
      {
        actor_id: context.subjectId,
        event_type: "source.opened",
        resource_type: "document_version",
        resource_id: payload.document_version_id,
        severity: "info",
        metadata: {
          document_id: payload.document_id,
          document_version_id: payload.document_version_id,
          source_open_id: payload.source_open_id,
          source_file_uri: payload.source_file_uri,
          sha256: source.sha256
        }
      },
      context
    ).catch(() => undefined);
    const body = source.bytes.buffer.slice(
      source.bytes.byteOffset,
      source.bytes.byteOffset + source.bytes.byteLength
    ) as ArrayBuffer;

    return new Response(body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": contentDispositionFilename(source.filename),
        "Content-Length": String(source.bytes.byteLength),
        "Content-Type": source.mime_type,
        "X-AKL-Source-Open-Id": payload.source_open_id,
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    if (error instanceof SourceDownloadError) {
      return sourceDownloadErrorResponse(error);
    }
    return NextResponse.json(
      {
        error: {
          code: "SOURCE_DOWNLOAD_ERROR",
          message: "Source download failed.",
          trace_id: "web-source-download"
        }
      },
      { status: 500 }
    );
  }
}
