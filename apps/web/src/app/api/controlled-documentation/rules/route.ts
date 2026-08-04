import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContextForRequest } from "@/lib/api/server";
import { requireApiAccess } from "@/lib/auth/server-route-guard";
import { controlledDocumentationBridgeError } from "../errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await getServerRequestContextForRequest(request);
    const forbidden = requireApiAccess(context, "knowledge_workspace");
    if (forbidden) return forbidden;
    const domain = request.nextUrl.searchParams.get("domain");
    if (!domain) {
      return NextResponse.json(
        {
          error: {
            code: "CONTROLLED_RULE_DOMAIN_REQUIRED",
            message: "Chybí doména pravidel.",
          },
        },
        { status: 422 },
      );
    }
    const result = await getServerApiClients().registry.listControlledRules(
      domain,
      context,
      {
        validOn: request.nextUrl.searchParams.get("valid_on") || undefined,
        approvedOnly:
          request.nextUrl.searchParams.get("approved_only") !== "false",
        includeInactive:
          request.nextUrl.searchParams.get("include_inactive") === "true",
        consumerView:
          request.nextUrl.searchParams.get("consumer_view") === "true",
      },
    );
    return NextResponse.json(result);
  } catch (error) {
    return controlledDocumentationBridgeError(
      error,
      "CONTROLLED_RULES_UNAVAILABLE",
      "Pravidla se nepodařilo načíst.",
    );
  }
}
