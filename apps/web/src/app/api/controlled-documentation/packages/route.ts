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
    const result = await getServerApiClients().registry.listControlledDocumentPackages(
      context,
      {
        domain:
          request.nextUrl.searchParams.get("domain") || "public_procurement",
        validOn: request.nextUrl.searchParams.get("valid_on") || undefined,
        includeInactive:
          request.nextUrl.searchParams.get("include_inactive") === "true",
      },
    );
    return NextResponse.json(result);
  } catch (error) {
    return controlledDocumentationError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await getServerRequestContextForRequest(request);
    const forbidden = requireApiAccess(context, "knowledge_workspace");
    if (forbidden) return forbidden;
    const authorization =
      await getServerApiClients().registry.getAuthorizationHints(context);
    if (!authorization.can_update) {
      return NextResponse.json(
        {
          error: {
            code: "CONTROLLED_DOCUMENTATION_FORBIDDEN",
            message: "Balíček může založit pouze gestor dokumentace.",
          },
        },
        { status: 403 },
      );
    }
    const result =
      await getServerApiClients().registry.createControlledDocumentPackage(
        await request.json(),
        context,
      );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return controlledDocumentationError(error);
  }
}

function controlledDocumentationError(error: unknown) {
  return controlledDocumentationBridgeError(
    error,
    "CONTROLLED_DOCUMENTATION_REQUEST_FAILED",
    "Operaci s řízenou dokumentací se nepodařilo dokončit.",
  );
}
