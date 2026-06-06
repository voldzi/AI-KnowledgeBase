import { NextResponse } from "next/server";

import { UploadPreflightError } from "@/lib/upload/preflight";

export function uploadErrorResponse(error: unknown) {
  if (error instanceof UploadPreflightError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details
        }
      },
      { status: error.status }
    );
  }

  return NextResponse.json(
    {
      error: {
        code: "UPLOAD_WORKFLOW_ERROR",
        message: "Upload workflow request failed."
      }
    },
    { status: 500 }
  );
}
