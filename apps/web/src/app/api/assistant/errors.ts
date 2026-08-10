import { NextResponse } from "next/server";

import { ApiClientError } from "@/lib/types";

function isNextRedirectError(error: unknown): boolean {
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? (error as { digest?: unknown }).digest
      : undefined;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

export function badAssistantRequest(message: string) {
  return NextResponse.json(
    {
      error: {
        code: "BAD_REQUEST",
        message,
      },
    },
    { status: 400 },
  );
}

export function unauthorizedAssistantRequest() {
  return NextResponse.json(
    {
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication is required.",
      },
    },
    { status: 401 },
  );
}

export function assistantBridgeError(error: unknown) {
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

  if (
    (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name))
    || (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))
  ) {
    return NextResponse.json(
      {
        error: {
          code: "ASSISTANT_UPSTREAM_TIMEOUT",
          message: "Assistant source did not respond within the configured time limit.",
        },
      },
      { status: 504 },
    );
  }

  return NextResponse.json(
    {
      error: {
        code: "ASSISTANT_WORKFLOW_ERROR",
        message: "Assistant request failed.",
      },
    },
    { status: 500 },
  );
}
