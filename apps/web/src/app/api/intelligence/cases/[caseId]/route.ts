import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import { requireApiAccess } from "@/lib/auth/server-route-guard";
import { ApiClientError, type UpdateAnalystCaseRequest } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const { caseId } = await params;
    const requestContext = await getServerRequestContext();
    const forbidden = requireApiAccess(requestContext, "knowledge_workspace");
    if (forbidden) return forbidden;

    const clients = getServerApiClients();
    return NextResponse.json(await clients.registry.getAnalystCase(caseId, requestContext));
  } catch (error) {
    return caseBridgeError(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  let payload: UpdateAnalystCaseRequest;
  try {
    payload = sanitizePatch(await request.json());
  } catch {
    return caseBadRequest("Invalid analyst case patch payload.");
  }

  try {
    const { caseId } = await params;
    const requestContext = await getServerRequestContext();
    const forbidden = requireApiAccess(requestContext, "knowledge_workspace");
    if (forbidden) return forbidden;

    const clients = getServerApiClients();
    return NextResponse.json(await clients.registry.updateAnalystCase(caseId, payload, requestContext));
  } catch (error) {
    return caseBridgeError(error);
  }
}

function sanitizePatch(value: unknown): UpdateAnalystCaseRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid payload");
  }
  const body = value as Record<string, unknown>;
  const payload: UpdateAnalystCaseRequest = {};
  const title = optionalString(body.title, 240);
  if (title) payload.title = title;
  if ("description" in body) payload.description = optionalString(body.description, 4000);
  if (body.status === "open" || body.status === "archived") payload.status = body.status;
  const classification = optionalString(body.classification, 80);
  if (classification) payload.classification = classification;
  if (Array.isArray(body.tags)) payload.tags = stringList(body.tags, 50, 80);
  if (body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)) {
    payload.metadata = body.metadata as Record<string, unknown>;
  }
  return payload;
}

function optionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function stringList(value: unknown[], maxLength: number, itemLength: number): string[] {
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

function caseBadRequest(message: string) {
  return NextResponse.json({ error: { code: "BAD_ANALYST_CASE_REQUEST", message } }, { status: 400 });
}

function caseBridgeError(error: unknown) {
  if (isNextRedirectError(error)) throw error;
  if (error instanceof ApiClientError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, trace_id: error.traceId } },
      { status: error.status },
    );
  }
  return NextResponse.json(
    { error: { code: "ANALYST_CASE_ERROR", message: "Analyst case operation failed." } },
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
