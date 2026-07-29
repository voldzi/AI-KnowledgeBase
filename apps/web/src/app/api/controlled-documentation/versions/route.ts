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
    const documentId = request.nextUrl.searchParams.get("document_id");
    if (!documentId) {
      return NextResponse.json(
        {
          error: {
            code: "DOCUMENT_ID_REQUIRED",
            message: "Vyberte dokument.",
          },
        },
        { status: 422 },
      );
    }
    const versions =
      await getServerApiClients().registry.listDocumentVersions(
        documentId,
        context,
      );
    return NextResponse.json({ items: versions });
  } catch (error) {
    return controlledDocumentationBridgeError(
      error,
      "DOCUMENT_VERSIONS_UNAVAILABLE",
      "Verze dokumentu se nepodařilo načíst.",
    );
  }
}
