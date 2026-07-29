import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContextForRequest } from "@/lib/api/server";
import { requireApiAccess } from "@/lib/auth/server-route-guard";
import { controlledDocumentationBridgeError } from "../../../errors";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ extractionId: string }> },
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
            code: "CONTROLLED_RULE_REVIEW_FORBIDDEN",
            message: "Pravidlo může potvrdit pouze schvalovatel.",
          },
        },
        { status: 403 },
      );
    }
    const { extractionId } = await params;
    const body = await request.json();
    await getServerApiClients().registry.recordControlledRuleFeedback(
      extractionId,
      {
        ...body,
        actor: context.subjectId,
        source_app: "STRATOS_PLATFORM",
      },
      context,
    );
    return NextResponse.json({ status: "recorded" });
  } catch (error) {
    return controlledDocumentationBridgeError(
      error,
      "CONTROLLED_RULE_REVIEW_FAILED",
      "Rozhodnutí o pravidle se nepodařilo uložit.",
    );
  }
}
