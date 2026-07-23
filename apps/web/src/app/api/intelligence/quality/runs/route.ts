import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContextForRequest } from "@/lib/api/server";
import { requireApiAccess } from "@/lib/auth/server-route-guard";
import { parseEvaluationCaseIds } from "@/lib/evaluation-run-request";
import { ApiClientError } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const datasetId = typeof body.dataset_id === "string" ? body.dataset_id.trim() : "";
    if (!/^[A-Za-z0-9_.:-]+$/.test(datasetId)) {
      return NextResponse.json(
        { error: { code: "INVALID_DATASET_ID", message: "A valid evaluation dataset is required." } },
        { status: 400 }
      );
    }
    const parsedCaseIds = parseEvaluationCaseIds(body.case_ids);
    if (!parsedCaseIds.ok) {
      return NextResponse.json(
        { error: { code: parsedCaseIds.code, message: parsedCaseIds.message } },
        { status: 400 }
      );
    }

    const context = await getServerRequestContextForRequest(request);
    const forbidden = requireApiAccess(context, "intelligence");
    if (forbidden) return forbidden;
    const clients = getServerApiClients();
    const run = await clients.evaluation.runEvaluation(
      {
        dataset_id: datasetId,
        subject_id_override: context.subjectId,
        max_cases: clampMaxCases(body.max_cases),
        case_ids: parsedCaseIds.caseIds
      },
      context
    );
    return NextResponse.json(run);
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    if (error instanceof ApiClientError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message, trace_id: error.traceId } },
        { status: error.status }
      );
    }
    return NextResponse.json(
      { error: { code: "QUALITY_RUN_ERROR", message: "Retrieval quality run failed." } },
      { status: 500 }
    );
  }
}

function clampMaxCases(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(200, Math.max(1, Math.trunc(parsed)));
}

function isNextRedirectError(error: unknown): boolean {
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? (error as { digest?: unknown }).digest
      : undefined;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}
