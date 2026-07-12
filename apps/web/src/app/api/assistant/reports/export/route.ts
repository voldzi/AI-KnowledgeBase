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
import { getOptionalServerRequestContext } from "@/lib/api/server";

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
    if (context.capabilities?.length && !context.capabilities.includes("akb:export")) {
      return policyExportDenied("CAPABILITY_MISSING", "Export capability is required.");
    }
    const policyBindings = Array.isArray(bodyContext.policy_bindings)
      ? bodyContext.policy_bindings.map(_objectContext)
      : [];
    const obligations = Array.isArray(bodyContext.obligations)
      ? bodyContext.obligations.filter((item): item is string => typeof item === "string")
      : [];
    if (context.capabilities?.length && policyBindings.length === 0) {
      return policyExportDenied("POLICY_UNAVAILABLE", "Export requires source policy bindings.");
    }
    if (obligations.includes("NO_EXPORT")) {
      return policyExportDenied("EXPORT_DENIED", "The information policy prohibits export.");
    }
    if (obligations.includes("WATERMARK")) {
      return policyExportDenied("OBLIGATION_UNSATISFIED", "This export requires a watermark that is not available.");
    }
    const report = normalizeAssistantReportArtifact(bodyContext.report ?? body);
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
        ...(policyBindings.length
          ? { "X-STRATOS-Policy-Bindings": policyBindings.map((item) => String(item.policy_binding_id ?? "")).filter(Boolean).join(",") }
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

function policyExportDenied(code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status: 403 });
}
