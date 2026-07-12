import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import { requireApiAccess } from "@/lib/auth/server-route-guard";
import { authorizedIndexSelection, indexHitMatchesSelection } from "@/lib/intelligence/policy-filter";
import { ApiClientError, type AnalystSearchField, type AnalystSearchMode, type AnalystSearchRequest } from "@/lib/types";

export const runtime = "nodejs";

const SEARCH_MODES = new Set(["smart", "boolean", "phrase", "proximity", "fielded"]);
const SEARCH_FIELDS = new Set(["all", "title", "body", "section", "entity", "source"]);

export async function POST(request: NextRequest) {
  let payload: AnalystSearchRequest;
  try {
    payload = sanitizePayload(await request.json());
  } catch {
    return analystBadRequest("Invalid JSON body.");
  }

  try {
    const requestContext = await getServerRequestContext();
    const forbidden = requireApiAccess(requestContext, "knowledge_workspace");
    if (forbidden) return forbidden;

    const clients = getServerApiClients();
    const documents = await clients.registry.listDocuments(requestContext);
    const selection = authorizedIndexSelection(documents, requestContext);
    const response = await clients.ingestion.analystSearch(
      {
        ...payload,
        allowed_document_ids: selection.documentIds,
        allowed_policy_hashes: selection.policyHashes,
      },
      requestContext,
    );
    const authorizedHits = response.hits.filter((hit) => indexHitMatchesSelection(hit, selection));

    return NextResponse.json({
      ...response,
      hits: authorizedHits,
      returned_hits: authorizedHits.length,
    });
  } catch (error) {
    return analystBridgeError(error);
  }
}

function sanitizePayload(value: unknown): AnalystSearchRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid payload");
  }
  const body = value as Record<string, unknown>;
  return {
    query: optionalString(body.query, 500),
    query_mode: searchMode(body.query_mode),
    search_fields: searchFields(body.search_fields),
    proximity_slop: clampNumber(body.proximity_slop, 5, 1, 25),
    entity_type: optionalString(body.entity_type, 80),
    entity_value: optionalString(body.entity_value, 256),
    document_type: optionalString(body.document_type, 80),
    classification: optionalString(body.classification, 80),
    status: optionalString(body.status, 80),
    limit: clampNumber(body.limit, 12, 1, 50),
  };
}

function optionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function searchMode(value: unknown): AnalystSearchMode {
  return typeof value === "string" && SEARCH_MODES.has(value) ? (value as AnalystSearchMode) : "smart";
}

function searchFields(value: unknown): AnalystSearchField[] {
  if (!Array.isArray(value)) {
    return ["all"];
  }
  const fields = value.filter((item): item is AnalystSearchField => typeof item === "string" && SEARCH_FIELDS.has(item));
  if (fields.length === 0 || fields.includes("all")) {
    return ["all"];
  }
  return [...new Set(fields)].slice(0, 8);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function analystBadRequest(message: string) {
  return NextResponse.json(
    {
      error: {
        code: "BAD_ANALYST_SEARCH_REQUEST",
        message,
      },
    },
    { status: 400 },
  );
}

function analystBridgeError(error: unknown) {
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
        code: "ANALYST_SEARCH_ERROR",
        message: "Analyst search failed.",
      },
    },
    { status: 500 },
  );
}

function isNextRedirectError(error: unknown): boolean {
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? (error as { digest?: unknown }).digest
      : undefined;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}
