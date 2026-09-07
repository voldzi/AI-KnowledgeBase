import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContextForRequest } from "@/lib/api/server";
import { requireApiAccess } from "@/lib/auth/server-route-guard";
import type { ReplaceDocumentAssignmentsRequest } from "@/lib/types";
import { ApiClientError } from "@/lib/types";
import { parseDocumentProfileInput } from "@/lib/documents/document-profile-validation";
import { UploadPreflightError } from "@/lib/upload/preflight";
import { uploadErrorResponse } from "@/app/api/controlled-document/upload/errors";

import { documentWorkflowBridgeError } from "../../errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{
    documentId: string;
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { documentId } = await context.params;
    const requestContext = await getServerRequestContextForRequest(request);
    const clients = getServerApiClients();
    const assignments = await clients.registry.listDocumentAssignments(documentId, requestContext);

    return NextResponse.json({ assignments });
  } catch (error) {
    return documentWorkflowBridgeError(error);
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { documentId } = await context.params;
    const payload = (await request.json()) as ReplaceDocumentAssignmentsRequest;
    const requestContext = await getServerRequestContextForRequest(request);
    const forbidden = requireApiAccess(requestContext, "knowledge_workspace");
    if (forbidden) return forbidden;
    const clients = getServerApiClients();
    payload.document_profile = parseDocumentProfileInput(payload.document_profile);
    if (typeof payload.expected_root_metadata_revision !== "string" || !/^\S{1,160}$/.test(payload.expected_root_metadata_revision)) {
      throw new ApiClientError("Current root metadata revision is required.", 422, "DOCUMENT_PROFILE_REQUIRED", "web-document-assignments");
    }
    const assignments = await clients.registry.replaceDocumentAssignments(documentId, payload, requestContext);

    return NextResponse.json({ assignments });
  } catch (error) {
    if (error instanceof UploadPreflightError) return uploadErrorResponse(error);
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_JSON",
            message: "Request body must be valid JSON.",
            trace_id: "web-document-assignments"
          }
        },
        { status: 400 }
      );
    }
    return documentWorkflowBridgeError(error);
  }
}
