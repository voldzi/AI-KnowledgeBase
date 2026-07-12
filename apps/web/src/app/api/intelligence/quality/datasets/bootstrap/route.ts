import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContextForRequest } from "@/lib/api/server";
import { requireApiAccess } from "@/lib/auth/server-route-guard";
import { buildCorpusBaselineDataset } from "@/lib/evaluation/corpus-baseline";
import { ApiClientError } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const context = await getServerRequestContextForRequest(request);
    const forbidden = requireApiAccess(context, "intelligence");
    if (forbidden) return forbidden;

    const clients = getServerApiClients();
    const documents = await clients.registry.listDocuments(context);
    const payload = buildCorpusBaselineDataset(documents, context, { limit: 32 });
    if (payload.cases.length === 0) {
      return NextResponse.json(
        {
          error: {
            code: "QUALITY_BASELINE_EMPTY_CORPUS",
            message: "No accessible documents are available for a retrieval baseline."
          }
        },
        { status: 409 }
      );
    }
    const dataset = await clients.evaluation.createDataset(payload, context);
    return NextResponse.json(dataset, { status: 201 });
  } catch (error) {
    return qualityBridgeError(error, "QUALITY_BASELINE_CREATE_ERROR");
  }
}

function qualityBridgeError(error: unknown, fallbackCode: string) {
  if (isNextRedirectError(error)) throw error;
  if (error instanceof ApiClientError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, trace_id: error.traceId } },
      { status: error.status }
    );
  }
  return NextResponse.json(
    { error: { code: fallbackCode, message: "Retrieval quality operation failed." } },
    { status: 500 }
  );
}

function isNextRedirectError(error: unknown): boolean {
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? (error as { digest?: unknown }).digest
      : undefined;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}
