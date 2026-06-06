import { NextResponse } from "next/server";

import { ApiClientError } from "@/lib/types";

export function badAssistantRequest(message: string) {
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

export function assistantBridgeError(error: unknown) {
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
        code: "ASSISTANT_WORKFLOW_ERROR",
        message: "Assistant request failed."
      }
    },
    { status: 500 }
  );
}
