import { NextResponse } from "next/server";

import { ApiClientError } from "@/lib/types";

export function badRequest(message: string, status = 400) {
  return NextResponse.json(
    {
      error: {
        code: "BAD_REQUEST",
        message
      }
    },
    { status }
  );
}

export function bridgeError(error: unknown) {
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
        code: "CONTROLLED_DOCUMENT_WORKFLOW_ERROR",
        message: "Controlled document workflow request failed."
      }
    },
    { status: 500 }
  );
}
