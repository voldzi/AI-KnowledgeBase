import { NextRequest, NextResponse } from "next/server";

import {
  assistantReportPdfMimeType,
  buildAssistantReportPdf,
  safeAssistantReportPdfFilename
} from "@/lib/reporting/assistant-report-pdf";
import {
  assistantReportXlsxMimeType,
  buildAssistantReportXlsx,
  normalizeAssistantReportArtifact,
  safeAssistantReportFilename
} from "@/lib/reporting/assistant-report-xlsx";
import { AssistantReportValidationError } from "@/lib/reporting/assistant-report-validation-error";
import {
  getOptionalServerRequestContext,
  getServerApiClients,
} from "@/lib/api/server";

import { assistantBridgeError, badAssistantRequest, unauthorizedAssistantRequest } from "../../errors";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const context = await getOptionalServerRequestContext(request);
    if (!context) {
      return unauthorizedAssistantRequest();
    }

    const body = await request.json();
    const bodyContext = _objectContext(body);
    if (
      context.authorizationSource === "stratos_projection" &&
      !context.capabilities?.includes("akb:export")
    ) {
      return policyExportDenied("CAPABILITY_MISSING", "Export capability is required.");
    }
    const report = normalizeAssistantReportArtifact(bodyContext.report ?? body);
    const citationsByDocument = reportCitationPolicyHashes(report);
    if (citationsByDocument.size === 0) {
      return policyExportDenied("POLICY_UNAVAILABLE", "Export requires source policy bindings.");
    }
    const registry = getServerApiClients().registry;
    const decisions = await Promise.all(
      [...citationsByDocument.entries()].map(async ([documentId, hashes]) => ({
        documentId,
        hashes,
        decision: await registry.authorizeDocument(
          documentId,
          "rag.export",
          context,
        ),
      })),
    );
    const obligations = new Set<string>();
    const policyBindings = new Set<string>();
    for (const { hashes, decision } of decisions) {
      if (!decision.allowed) {
        return policyExportDenied(
          decision.reason_codes[0] ?? "EXPORT_DENIED",
          "Current STRATOS access or source policy denies this export.",
        );
      }
      const currentHash = textValue(decision.constraints.policy_hash);
      if (!currentHash || hashes.size !== 1 || !hashes.has(currentHash)) {
        return policyExportDenied(
          "POLICY_HASH_MISMATCH",
          "The report cites a stale or incomplete source policy snapshot.",
        );
      }
      const bindingId = textValue(decision.constraints.policy_binding_id);
      if (bindingId) policyBindings.add(bindingId);
      for (const obligation of stringList(decision.constraints.obligations)) {
        obligations.add(obligation);
      }
    }
    if (obligations.has("NO_EXPORT")) {
      return policyExportDenied("EXPORT_DENIED", "The information policy prohibits export.");
    }
    if (obligations.has("WATERMARK")) {
      return policyExportDenied("OBLIGATION_UNSATISFIED", "This export requires a watermark that is not available.");
    }
    const format = bodyContext.format === "pdf" ? "pdf" : "xlsx";
    const file = format === "pdf" ? buildAssistantReportPdf(report) : buildAssistantReportXlsx(report);
    const filename = format === "pdf" ? safeAssistantReportPdfFilename(report) : safeAssistantReportFilename(report);

    return new NextResponse(new Uint8Array(file), {
      status: 200,
      headers: {
        "Content-Type": format === "pdf" ? assistantReportPdfMimeType() : assistantReportXlsxMimeType(),
        "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        ...(policyBindings.size
          ? { "X-STRATOS-Policy-Bindings": [...policyBindings].sort().join(",") }
          : {})
      }
    });
  } catch (error) {
    if (error instanceof AssistantReportValidationError) {
      return badAssistantRequest(error.message);
    }
    return assistantBridgeError(error);
  }
}

function _objectContext(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function reportCitationPolicyHashes(value: unknown): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    const record = candidate as Record<string, unknown>;
    const documentId = textValue(record.document_id);
    const policyHash = textValue(record.policy_hash);
    if (documentId) {
      const hashes = result.get(documentId) ?? new Set<string>();
      if (policyHash) hashes.add(policyHash);
      result.set(documentId, hashes);
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  return result;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function policyExportDenied(code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status: 403 });
}
