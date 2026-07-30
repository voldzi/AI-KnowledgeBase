import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContextForRequest } from "@/lib/api/server";
import { requireApiAccess } from "@/lib/auth/server-route-guard";
import type { ControlledDocumentPackageStatus } from "@/lib/types";
import { controlledDocumentationBridgeError } from "../../../errors";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ packageId: string }> },
) {
  try {
    const context = await getServerRequestContextForRequest(request);
    const forbidden = requireApiAccess(context, "knowledge_workspace");
    if (forbidden) return forbidden;
    const { packageId } = await params;
    const body = (await request.json()) as {
      target_status?: ControlledDocumentPackageStatus;
    };
    if (!body.target_status) {
      return NextResponse.json(
        {
          error: {
            code: "CONTROLLED_DOCUMENTATION_STATUS_REQUIRED",
            message: "Chybí cílový stav balíčku.",
          },
        },
        { status: 422 },
      );
    }
    const authorization =
      await getServerApiClients().registry.getAuthorizationHints(context);
    const canTransition =
      body.target_status === "cancelled"
        ? authorization.can_update
        : authorization.can_publish;
    if (!canTransition) {
      return NextResponse.json(
        {
          error: {
            code: "CONTROLLED_DOCUMENTATION_APPROVAL_FORBIDDEN",
            message:
              body.target_status === "cancelled"
                ? "Koncept může zrušit pouze gestor dokumentace."
                : "Změnu platnosti může provést pouze schvalovatel.",
          },
        },
        { status: 403 },
      );
    }
    const result =
      await getServerApiClients().registry.updateControlledDocumentPackageStatus(
        packageId,
        body.target_status,
        context,
      );
    return NextResponse.json(result);
  } catch (error) {
    return controlledDocumentationBridgeError(
      error,
      "CONTROLLED_DOCUMENTATION_STATUS_FAILED",
      "Stav balíčku se nepodařilo změnit.",
    );
  }
}
