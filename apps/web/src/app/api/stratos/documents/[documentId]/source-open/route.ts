import { Context, Data, Effect, Layer } from "effect";
import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContextForRequest } from "@/lib/api/server";
import { runRouteEffect } from "@/lib/effect/next-route";
import { latestVersion } from "@/lib/stratos/document-ai";
import { createSourceOpenDecision, SourceDownloadError } from "@/lib/upload/source-download";
import type { ApiRequestContext } from "@/lib/types";

import { stratosBridgeError } from "../../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    documentId: string;
  }>;
}

class SourceOpenRuntime extends Context.Tag("SourceOpenRuntime")<
  SourceOpenRuntime,
  {
    readonly clients: ReturnType<typeof getServerApiClients>;
    readonly getRequestContext: () => Promise<ApiRequestContext>;
    readonly params: () => Promise<{ documentId: string }>;
    readonly request: NextRequest;
    readonly sourceOpenDecision: typeof createSourceOpenDecision;
  }
>() {}

class SourceOpenForbidden extends Data.TaggedError("SourceOpenForbidden")<{
  readonly message: string;
}> {}

class SourceOpenVersionNotFound extends Data.TaggedError("SourceOpenVersionNotFound")<{
  readonly message: string;
}> {}

class SourceOpenOperationalFailure extends Data.TaggedError("SourceOpenOperationalFailure")<{
  readonly error: unknown;
}> {}

type SourceOpenFailure = SourceOpenForbidden | SourceOpenVersionNotFound | SourceOpenOperationalFailure;

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
        trace_id: "web-stratos-source-open"
      }
    },
    { status: error.status }
  );
}

function sourceOpenFailureResponse(error: SourceOpenFailure) {
  switch (error._tag) {
    case "SourceOpenForbidden":
      return NextResponse.json(
        {
          error: {
            code: "STRATOS_DOCUMENT_SOURCE_FORBIDDEN",
            message: error.message,
            trace_id: "web-stratos-source-open"
          }
        },
        { status: 403 }
      );
    case "SourceOpenVersionNotFound":
      return NextResponse.json(
        {
          error: {
            code: "STRATOS_DOCUMENT_VERSION_NOT_FOUND",
            message: error.message,
            trace_id: "web-stratos-source-open"
          }
        },
        { status: 404 }
      );
    case "SourceOpenOperationalFailure":
      if (error.error instanceof SourceDownloadError) {
        return sourceDownloadErrorResponse(error.error);
      }
      return stratosBridgeError(error.error);
  }
}

function operationalFailure(error: unknown) {
  return new SourceOpenOperationalFailure({ error });
}

const sourceOpenProgram = Effect.gen(function* () {
  const runtime = yield* SourceOpenRuntime;
  const { documentId } = yield* Effect.tryPromise({
    try: runtime.params,
    catch: operationalFailure
  });
  const requestContext = yield* Effect.tryPromise({
    try: runtime.getRequestContext,
    catch: operationalFailure
  });
  const requestedVersionId = runtime.request.nextUrl.searchParams.get("version_id")?.trim() || null;
  const [document, versions, authorization] = yield* Effect.tryPromise({
    try: () =>
      Promise.all([
        runtime.clients.registry.getDocument(documentId, requestContext),
        runtime.clients.registry.listDocumentVersions(documentId, requestContext),
        runtime.clients.registry.getAuthorizationHints(requestContext)
      ]),
    catch: operationalFailure
  });

  if (!authorization.can_read) {
    return yield* Effect.fail(new SourceOpenForbidden({ message: "Document read is not allowed in this session." }));
  }

  const version = requestedVersionId
    ? versions.find((candidate) => candidate.document_version_id === requestedVersionId) ?? null
    : latestVersion(versions);
  if (!version || version.document_id !== document.document_id) {
    return yield* Effect.fail(
      new SourceOpenVersionNotFound({ message: "Document version does not belong to this document." })
    );
  }

  const sourceOpen = yield* Effect.tryPromise({
    try: () =>
      runtime.sourceOpenDecision({
        document_id: document.document_id,
        document_version_id: version.document_version_id,
        source_file_uri: version.source_file_uri,
        file_hash: version.file_hash,
        viewer_mode: viewerModeForUri(version.source_file_uri)
      }),
    catch: operationalFailure
  });

  yield* Effect.promise(() =>
    runtime.clients.registry
      .createAuditEvent(
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
            unavailable_reason: sourceOpen.unavailable_reason,
            bridge: "stratos"
          }
        },
        requestContext
      )
      .catch(() => undefined)
  );

  return NextResponse.json({ source_open: sourceOpen }, { status: 201 });
});

export async function POST(request: NextRequest, context: RouteContext) {
  return runRouteEffect(
    Effect.provide(
      sourceOpenProgram,
      Layer.succeed(SourceOpenRuntime, {
        clients: getServerApiClients(),
        getRequestContext: () => getServerRequestContextForRequest(request),
        params: () => context.params,
        request,
        sourceOpenDecision: createSourceOpenDecision
      })
    ),
    sourceOpenFailureResponse
  );
}
