import { NextResponse } from "next/server";

import { ApiClientError } from "@/lib/types";

export function workflowBadRequest(message: string) {
  return NextResponse.json(
    {
      error: {
        code: "BAD_REQUEST",
        message
      }
    },
    { status: 400 }
  );
}

export function workflowBridgeError(error: unknown) {
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
        code: "WORKFLOW_TASK_ERROR",
        message: "Workflow task request failed."
      }
    },
    { status: 500 }
  );
}
