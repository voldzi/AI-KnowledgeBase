import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import { requireApiAccess } from "@/lib/auth/server-route-guard";
import {
  ApiClientError,
  type AnalystSearchField,
  type AnalystSearchMode,
  type CreateAnalystSavedQueryRequest
} from "@/lib/types";

export const runtime = "nodejs";

const SEARCH_MODES = new Set(["smart", "boolean", "phrase", "proximity", "fielded"]);
const SEARCH_FIELDS = new Set(["all", "title", "body", "section", "entity", "source"]);

export async function POST(request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  let payload: CreateAnalystSavedQueryRequest;
  try {
    payload = sanitizePayload(await request.json());
  } catch {
    return savedQueryBadRequest("Invalid saved query payload.");
  }

  try {
    const { caseId } = await params;
    const requestContext = await getServerRequestContext();
    const forbidden = requireApiAccess(requestContext, "knowledge_workspace");
    if (forbidden) return forbidden;

    const clients = getServerApiClients();
    const savedQuery = await clients.registry.createAnalystSavedQuery(caseId, payload, requestContext);
    return NextResponse.json(savedQuery, { status: 201 });
  } catch (error) {
    return savedQueryBridgeError(error);
  }
}

function sanitizePayload(value: unknown): CreateAnalystSavedQueryRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid payload");
  }
  const body = value as Record<string, unknown>;
  const title = optionalString(body.title, 240);
  const queryText = optionalString(body.query_text, 1000);
  if (!title || !queryText) {
    throw new Error("Missing title or query");
  }
  return {
    title,
    query_text: queryText,
    query_mode: searchMode(body.query_mode),
    search_fields: searchFields(body.search_fields),
    filters: record(body.filters),
  };
}

function optionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function searchMode(value: unknown): AnalystSearchMode {
  return typeof value === "string" && SEARCH_MODES.has(value) ? (value as AnalystSearchMode) : "smart";
}

function searchFields(value: unknown): AnalystSearchField[] {
  if (!Array.isArray(value)) return ["all"];
  const fields = value.filter((item): item is AnalystSearchField => typeof item === "string" && SEARCH_FIELDS.has(item));
  if (fields.length === 0 || fields.includes("all")) return ["all"];
  return [...new Set(fields)].slice(0, 8);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function savedQueryBadRequest(message: string) {
  return NextResponse.json({ error: { code: "BAD_ANALYST_SAVED_QUERY_REQUEST", message } }, { status: 400 });
}

function savedQueryBridgeError(error: unknown) {
  if (isNextRedirectError(error)) throw error;
  if (error instanceof ApiClientError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, trace_id: error.traceId } },
      { status: error.status },
    );
  }
  return NextResponse.json(
    { error: { code: "ANALYST_SAVED_QUERY_ERROR", message: "Saving analyst query failed." } },
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
