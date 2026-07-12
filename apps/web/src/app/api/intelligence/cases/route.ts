import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import { requireApiAccess } from "@/lib/auth/server-route-guard";
import { ApiClientError, type CreateAnalystCaseRequest } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const requestContext = await getServerRequestContext();
    const forbidden = requireApiAccess(requestContext, "knowledge_workspace");
    if (forbidden) return forbidden;

    const clients = getServerApiClients();
    const cases = await clients.registry.listAnalystCases(requestContext);
    return NextResponse.json({ items: cases });
  } catch (error) {
    return caseBridgeError(error);
  }
}

export async function POST(request: NextRequest) {
  let payload: CreateAnalystCaseRequest;
  try {
    payload = sanitizeCreateCase(await request.json());
  } catch {
    return caseBadRequest("Invalid analyst case payload.");
  }

  try {
    const requestContext = await getServerRequestContext();
    const forbidden = requireApiAccess(requestContext, "knowledge_workspace");
    if (forbidden) return forbidden;

    const clients = getServerApiClients();
    const analystCase = await clients.registry.createAnalystCase(payload, requestContext);
    return NextResponse.json(analystCase, { status: 201 });
  } catch (error) {
    return caseBridgeError(error);
  }
}

function sanitizeCreateCase(value: unknown): CreateAnalystCaseRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid payload");
  }
  const body = value as Record<string, unknown>;
  const title = optionalString(body.title, 240);
  if (!title) {
    throw new Error("Missing title");
  }
  return {
    title,
    description: optionalString(body.description, 4000),
    classification: optionalString(body.classification, 80) ?? "internal",
    tags: stringList(body.tags, 50, 80),
    metadata: record(body.metadata),
  };
}

function optionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
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
