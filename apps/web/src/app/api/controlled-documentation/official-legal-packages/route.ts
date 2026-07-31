import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContextForRequest } from "@/lib/api/server";
import { requireApiAccess } from "@/lib/auth/server-route-guard";
import { controlledDocumentationBridgeError } from "../errors";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = await getServerRequestContextForRequest(request);
    const forbidden = requireApiAccess(context, "knowledge_workspace");
    if (forbidden) return forbidden;
    const authorization = await getServerApiClients().registry.getAuthorizationHints(context);
    if (!authorization.can_update || !authorization.can_publish) {
      return NextResponse.json(
        {
          error: {
            code: "CONTROLLED_DOCUMENTATION_FORBIDDEN",
            message: "Právní balíčky může připravit pouze gestor s oprávněním zveřejnit dokument.",
          },
        },
        { status: 403 },
      );
    }
    const result = await getServerApiClients().registry.materializeOfficialLegalPackages(
      await request.json(),
      context,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return controlledDocumentationBridgeError(
      error,
      "OFFICIAL_LEGAL_PACKAGE_REQUEST_FAILED",
      "Přípravu balíčků oficiálních právních předpisů se nepodařilo dokončit.",
    );
  }
}
