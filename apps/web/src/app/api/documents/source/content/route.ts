import { NextRequest, NextResponse } from "next/server";

import { getOptionalServerRequestContext, getServerApiClients } from "@/lib/api/server";
import { withAppBasePath } from "@/lib/app-url";
import {
  readSourceObject,
  SourceDownloadError,
  sourceContentTypeHeader,
  verifySourceDownloadToken
} from "@/lib/upload/source-download";

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

function acceptsHtml(request: NextRequest): boolean {
  return (request.headers.get("accept") ?? "").toLowerCase().includes("text/html");
}

function expiredSourceRedirect(error: SourceDownloadError, request: NextRequest): Response | null {
  if (error.code !== "SOURCE_DOWNLOAD_TOKEN_EXPIRED" || !acceptsHtml(request)) {
    return null;
  }
  const documentId = typeof error.details.document_id === "string" ? error.details.document_id : null;
  if (!documentId) {
    return null;
  }
  const target = withAppBasePath(`/documents/${encodeURIComponent(documentId)}?tab=viewer`);
  return new Response(null, {
    status: 303,
    headers: {
      "Cache-Control": "private, no-store",
      Location: target
    }
  });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get("token") ?? "";
    const payload = verifySourceDownloadToken(token);
    const context = await getOptionalServerRequestContext(request);
    if (!context) {
      return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "An active session is required." } }, { status: 401 });
    }
    const clients = getServerApiClients();
    const [document, versions] = await Promise.all([
      clients.registry.getDocument(payload.document_id, context),
      clients.registry.listDocumentVersions(payload.document_id, context)
    ]);
    const version = versions.find((item) => item.document_version_id === payload.document_version_id);
    if (!version || document.document_id !== version.document_id) {
      return NextResponse.json({ error: { code: "STALE_SOURCE_TOKEN", message: "The source version is no longer available." } }, { status: 409 });
    }
    if (
      (version.policy_binding_id ?? null) !== payload.policy_binding_id ||
      (version.policy_version ?? null) !== payload.policy_version ||
      (version.policy_hash ?? null) !== payload.policy_hash ||
      (context.authorizationSource !== "mock" && context.capabilities?.length && !payload.policy_hash)
    ) {
      return NextResponse.json({ error: { code: "STALE_POLICY_BINDING", message: "The source policy binding changed." } }, { status: 409 });
    }
    const source = await readSourceObject(payload);
    {
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
    }
    const body = source.bytes.buffer.slice(
      source.bytes.byteOffset,
      source.bytes.byteOffset + source.bytes.byteLength
    ) as ArrayBuffer;

    return new Response(body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": contentDispositionFilename(source.filename),
        "Content-Length": String(source.bytes.byteLength),
        "Content-Type": sourceContentTypeHeader(source.mime_type),
        "X-AKL-Source-Open-Id": payload.source_open_id,
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    if (error instanceof SourceDownloadError) {
      const redirect = expiredSourceRedirect(error, request);
      if (redirect) {
        return redirect;
      }
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
