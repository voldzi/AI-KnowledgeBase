import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import type { Classification, DocumentType } from "@/lib/types";
import { isAklLanguage } from "@/lib/language";

import { badRequest, bridgeError } from "../errors";

export const runtime = "nodejs";

const DEFAULT_DOCUMENT_TYPES: DocumentType[] = [
  "project_documentation",
  "directive",
  "methodology",
  "knowledge_base_article",
  "policy"
];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const context = await getServerRequestContext();
    const clients = getServerApiClients();
    const query = String(body.query ?? "").trim();

    if (!query) {
      return badRequest("query is required.");
    }

    const answer = await clients.rag.query(
      {
        subject_id: context.subjectId,
        query,
        filters: {
          document_types: _stringList(body.document_types, DEFAULT_DOCUMENT_TYPES) as DocumentType[],
          only_valid: body.only_valid !== false,
          classification_max: String(body.classification_max ?? "internal") as Classification,
          tags: _stringList(body.tags, [])
        },
        answer_mode: "normative_with_citations",
        max_chunks: Number(body.max_chunks ?? 8),
        response_language: isAklLanguage(body.response_language) ? body.response_language : "cs"
      },
      context
    );

    return NextResponse.json({ answer });
  } catch (error) {
    return bridgeError(error);
  }
}

function _stringList(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return fallback;
}
