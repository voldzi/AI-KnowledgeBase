import { NextRequest, NextResponse } from "next/server";
import { getServerApiClients, getServerRequestContextForRequest } from "@/lib/api/server";
import { requireApiAccess } from "@/lib/auth/server-route-guard";
import { workflowBadRequest, workflowBridgeError } from "@/app/api/workflow/errors";

export const runtime = "nodejs";

export async function POST(request: NextRequest, route: { params: Promise<{ documentId: string; versionId: string }> }) {
  try {
    const context = await getServerRequestContextForRequest(request);
    const forbidden = requireApiAccess(context, "knowledge_workspace");
    if (forbidden) return forbidden;
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return workflowBadRequest("Invalid review request.");
    const fields = body as Record<string, unknown>;
    if (Object.keys(fields).some((key) => key !== "comment") ||
      (fields.comment != null && (typeof fields.comment !== "string" || fields.comment.length > 1000))) {
      return workflowBadRequest("Invalid review comment.");
    }
    const { documentId, versionId } = await route.params;
    const task = await getServerApiClients().registry.submitDocumentReview(
      documentId, versionId, { comment: fields.comment as string | null | undefined }, context,
    );
    return NextResponse.json({ task }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return workflowBridgeError(error);
  }
}
