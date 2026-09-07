import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContextForRequest } from "@/lib/api/server";
import { requireApiAccess } from "@/lib/auth/server-route-guard";
import {
  CONTROLLED_DOCUMENT_UPLOAD_TOKEN_PURPOSE,
  createUploadPreflightDecision,
  getUploadSettings,
  UploadPreflightError,
} from "@/lib/upload/preflight";
import { applyDocumentIntakeSettings } from "@/lib/upload/document-intake";
import { authorizeControlledDocumentUpload } from "@/lib/upload/document-intake-authorization";
import { parseDocumentVersionProfileInput } from "@/lib/documents/document-profile-validation";

import { uploadErrorResponse } from "../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = await getServerRequestContextForRequest(request);
    const forbidden = requireApiAccess(context, "knowledge_workspace");
    if (forbidden) return forbidden;
    const body = await request.json();
    const documentId = String(body.document_id ?? "");
    const registry = getServerApiClients().registry;
    const authorization = await authorizeControlledDocumentUpload({
      registry,
      context,
      documentId,
    });
    const informationPolicy = authorization.informationPolicy;
    const documentProfile = parseDocumentVersionProfileInput(body.document_profile, authorization.document.document_profile!);
    if (documentProfile.expected_root_metadata_revision !== authorization.document.current_root_metadata_revision) {
      throw new UploadPreflightError(409, "UPLOAD_DOCUMENT_PROFILE_STALE", "Document metadata changed before upload preparation.");
    }
    const currentAttempt = await registry.getDocumentIngestionAttempt(documentId, context);
    const preflight = createUploadPreflightDecision(
      {
        document_id: documentId,
        document_profile: documentProfile,
        expected_current_ingestion_job_id: currentAttempt?.ingestion_job_id ?? null,
        file_name: String(body.file_name ?? ""),
        file_size: Number(body.file_size),
        file_type: body.file_type ? String(body.file_type) : null,
        sha256: String(body.sha256 ?? ""),
        policy_binding_id: informationPolicy.policyBindingId,
        policy_version: informationPolicy.policyVersion,
        policy_hash: authorization.policyHash,
        governance_actor_subject_id: context.subjectId,
        governance_correlation_id: context.correlationId ?? context.requestId ?? null,
        purpose: CONTROLLED_DOCUMENT_UPLOAD_TOKEN_PURPOSE,
      },
      applyDocumentIntakeSettings(getUploadSettings()),
    );

    return NextResponse.json({ preflight }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return uploadErrorResponse(error);
  }
}
