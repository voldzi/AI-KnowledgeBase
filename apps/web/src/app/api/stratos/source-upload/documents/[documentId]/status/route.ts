import { NextRequest, NextResponse } from "next/server";
import { authenticateStratosDocumentServiceJsonRequest } from "@/lib/stratos/document-service-auth";
import { sourceActor, sourceRegistryRequest, requiredSourceText, sourceSystemForService } from "@/lib/stratos/source-intake";
import { UploadPreflightError } from "@/lib/upload/preflight";
import { stratosBridgeError } from "../../../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ documentId: string }> }) {
  try {
    const { documentId } = await context.params;
    const { principal: service, body } = await authenticateStratosDocumentServiceJsonRequest(request);
    sourceSystemForService(service, service.allowedSourceSystems[0]);
    if (Object.keys(body).some(key => !["actor_subject_id", "correlation_id"].includes(key))) {
      throw new UploadPreflightError(422, "SOURCE_INTAKE_STATUS_INVALID", "Status accepts only the actor and correlation identifiers.");
    }
    const correlationId = requiredSourceText(body.correlation_id);
    const actor = await sourceActor(request, requiredSourceText(body.actor_subject_id), service);
    const result = await sourceRegistryRequest<{ document_id: string; external_document_id: string }>(`/documents/${encodeURIComponent(documentId)}/status`, body, service, actor, correlationId);
    if (result.document_id !== documentId || !result.external_document_id) {
      throw new UploadPreflightError(502, "SOURCE_INTAKE_STATUS_CONFLICT", "Registry returned a conflicting document status.");
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return stratosBridgeError(error); }
}
