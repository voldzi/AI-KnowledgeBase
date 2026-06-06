import { NextResponse } from "next/server";

import { ApiClientError } from "@/lib/types";

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
