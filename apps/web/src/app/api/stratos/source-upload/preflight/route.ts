import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authenticateStratosDocumentServiceJsonRequest } from "@/lib/stratos/document-service-auth";
import { sourceActor, sourceSystemForService, requiredSourceText, sourceRegistryRequest, SOURCE_UPLOAD_PURPOSE, type SourcePrepared } from "@/lib/stratos/source-intake";
import { createUploadPreflightDecision, getUploadSettings, validateUploadFileMetadata, UploadPreflightError } from "@/lib/upload/preflight";
import { applyDocumentIntakeSettings } from "@/lib/upload/document-intake";
import { parseDocumentInformationPolicy, policyHash } from "@/lib/stratos/information-policy";
import { parseDocumentVersionProfileInput } from "@/lib/documents/document-profile-validation";
import { stratosBridgeError } from "../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { principal: service, body } = await authenticateStratosDocumentServiceJsonRequest(request);
    const sourceDocument = body.document as Record<string, unknown> | undefined;
    const source = sourceSystemForService(service, sourceDocument?.external_system);
    const sourcePolicy = sourceDocument?.information_policy as Record<string, unknown> | undefined;
    const { policyHash: sourcePolicyHash, ...sourcePolicyValues } = sourcePolicy ?? {};
    const informationPolicy = parseDocumentInformationPolicy(sourcePolicyValues);
    if (typeof sourcePolicyHash !== "string" || sourcePolicyHash !== policyHash(informationPolicy)) {
      throw new UploadPreflightError(422, "SOURCE_INTAKE_EXPLICIT_POLICY_REQUIRED", "A canonical source policyHash is required.");
    }
    const correlationId = requiredSourceText(body.correlation_id);
    const sourceRevision = requiredSourceText(body.source_revision);
    const versionLabel = requiredSourceText(body.version_label);
    const actor = await sourceActor(request, requiredSourceText(body.actor_subject_id), service);
    const fileInput = body.file as Record<string, unknown> | undefined;
    if (!fileInput || Object.keys(fileInput).some(key => !["file_name", "file_size", "file_type", "sha256"].includes(key)) || typeof fileInput.file_name !== "string" || typeof fileInput.file_size !== "number"
      || typeof fileInput.file_type !== "string" || typeof fileInput.sha256 !== "string") {
      throw new UploadPreflightError(422, "SOURCE_INTAKE_FILE_INVALID", "Exact file metadata is required.");
    }
    const settings = applyDocumentIntakeSettings(getUploadSettings());
    const file = validateUploadFileMetadata({ file_name: fileInput.file_name, file_size: fileInput.file_size,
      file_type: fileInput.file_type, sha256: fileInput.sha256 }, settings);
    const prepared = await sourceRegistryRequest<SourcePrepared>("/prepare", { ...body, file }, service, actor, correlationId);
    const result = prepared.external_document;
    const document = result.document;
    const reference = result.external_document;
    if (reference.external_system !== source || reference.external_ref !== sourceDocument?.external_ref
      || reference.entity_id !== sourceDocument?.entity_id || reference.document_id !== document.document_id
      || document.policy_hash !== policyHash(informationPolicy)
      || document.policy_binding_id !== informationPolicy.policyBindingId || document.policy_version !== informationPolicy.policyVersion
      || !document.current_root_metadata_revision || !document.document_profile
      || prepared.document_profile.expected_root_metadata_revision !== document.current_root_metadata_revision) {
      throw new UploadPreflightError(502, "SOURCE_INTAKE_REGISTRATION_CONFLICT", "Registry returned a conflicting source registration.");
    }
    const profile = parseDocumentVersionProfileInput(prepared.document_profile, document.document_profile);
    const preflight = createUploadPreflightDecision({ ...file, document_id: document.document_id,
      document_profile: profile, external_document_id: reference.external_document_id,
      expected_current_document_version_id: reference.current_document_version_id,
      expected_current_ingestion_job_id: prepared.expected_current_ingestion_job_id,
      policy_binding_id: document.policy_binding_id, policy_version: document.policy_version, policy_hash: document.policy_hash,
      governance_actor_subject_id: actor.subjectId, governance_registered_by_subject_id: service.subjectId,
      governed_document_resource_id: requiredSourceText(document.governed_resource_id),
      source_governed_resource_id: requiredSourceText(sourceDocument?.parent_governed_resource_id),
      source_resource_id: requiredSourceText(sourceDocument?.entity_id), source_version: file.sha256,
      governance_scope: sourceDocument?.governance_scope as Record<string, string>,
      governance_idempotency_key: `source:${createHash("sha256").update(`${document.document_id}:${body.source_revision}`).digest("hex")}`,
      governance_correlation_id: correlationId, purpose: SOURCE_UPLOAD_PURPOSE, workflow_mode: "interactive",
      workflow_context: { source_system: source, source_revision: sourceRevision, version_label: versionLabel },
    }, settings);
    return NextResponse.json({ ...preflight, document_id: document.document_id,
      external_document_id: reference.external_document_id,
      required_authentication: { transport: "server_to_server", service_bearer: true, actor_bearer: true },
    }, { status: result.created ? 201 : 200, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return stratosBridgeError(error); }
}
