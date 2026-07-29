import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContextForRequest } from "@/lib/api/server";
import { requireApiAccess } from "@/lib/auth/server-route-guard";
import type { ControlledDocumentPackageStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ packageId: string }> },
) {
  try {
    const context = await getServerRequestContextForRequest(request);
    const forbidden = requireApiAccess(context, "knowledge_workspace");
    if (forbidden) return forbidden;
    const authorization =
      await getServerApiClients().registry.getAuthorizationHints(context);
    if (!authorization.can_publish) {
      return NextResponse.json(
        {
          error: {
            code: "CONTROLLED_DOCUMENTATION_APPROVAL_FORBIDDEN",
            message: "Změnu platnosti může provést pouze schvalovatel.",
          },
        },
        { status: 403 },
      );
    }
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
    const result =
      await getServerApiClients().registry.updateControlledDocumentPackageStatus(
        packageId,
        body.target_status,
        context,
      );
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "CONTROLLED_DOCUMENTATION_STATUS_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Stav balíčku se nepodařilo změnit.",
        },
      },
      { status: 502 },
    );
  }
}
