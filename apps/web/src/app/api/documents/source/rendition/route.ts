import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { getAklConfig } from "@/lib/api/config";
import { getOptionalServerRequestContext, getServerApiClients } from "@/lib/api/server";
import { ingestionServiceRequestContext } from "@/lib/ingestion/service-identity";
import { getContentSecuritySettings } from "@/lib/upload/content-security";
import {
  assertSourceContentSecurityAllowed,
  SourceDownloadError,
  verifySourceDownloadToken
} from "@/lib/upload/source-download";

function errorResponse(
  status: number,
  code: string,
  message: string,
  traceId = "web-source-rendition"
) {
  return NextResponse.json(
    { error: { code, message, trace_id: traceId } },
    { status }
  );
}

function sourceErrorResponse(error: SourceDownloadError) {
  return NextResponse.json(
    {
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        trace_id: "web-source-rendition"
      }
    },
    { status: error.status }
  );
}

function contentDispositionFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "") || "document";
  const output = `${base}.pdf`;
  const safe = output.replace(/["\\\r\n]/g, "_");
  return `inline; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(output)}`;
}

const MAX_RENDITION_BYTES = 128 * 1024 * 1024;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const correlationId =
    request.headers.get("X-Correlation-ID") ?? `rendition-${randomUUID()}`;
  try {
    const token = request.nextUrl.searchParams.get("token") ?? "";
    const payload = verifySourceDownloadToken(token);
    const context = await getOptionalServerRequestContext(request);
    if (!context) {
      return errorResponse(401, "UNAUTHORIZED", "An active session is required.", correlationId);
    }

    const clients = getServerApiClients();
    const [document, versions] = await Promise.all([
      clients.registry.getDocument(payload.document_id, context),
      clients.registry.listDocumentVersions(payload.document_id, context)
    ]);
    const version = versions.find(
      (item) => item.document_version_id === payload.document_version_id
    );
    if (!version || document.document_id !== version.document_id) {
      return errorResponse(
        409,
        "STALE_SOURCE_TOKEN",
        "The source version is no longer available.",
        correlationId
      );
    }
    if (
      !payload.sha256 ||
      version.file_hash?.toLowerCase() !== payload.sha256.toLowerCase() ||
      version.source_file_uri !== payload.source_file_uri
    ) {
      return errorResponse(
        409,
        "STALE_SOURCE_TOKEN",
        "The source coordinates or immutable digest changed.",
        correlationId
      );
    }
    assertSourceContentSecurityAllowed(version.content_security_status);
    if (
      getContentSecuritySettings().required &&
      version.content_security_status !== "clean"
    ) {
      return errorResponse(
        423,
        "SOURCE_CONTENT_SECURITY_SCAN_REQUIRED",
        "The source file must pass content-security scanning before a preview can be generated.",
        correlationId
      );
    }
    if (
      (version.policy_binding_id ?? null) !== payload.policy_binding_id ||
      (version.policy_version ?? null) !== payload.policy_version ||
      (version.policy_hash ?? null) !== payload.policy_hash ||
      (context.authorizationSource !== "mock" &&
        context.capabilities?.length &&
        !payload.policy_hash)
    ) {
      return errorResponse(
        409,
        "STALE_POLICY_BINDING",
        "The source policy binding changed.",
        correlationId
      );
    }

    const transport = await ingestionServiceRequestContext(correlationId);
    const config = getAklConfig();
    const headers = new Headers({
      Accept: "application/pdf",
      "Content-Type": "application/json",
      "X-Request-ID": correlationId,
      "X-Correlation-ID": correlationId
    });
    if (transport.accessToken) {
      headers.set("Authorization", `Bearer ${transport.accessToken}`);
    }
    if (transport.authorizationSource === "mock") {
      headers.set("X-AKL-Subject", transport.subjectId);
      headers.set("X-AKL-Service-Client-ID", transport.serviceClientId ?? "");
      headers.set("X-AKL-Roles", transport.roles?.join(",") ?? "");
    }

    const upstream = await fetch(
      `${config.serviceBaseUrls.ingestion}/renditions/pdf`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          document_id: payload.document_id,
          document_version_id: payload.document_version_id,
          source_file_uri: payload.source_file_uri,
          source_sha256: payload.sha256
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(125_000)
      }
    );
    if (!upstream.ok) {
      const body = (await upstream.json().catch(() => null)) as {
        error?: { code?: string; message?: string; trace_id?: string };
      } | null;
      return errorResponse(
        upstream.status,
        body?.error?.code ?? "DOCUMENT_RENDITION_UPSTREAM_FAILED",
        body?.error?.message ?? "Document preview conversion failed.",
        body?.error?.trace_id ?? correlationId
      );
    }
    if (
      !(upstream.headers.get("content-type") ?? "")
        .toLowerCase()
        .startsWith("application/pdf")
    ) {
      return errorResponse(
        502,
        "DOCUMENT_RENDITION_CONTRACT_MISMATCH",
        "The rendition service returned an unexpected content type.",
        correlationId
      );
    }
    const declaredLength = Number(upstream.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_RENDITION_BYTES) {
      return errorResponse(
        413,
        "DOCUMENT_RENDITION_OUTPUT_TOO_LARGE",
        "The rendered preview exceeds its size limit.",
        correlationId
      );
    }
    const content = await upstream.arrayBuffer();
    const prefix = new Uint8Array(content, 0, Math.min(content.byteLength, 5));
    if (
      content.byteLength < 5 ||
      content.byteLength > MAX_RENDITION_BYTES ||
      PDF_MAGIC.some((value, index) => prefix[index] !== value)
    ) {
      return errorResponse(
        502,
        "DOCUMENT_RENDITION_CONTRACT_MISMATCH",
        "The rendition service returned an invalid PDF preview.",
        correlationId
      );
    }

    void clients.registry.createAuditEvent(
      {
        actor_id: context.subjectId,
        event_type: "source.rendition.opened",
        resource_type: "document_version",
        resource_id: payload.document_version_id,
        severity: "info",
        metadata: {
          document_id: payload.document_id,
          document_version_id: payload.document_version_id,
          source_open_id: payload.source_open_id,
          source_sha256: payload.sha256,
          rendition_engine: upstream.headers.get("x-akl-rendition-engine"),
          rendition_engine_revision: upstream.headers.get(
            "x-akl-rendition-engine-revision"
          ),
          rendition_sha256: upstream.headers.get("x-akl-rendition-sha256"),
          rendition_cache: upstream.headers.get("x-akl-rendition-cache")
        }
      },
      context
    ).catch(() => undefined);

    return new Response(content, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": contentDispositionFilename(payload.file_name),
        "Content-Length": String(content.byteLength),
        "Content-Type": "application/pdf",
        "X-AKL-Rendition-Engine":
          upstream.headers.get("x-akl-rendition-engine") ?? "unknown",
        "X-AKL-Rendition-Engine-Revision":
          upstream.headers.get("x-akl-rendition-engine-revision") ?? "unknown",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    if (error instanceof SourceDownloadError) {
      return sourceErrorResponse(error);
    }
    if (error instanceof Error && error.name === "TimeoutError") {
      return errorResponse(
        504,
        "DOCUMENT_RENDITION_TIMEOUT",
        "Document preview conversion timed out.",
        correlationId
      );
    }
    return errorResponse(
      500,
      "DOCUMENT_RENDITION_ERROR",
      "Document preview could not be prepared.",
      correlationId
    );
  }
}
