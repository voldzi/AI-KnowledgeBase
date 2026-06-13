import { NextResponse } from "next/server";

import { ApiClientError } from "@/lib/types";
import { SourceDownloadError } from "@/lib/upload/source-download";
import { UploadPreflightError } from "@/lib/upload/preflight";

function isNextRedirectError(error: unknown): boolean {
  const digest = typeof error === "object" && error !== null && "digest" in error ? (error as { digest?: unknown }).digest : undefined;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

export function stratosBridgeError(error: unknown) {
  if (isNextRedirectError(error)) {
    throw error;
  }

  if (error instanceof ApiClientError || error instanceof UploadPreflightError || error instanceof SourceDownloadError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: "details" in error ? error.details : {},
          trace_id: error instanceof ApiClientError ? error.traceId : "web-stratos-bridge"
        }
      },
      { status: error.status }
    );
  }

  return NextResponse.json(
    {
      error: {
        code: "STRATOS_DOCUMENT_BRIDGE_ERROR",
        message: "STRATOS document bridge request failed.",
        trace_id: "web-stratos-bridge"
      }
    },
    { status: 500 }
  );
}
