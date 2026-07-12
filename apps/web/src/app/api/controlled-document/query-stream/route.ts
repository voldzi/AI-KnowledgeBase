import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { createApiClients } from "@/lib/api";
import { getAklConfig } from "@/lib/api/config";
import { withCorrelationDefaults } from "@/lib/api/correlation";
import { getServerRequestContext } from "@/lib/api/server";
import { isAklLanguage } from "@/lib/language";
import type { Classification, DocumentType, RagAnswer, RagQueryRequest } from "@/lib/types";

export const runtime = "nodejs";

const DEFAULT_DOCUMENT_TYPES: DocumentType[] = [
  "project_documentation",
  "directive",
  "methodology",
  "knowledge_base_article",
  "policy"
];

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid JSON body." } }, { status: 400 });
  }

  const query = String(body.query ?? "").trim();
  if (!query) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "query is required." } }, { status: 400 });
  }

  const context = await getServerRequestContext();
  const config = getAklConfig();
  const ctx = withCorrelationDefaults(context);

  if (config.apiClientMode === "mock") {
    const ragRequest: RagQueryRequest = {
      subject_id: ctx.subjectId,
      query,
      filters: {
        document_types: _stringList(body.document_types, DEFAULT_DOCUMENT_TYPES) as DocumentType[],
        only_valid: body.only_valid !== false,
        classification_max: String(body.classification_max ?? "internal") as Classification,
        tags: _stringList(body.tags, []),
      },
      answer_mode: "normative_with_citations",
      max_chunks: Number(body.max_chunks ?? 8),
      response_language: isAklLanguage(body.response_language) ? body.response_language : "cs",
    };
    const clients = createApiClients();
    const answer: RagAnswer = await clients.rag.query(ragRequest, ctx);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ kind: "done", delta: "", answer })}\n\n`));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
    });
  }

  const headers = new Headers({
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "X-Request-ID": ctx.requestId,
    "X-Correlation-ID": ctx.correlationId,
    "X-AKL-Subject": ctx.subjectId,
  });
  if (ctx.authorizationSource === "mock") {
    if (ctx.roles?.length) headers.set("X-AKL-Roles", ctx.roles.join(","));
    if (ctx.groups?.length) headers.set("X-AKL-Groups", ctx.groups.join(","));
  }
  if (ctx.accessToken) headers.set("Authorization", `Bearer ${ctx.accessToken}`);

  let upstream: Response;
  try {
    upstream = await fetch(`${config.serviceBaseUrls.rag}/api/v1/rag/query-stream`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        subject_id: ctx.subjectId,
        query,
        filters: {
          document_types: _stringList(body.document_types, DEFAULT_DOCUMENT_TYPES) as DocumentType[],
          only_valid: body.only_valid !== false,
          classification_max: String(body.classification_max ?? "internal") as Classification,
          tags: _stringList(body.tags, []),
        },
        answer_mode: "normative_with_citations",
        max_chunks: Number(body.max_chunks ?? 8),
        response_language: isAklLanguage(body.response_language) ? body.response_language : "cs",
      }),
      cache: "no-store",
    });
  } catch (err) {
    return NextResponse.json(
      { error: { code: "UPSTREAM_UNAVAILABLE", message: String(err) } },
      { status: 502 }
    );
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: { code: "UPSTREAM_ERROR", message: text || "Upstream returned an error." } },
      { status: upstream.status >= 400 ? upstream.status : 502 }
    );
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}

function _stringList(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return fallback;
}
