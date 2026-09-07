import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContextForRequest } from "@/lib/api/server";
import { requireApiAccess } from "@/lib/auth/server-route-guard";
import type { Classification, DocumentAssignmentInput, DocumentType } from "@/lib/types";
import { createDefaultInformationPolicy, parseDocumentInformationPolicy } from "@/lib/stratos/information-policy";
import { NATIVE_DOCUMENT_PROFILES } from "@/lib/documents/document-profile";
import { parseDocumentProfileInput } from "@/lib/documents/document-profile-validation";
import { UploadPreflightError } from "@/lib/upload/preflight";
import { uploadErrorResponse } from "../upload/errors";

import { badRequest, bridgeError } from "../errors";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const context = await getServerRequestContextForRequest(request);
    const forbidden = requireApiAccess(context, "knowledge_workspace");
    if (forbidden) return forbidden;
    const clients = getServerApiClients();
    const classification = String(body.classification ?? "internal") as Classification;
    const title = String(body.title ?? "").trim();
    const assignments = assignmentInputs(body.assignments);
    const gestor = assignments.find((assignment) => assignment.role === "gestor");
    const approver = assignments.find((assignment) => assignment.role === "approver");
    const documentProfile = parseDocumentProfileInput(body.document_profile, { documentType: body.document_type, sourceSystem: "AKB" });
    const selectedProfile = NATIVE_DOCUMENT_PROFILES.find((profile) => profile.id === documentProfile?.profile?.id
      && profile.revision === documentProfile?.profile?.revision);

    if (!title) {
      return badRequest("Document title is required.");
    }
    if (!documentProfile || !selectedProfile || documentProfile.provenance?.sourceSystem !== "AKB"
      || !selectedProfile.documentTypes.includes(String(body.document_type ?? ""))) {
      return badRequest("A supported explicit document profile is required.", 422);
    }
    if (!gestor || (selectedProfile.publicationRequiresIndependentApproval && !approver)) {
      return badRequest("Assign the responsibilities required by the document profile.", 422);
    }
    if (documentProfile.accountability?.gestor?.id !== gestor.subject_id
      || documentProfile.accountability.gestor.kind !== (gestor.subject_type === "unit" ? "organization_unit" : "person")
      || !["user", "unit"].includes(gestor.subject_type ?? "user")
      || !documentProfile.accountability.ownerSubjectId) {
      return badRequest("Document responsibility does not match its assigned gestor.", 422);
    }
    assignments.unshift({ role: "owner", subject_type: "user", subject_id: documentProfile.accountability.ownerSubjectId,
      is_primary: true, active: true, metadata: { source: "akb-document-profile-v1" } });

    const gestorSubjects = assignmentSubjects([gestor]);
    const approverSubjects = assignmentSubjects(approver ? [approver] : []);
    const participantSubjects = Array.from(new Set([`user:${documentProfile.accountability.ownerSubjectId}`, ...gestorSubjects, ...approverSubjects]));
    const informationPolicy = body.information_policy
      ? parseDocumentInformationPolicy(body.information_policy)
      : createDefaultInformationPolicy({
          classification,
          ownerSubjectId: documentProfile.accountability.ownerSubjectId,
          tlp: body.tlp,
          recipientSubjectIds: Array.isArray(body.recipient_subject_ids)
            ? body.recipient_subject_ids
            : _csv(String(body.recipient_subject_ids ?? "")),
          contentCategories: classification === "public" ? ["PUBLIC_INFORMATION"] : []
        });

    const document = await clients.registry.createDocument(
      {
        title,
        document_type: String(body.document_type ?? "directive") as DocumentType,
        document_profile: documentProfile,
        owner_id: documentProfile.accountability.ownerSubjectId,
        gestor_unit: documentProfile.accountability.gestor.kind === "organization_unit"
          ? documentProfile.accountability.gestor.id : null,
        classification,
        information_policy: informationPolicy,
        tags: _csv(String(body.tags ?? "controlled-document,akb")),
        assignments,
        metadata: {
          source: "web-controlled-document-workflow",
          workflow_model: "document-profile-v1"
        },
        access_policies: [
          {
            subjects: Array.from(new Set([`user:${context.subjectId}`, ...participantSubjects, "role:reader"])),
            actions: ["document.read", "rag.query"],
            constraints: { classification_max: classification }
          },
          {
            subjects: Array.from(new Set([`user:${context.subjectId}`, `user:${documentProfile.accountability.ownerSubjectId}`, ...gestorSubjects, "role:service_ingestion", "role:document_manager", "role:admin"])),
            actions: [
              "document.update",
              "document.read",
              "document.ingest",
              "document.reindex",
              "document.version.create",
              "document.version.publish",
              "document.version.archive"
            ],
            constraints: { classification_max: classification }
          },
          {
            subjects: Array.from(new Set([...approverSubjects, "role:document_manager", "role:admin"])),
            actions: ["document.read", "document.update", "document.version.publish", "rag.query"],
            constraints: { classification_max: classification }
          }
        ]
      },
      context
    );

    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    if (error instanceof UploadPreflightError) return uploadErrorResponse(error);
    if (error instanceof SyntaxError) return NextResponse.json({ error: {
      code: "INVALID_JSON", message: "Request body must be valid JSON.", trace_id: "web-controlled-document",
    } }, { status: 400 });
    return bridgeError(error);
  }
}

function assignmentInputs(value: unknown): DocumentAssignmentInput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    const role = candidate.role === "gestor" || candidate.role === "approver" ? candidate.role : null;
    const subjectId = typeof candidate.subject_id === "string" ? candidate.subject_id.trim() : "";
    const subjectType = candidate.subject_type === "group" ? "group" : candidate.subject_type === "unit" ? "unit" : "user";
    if (!role || !subjectId) return [];
    return [{
      role,
      subject_type: subjectType,
      subject_id: subjectId,
      display_label: typeof candidate.display_label === "string" ? candidate.display_label.trim() || null : null,
      is_primary: true,
      active: true,
      sla_days: role === "approver" ? 5 : 10,
      metadata: { source: "akb-document-workflow-v1" }
    } satisfies DocumentAssignmentInput];
  });
}

function assignmentSubjects(assignments: DocumentAssignmentInput[]): string[] {
  return assignments.map((assignment) =>
    assignment.subject_type === "group"
      ? `group:${assignment.subject_id}`
      : assignment.subject_type === "unit" ? `unit:${assignment.subject_id}`
      : `user:${assignment.subject_id}`
  );
}

function _csv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
