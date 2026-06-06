import { NextResponse } from "next/server";

import { ApiClientError } from "@/lib/types";

export function documentWorkflowBadRequest(message: string, status = 400) {
  return NextResponse.json(
    {
      error: {
        code: "BAD_DOCUMENT_WORKFLOW_REQUEST",
        message,
        trace_id: "web-document-workflow"
      }
    },
    { status }
  );
}

export function documentWorkflowBridgeError(error: unknown) {
  if (error instanceof ApiClientError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          trace_id: error.traceId
        }
      },
      { status: error.status }
    );
  }

  return NextResponse.json(
    {
      error: {
        code: "DOCUMENT_WORKFLOW_ERROR",
        message: "Document workflow request failed."
      }
    },
    { status: 500 }
  );
}
