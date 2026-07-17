import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContextForRequest } from "@/lib/api/server";
import { requireApiAccess } from "@/lib/auth/server-route-guard";
import { synchronizePublicSource } from "@/lib/public-sources/sync";
import { ApiClientError } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const context = await getServerRequestContextForRequest(request);
    const forbidden = requireApiAccess(context, "knowledge_workspace");
    if (forbidden) return forbidden;
    const clients = getServerApiClients();
    const authorization = await clients.registry.getAuthorizationHints(context);
    if (!authorization.can_update || !authorization.can_ingest || !authorization.can_publish) {
      return NextResponse.json(
        { error: { code: "PUBLIC_SOURCE_MANAGEMENT_FORBIDDEN", message: "Správa veřejných zdrojů vyžaduje oprávnění spravovat, publikovat a zpracovat dokumenty." } },
        { status: 403 },
      );
    }
    const body = await request.json();
    const result = await synchronizePublicSource(
      {
        collectionId: String(body.collection_id ?? ""),
        sourceUrl: String(body.source_url ?? ""),
        canonicalUrl: body.canonical_url ? String(body.canonical_url) : undefined,
        title: String(body.title ?? ""),
      },
      clients,
      context,
    );
    return NextResponse.json(result, { status: result.action === "created" ? 201 : 200 });
  } catch (error) {
    if (error instanceof ApiClientError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message, trace_id: error.traceId } },
        { status: error.status },
      );
    }
    return NextResponse.json(
      {
        error: {
          code: "PUBLIC_SOURCE_SYNC_FAILED",
          message: error instanceof Error ? error.message : "Synchronizace veřejného zdroje se nepodařila.",
        },
      },
      { status: 500 },
    );
  }
}
