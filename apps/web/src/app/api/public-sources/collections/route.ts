import { NextRequest, NextResponse } from "next/server";
import { getOptionalServerRequestContext, getServerApiClients } from "@/lib/api/server";
import { requireApiAccess } from "@/lib/auth/server-route-guard";
import { listApprovedPublicSourceCollections } from "@/lib/public-sources/approved-collections-client";
import { ApiClientError } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const context = await getOptionalServerRequestContext(request);
    if (!context) return NextResponse.json({ error: { code: "OIDC_SESSION_REQUIRED", message: "Přihlaste se znovu." } }, { status: 401, headers });
    const forbidden = requireApiAccess(context, "knowledge_workspace");
    if (forbidden) return forbidden;
    const authorization = await getServerApiClients().registry.getAuthorizationHints(context);
    if (!authorization.can_update || !authorization.can_ingest || !authorization.can_publish) {
      return NextResponse.json({ error: { code: "PUBLIC_SOURCE_MANAGEMENT_FORBIDDEN", message: "Pro správu veřejných zdrojů nemáte oprávnění." } }, { status: 403, headers });
    }
    const collections = await listApprovedPublicSourceCollections(context);
    return NextResponse.json({ collections }, { headers });
  } catch (error) {
    const known = error instanceof ApiClientError;
    return NextResponse.json({ error: { code: known ? error.code : "PUBLIC_SOURCE_APPROVAL_UNAVAILABLE",
      message: known ? error.message : "Schválené kolekce nejsou nyní dostupné.", trace_id: known ? error.traceId : "public-source-collections" } },
    { status: known ? error.status : 503, headers });
  }
}
