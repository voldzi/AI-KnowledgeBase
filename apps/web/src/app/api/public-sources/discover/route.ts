import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import { requireApiAccess } from "@/lib/auth/server-route-guard";
import { discoverPublicSourceCollection } from "@/lib/public-sources/discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = await getServerRequestContext();
    const forbidden = requireApiAccess(context, "knowledge_workspace");
    if (forbidden) return forbidden;
    const authorization = await getServerApiClients().registry.getAuthorizationHints(context);
    if (!authorization.can_update || !authorization.can_ingest || !authorization.can_publish) {
      return NextResponse.json(
        { error: { code: "PUBLIC_SOURCE_MANAGEMENT_FORBIDDEN", message: "Správa veřejných zdrojů vyžaduje oprávnění spravovat, publikovat a zpracovat dokumenty." } },
        { status: 403 },
      );
    }
    const body = await request.json();
    const result = await discoverPublicSourceCollection(String(body.collection_id ?? ""));
    return NextResponse.json(result);
  } catch (error) {
    return publicSourceError(error, "PUBLIC_SOURCE_DISCOVERY_FAILED");
  }
}

function publicSourceError(error: unknown, code: string) {
  return NextResponse.json(
    {
      error: {
        code,
        message: error instanceof Error ? error.message : "Načtení oficiální kolekce se nepodařilo.",
      },
    },
    { status: 502 },
  );
}
