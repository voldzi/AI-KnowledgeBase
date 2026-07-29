import { NextResponse } from "next/server";

import { ApiClientError } from "@/lib/types";

function isNextRedirectError(error: unknown): boolean {
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? (error as { digest?: unknown }).digest
      : undefined;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

export function controlledDocumentationBridgeError(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
) {
  if (isNextRedirectError(error)) {
    throw error;
  }

  if (error instanceof ApiClientError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          trace_id: error.traceId,
        },
      },
      { status: error.status },
    );
  }

  return NextResponse.json(
    {
      error: {
        code: fallbackCode,
        message: fallbackMessage,
      },
    },
    { status: 500 },
  );
}
