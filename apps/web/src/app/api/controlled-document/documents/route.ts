import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import { requireApiAccess } from "@/lib/auth/server-route-guard";
import type { Classification, DocumentAssignmentInput, DocumentType } from "@/lib/types";
import { createDefaultInformationPolicy, parseInformationPolicy } from "@/lib/stratos/information-policy";

import { badRequest, bridgeError } from "../errors";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const context = await getServerRequestContext();
    const forbidden = requireApiAccess(context, "knowledge_workspace");
    if (forbidden) return forbidden;
    const clients = getServerApiClients();
    const classification = String(body.classification ?? "internal") as Classification;
    const title = String(body.title ?? "").trim();
    const assignments = assignmentInputs(body.assignments);
    const gestor = assignments.find((assignment) => assignment.role === "gestor");
    const approver = assignments.find((assignment) => assignment.role === "approver");

    if (!title) {
      return badRequest("Document title is required.");
    }
    if (!gestor || !approver) {
      return badRequest("Document gestor and approver are required.");
    }

    const gestorSubjects = assignmentSubjects([gestor]);
    const approverSubjects = assignmentSubjects([approver]);
    const participantSubjects = Array.from(new Set([...gestorSubjects, ...approverSubjects]));
    const informationPolicy = body.information_policy
      ? parseInformationPolicy(body.information_policy)
      : createDefaultInformationPolicy({
          classification,
          ownerSubjectId: gestor.subject_id,
          contentCategories: classification === "public" ? ["PUBLIC_INFORMATION"] : []
        });

    const document = await clients.registry.createDocument(
      {
        title,
        document_type: String(body.document_type ?? "directive") as DocumentType,
        owner_id: gestor.subject_id,
        gestor_unit: gestor.display_label || gestor.subject_id,
        classification,
        information_policy: informationPolicy,
        tags: _csv(String(body.tags ?? "controlled-document,akb")),
        assignments,
        metadata: {
          source: "web-controlled-document-workflow",
          workflow_model: "gestor-approver-v1"
        },
        access_policies: [
          {
            subjects: Array.from(new Set([`user:${context.subjectId}`, ...participantSubjects, "role:reader"])),
            actions: ["document.read", "rag.query"],
            constraints: { classification_max: classification }
          },
          {
            subjects: Array.from(new Set([`user:${context.subjectId}`, ...gestorSubjects, "role:service_ingestion", "role:document_manager", "role:admin"])),
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
    const subjectType = candidate.subject_type === "group" ? "group" : "user";
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
      : `user:${assignment.subject_id}`
  );
}

function _csv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
