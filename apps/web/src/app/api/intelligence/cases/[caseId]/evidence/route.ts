import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import { requireApiAccess } from "@/lib/auth/server-route-guard";
import { ApiClientError, type CreateAnalystEvidenceRequest } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  let payload: CreateAnalystEvidenceRequest;
  try {
    payload = sanitizePayload(await request.json());
  } catch {
    return evidenceBadRequest("Invalid evidence payload.");
  }

  try {
    const { caseId } = await params;
    const requestContext = await getServerRequestContext();
    const forbidden = requireApiAccess(requestContext, "knowledge_workspace");
    if (forbidden) return forbidden;

    const clients = getServerApiClients();
    const evidence = await clients.registry.createAnalystEvidence(caseId, payload, requestContext);
    return NextResponse.json(evidence, { status: 201 });
  } catch (error) {
    return evidenceBridgeError(error);
  }
}

function sanitizePayload(value: unknown): CreateAnalystEvidenceRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid payload");
  }
  const body = value as Record<string, unknown>;
  const title = optionalString(body.title, 300);
  if (!title) {
    throw new Error("Missing title");
  }
  return {
    title,
    note: optionalString(body.note, 4000),
    document_id: optionalString(body.document_id, 64),
    document_version_id: optionalString(body.document_version_id, 64),
    document_title: optionalString(body.document_title, 300),
    chunk_id: optionalString(body.chunk_id, 128),
    page_number: positiveInteger(body.page_number),
    section_title: optionalString(body.section_title, 300),
    source_file_name: optionalString(body.source_file_name, 300),
    score: finiteNumber(body.score),
    snippet: optionalString(body.snippet, 2000),
    entity_types: stringList(body.entity_types, 50, 256),
    entity_values: stringList(body.entity_values, 100, 256),
    metadata: record(body.metadata),
  };
}

function optionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.trunc(parsed);
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringList(value: unknown, maxLength: number, itemLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const normalized = item.trim().slice(0, itemLength);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    items.push(normalized);
    if (items.length >= maxLength) break;
  }
  return items;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function evidenceBadRequest(message: string) {
  return NextResponse.json({ error: { code: "BAD_ANALYST_EVIDENCE_REQUEST", message } }, { status: 400 });
}

function evidenceBridgeError(error: unknown) {
  if (isNextRedirectError(error)) throw error;
  if (error instanceof ApiClientError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, trace_id: error.traceId } },
      { status: error.status },
    );
  }
  return NextResponse.json(
    { error: { code: "ANALYST_EVIDENCE_ERROR", message: "Adding analyst evidence failed." } },
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
