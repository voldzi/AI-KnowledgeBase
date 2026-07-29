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
    const authorization =
      await getServerApiClients().registry.getAuthorizationHints(context);
    if (!authorization.can_update) {
      return NextResponse.json(
        {
          error: {
            code: "CONTROLLED_RULE_EXTRACTION_FORBIDDEN",
            message: "Návrh pravidel může spustit pouze gestor dokumentace.",
          },
        },
        { status: 403 },
      );
    }
    const body = await request.json();
    const result = await getServerApiClients().rag.proposeControlledRules(
      {
        ...body,
        tenant_id: "org_stratos",
        external_system: "STRATOS_PLATFORM",
        subject_id: context.subjectId,
        profile: "controlled_document_rules_v1",
        profile_version: "1",
      },
      context,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return controlledDocumentationBridgeError(
      error,
      "CONTROLLED_RULE_EXTRACTION_FAILED",
      "Návrh pravidel se nepodařilo vytvořit.",
    );
  }
}
