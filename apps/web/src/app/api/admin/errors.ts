import { NextResponse } from "next/server";

import { ApiClientError } from "@/lib/types";

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
        code: "ADMIN_ACCESS_ERROR",
        message: "Admin access request failed."
      }
    },
    { status: 500 }
  );
}
