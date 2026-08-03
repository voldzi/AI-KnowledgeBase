import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import { requireApiAccess } from "@/lib/auth/server-route-guard";
import type { Classification, DocumentStatus, DocumentType } from "@/lib/types";

import { documentWorkflowBadRequest, documentWorkflowBridgeError } from "./errors";

export const runtime = "nodejs";

const STATUSES = new Set<DocumentStatus>([
  "draft",
  "review",
  "approved",
  "valid",
  "superseded",
  "archived",
  "cancelled",
]);
const CLASSIFICATIONS = new Set<Classification>([
  "public",
  "internal",
  "restricted",
  "confidential",
]);
const DOCUMENT_TYPES = new Set<DocumentType>([
  "directive",
  "regulation",
  "methodology",
  "policy",
  "procedure",
  "manual",
  "knowledge_base_article",
  "project_documentation",
  "meeting_record",
  "contract",
  "attachment",
  "ai_intake",
  "ai_requirement_card",
  "ai_security_appendix",
  "ai_governance_evidence",
  "other",
]);

export async function GET(request: NextRequest) {
  try {
    const context = await getServerRequestContext();
    const forbidden = requireApiAccess(context, "knowledge_workspace");
    if (forbidden) return forbidden;

    const params = request.nextUrl.searchParams;
    const statuses = enumValues(params.getAll("status"), STATUSES);
    const classifications = enumValues(params.getAll("classification"), CLASSIFICATIONS);
    const documentTypes = enumValues(params.getAll("type"), DOCUMENT_TYPES);
    if (!statuses || !classifications || !documentTypes) {
      return documentWorkflowBadRequest("Neplatná hodnota filtru dokumentů.");
    }

    const page = await getServerApiClients().registry.listDocumentPage(context, {
      query: boundedQuery(params.get("q")),
      statuses,
      classifications,
      documentTypes,
      limit: boundedInteger(params.get("limit"), 50, 1, 100),
      offset: boundedInteger(params.get("offset"), 0, 0, 100_000),
    });
    return NextResponse.json(page, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return documentWorkflowBridgeError(error);
  }
}

function enumValues<Value extends string>(
  values: string[],
  allowed: ReadonlySet<Value>,
): Value[] | null {
  const unique = [...new Set(values)];
  return unique.every((value) => allowed.has(value as Value))
    ? unique as Value[]
    : null;
}

function boundedQuery(value: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 200) : undefined;
}

function boundedInteger(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}
