import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContextForRequest } from "@/lib/api/server";
import type { StratosArchitectureEvidenceResolveRequest } from "@/lib/types/api";

import { stratosBridgeError } from "../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const operations = new Set(["link", "open", "status", "export"]);

function validRequest(value: unknown): value is StratosArchitectureEvidenceResolveRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().join(",") ===
    "correlation_id,document_id,document_version_id,operation,schemaVersion" &&
    record.schemaVersion === "akb-stratos-architecture-evidence-1" &&
    typeof record.document_id === "string" && record.document_id.length > 0 && record.document_id.length <= 128 &&
    typeof record.document_version_id === "string" && record.document_version_id.length > 0 && record.document_version_id.length <= 128 &&
    typeof record.operation === "string" && operations.has(record.operation) &&
    typeof record.correlation_id === "string" && record.correlation_id.length > 0 && record.correlation_id.length <= 128;
}

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    if (!validRequest(body)) {
      return NextResponse.json(
        { error: { code: "STRATOS_ARCHITECTURE_EVIDENCE_INVALID", message: "Invalid exact evidence request." } },
        { status: 400 }
      );
    }
    const context = await getServerRequestContextForRequest(request);
    if (body.correlation_id !== context.correlationId) {
      return NextResponse.json(
        { error: { code: "STRATOS_ARCHITECTURE_EVIDENCE_CORRELATION_CONFLICT", message: "Correlation id does not match the current request." } },
        { status: 409 }
      );
    }
    const evidence = await getServerApiClients().registry.resolveStratosArchitectureEvidence(body, context);
    return NextResponse.json(evidence, {
      status: 200,
      headers: { "Cache-Control": "private, no-store" }
    });
  } catch (error) {
    return stratosBridgeError(error);
  }
}
