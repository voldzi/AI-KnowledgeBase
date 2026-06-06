import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import type { ReplaceDocumentAssignmentsRequest } from "@/lib/types";

import { documentWorkflowBridgeError } from "../../errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{
    documentId: string;
  }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { documentId } = await context.params;
    const requestContext = getServerRequestContext();
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
    const requestContext = getServerRequestContext();
    const clients = getServerApiClients();
    const assignments = await clients.registry.replaceDocumentAssignments(documentId, payload, requestContext);

    return NextResponse.json({ assignments });
  } catch (error) {
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
