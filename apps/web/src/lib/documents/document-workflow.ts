import type {
  DirectorySubjectOption,
  WorkflowParticipantAssignment,
  WorkflowParticipantRole,
  WorkflowParticipantValidationError,
} from "@voldzi/stratos-ui";

import type { AklLanguage } from "@/lib/i18n";
import type { DirectoryUser, DocumentAssignmentInput, DocumentType } from "@/lib/types";

export type DocumentParserProfile = "controlled_document" | "plain_text" | "ocr_heavy";
export type DocumentChunkingStrategy = "legal_structured" | "semantic" | "fixed_window";

export interface DocumentTypeCatalogEntry {
  code: DocumentType;
  label: Record<AklLanguage, string>;
  active: boolean;
  defaultClassification: "public" | "internal" | "restricted" | "confidential";
  defaultTags: string[];
  parserProfile: DocumentParserProfile;
  chunkingStrategy: DocumentChunkingStrategy;
}

export const DOCUMENT_TYPE_CATALOG: readonly DocumentTypeCatalogEntry[] = [
  entry("directive", "Směrnice", "Directive", "internal", ["controlled-document", "akb", "smernice"], "controlled_document", "legal_structured"),
  entry("regulation", "Předpis", "Regulation", "internal", ["controlled-document", "akb", "predpis"], "controlled_document", "legal_structured"),
  entry("methodology", "Metodika", "Methodology", "internal", ["controlled-document", "akb", "metodika"], "controlled_document", "legal_structured"),
  entry("policy", "Politika", "Policy", "restricted", ["controlled-document", "akb", "politika"], "controlled_document", "legal_structured"),
  entry("procedure", "Postup", "Procedure", "internal", ["controlled-document", "akb", "postup"], "controlled_document", "legal_structured"),
  entry("manual", "Manuál", "Manual", "internal", ["controlled-document", "akb", "manual"], "controlled_document", "semantic"),
  entry("knowledge_base_article", "Znalostní článek", "Knowledge base article", "internal", ["knowledge-base", "akb"], "plain_text", "semantic"),
  entry("project_documentation", "Projektová dokumentace", "Project documentation", "internal", ["controlled-document", "akb", "projekt"], "controlled_document", "semantic"),
  entry("meeting_record", "Záznam jednání", "Meeting record", "internal", ["meeting-record", "akb"], "plain_text", "semantic"),
  entry("contract", "Smlouva", "Contract", "restricted", ["controlled-document", "akb", "smlouva"], "controlled_document", "semantic"),
  entry("attachment", "Příloha", "Attachment", "internal", ["attachment", "akb"], "plain_text", "semantic"),
  entry("ai_intake", "AI podnět", "AI intake", "internal", ["aiip", "ai-intake"], "plain_text", "semantic"),
  entry("ai_requirement_card", "Karta AI požadavku", "AI requirement card", "internal", ["aiip", "ai-requirement"], "controlled_document", "semantic"),
  entry("ai_security_appendix", "Bezpečnostní příloha AI", "AI security appendix", "restricted", ["aiip", "ai-security"], "controlled_document", "semantic"),
  entry("ai_governance_evidence", "AI governance evidence", "AI governance evidence", "restricted", ["aiip", "ai-governance"], "controlled_document", "semantic"),
  entry("other", "Ostatní", "Other", "internal", ["akb"], "plain_text", "semantic"),
] as const;

export const DOCUMENT_WORKFLOW_ROLE_IDS = {
  gestor: "gestor",
  approver: "approver",
} as const;

export function documentWorkflowRoles(language: AklLanguage): WorkflowParticipantRole[] {
  return [
    {
      id: DOCUMENT_WORKFLOW_ROLE_IDS.gestor,
      name: language === "cs" ? "Gestor" : "Owner",
      description: language === "cs"
        ? "Odpovídá za věcnou správnost, aktuálnost a přípravu dalších verzí."
        : "Owns factual correctness, currency and preparation of future versions.",
      order: 1,
      required: true,
      minAssignments: 1,
      maxAssignments: 1,
      allowedSubjectTypes: ["person", "organization"],
    },
    {
      id: DOCUMENT_WORKFLOW_ROLE_IDS.approver,
      name: language === "cs" ? "Schvalovatel" : "Approver",
      description: language === "cs"
        ? "Rozhoduje o schválení verze; audit vždy zaznamená konkrétního uživatele."
        : "Decides version approval; audit always records the acting user.",
      order: 2,
      required: true,
      minAssignments: 1,
      maxAssignments: 1,
      allowedSubjectTypes: ["person", "group", "organization"],
    },
  ];
}

export function directoryUsersToWorkflowSubjects(
  users: DirectoryUser[],
  currentSubjectId: string,
  language: AklLanguage,
): DirectorySubjectOption[] {
  const subjects = new Map<string, DirectorySubjectOption>();
  for (const user of users) {
    if (user.enabled === false) continue;
    const name = user.display_name || user.username || user.email?.split("@")[0] ||
      (user.subject_id === currentSubjectId
        ? language === "cs" ? "Aktuální uživatel" : "Current user"
        : user.subject_id);
    subjects.set(user.subject_id, {
      id: user.subject_id,
      name,
      type: "person",
      description: user.email || user.username || null,
      detail: user.groups[0] || null,
      group: user.groups[0] || null,
      initials: initials(name),
    });
    for (const group of user.groups) {
      const normalized = group.trim();
      if (!normalized || subjects.has(normalized)) continue;
      subjects.set(normalized, {
        id: normalized,
        name: groupLabel(normalized),
        type: "organization",
        description: language === "cs" ? "Organizační jednotka" : "Organizational unit",
      });
    }
  }
  if (!subjects.has(currentSubjectId)) {
    subjects.set(currentSubjectId, {
      id: currentSubjectId,
      name: language === "cs" ? "Aktuální uživatel" : "Current user",
      type: "person",
      detail: language === "cs" ? "Přihlášený účet" : "Signed-in account",
    });
  }
  return Array.from(subjects.values()).sort((left, right) => left.name.localeCompare(right.name, language));
}

export function initialWorkflowAssignments(currentSubjectId: string): WorkflowParticipantAssignment[] {
  return [{
    id: "gestor-primary",
    roleId: DOCUMENT_WORKFLOW_ROLE_IDS.gestor,
    subjectId: currentSubjectId,
    primary: true,
  }];
}

export function workflowAssignmentsToDocumentAssignments(
  assignments: WorkflowParticipantAssignment[],
  subjects: DirectorySubjectOption[],
): DocumentAssignmentInput[] {
  const subjectsById = new Map(subjects.map((subject) => [subject.id, subject]));
  return assignments.map((assignment) => {
    const subject = subjectsById.get(assignment.subjectId);
    return {
      role: assignment.roleId === DOCUMENT_WORKFLOW_ROLE_IDS.approver ? "approver" : "gestor",
      subject_type: subject?.type === "person" ? "user" : "group",
      subject_id: assignment.subjectId,
      display_label: subject?.name ?? null,
      is_primary: assignment.primary ?? true,
      active: true,
      sla_days: assignment.roleId === DOCUMENT_WORKFLOW_ROLE_IDS.approver ? 5 : 10,
      metadata: { source: "akb-document-workflow-v1" },
    };
  });
}

export function validateDocumentWorkflowAssignments(
  assignments: WorkflowParticipantAssignment[],
  language: AklLanguage,
): WorkflowParticipantValidationError[] {
  const gestor = assignments.find((assignment) => assignment.roleId === DOCUMENT_WORKFLOW_ROLE_IDS.gestor);
  const approver = assignments.find((assignment) => assignment.roleId === DOCUMENT_WORKFLOW_ROLE_IDS.approver);
  if (gestor && approver && gestor.subjectId === approver.subjectId) {
    return [{
      roleId: DOCUMENT_WORKFLOW_ROLE_IDS.approver,
      assignmentId: approver.id,
      message: language === "cs"
        ? "Schvalovatel musí být odlišný od gestora."
        : "The approver must be different from the owner.",
    }];
  }
  return [];
}

export function catalogEntry(documentType: DocumentType): DocumentTypeCatalogEntry {
  return DOCUMENT_TYPE_CATALOG.find((item) => item.code === documentType) ?? DOCUMENT_TYPE_CATALOG[DOCUMENT_TYPE_CATALOG.length - 1];
}

function entry(
  code: DocumentType,
  cs: string,
  en: string,
  defaultClassification: DocumentTypeCatalogEntry["defaultClassification"],
  defaultTags: string[],
  parserProfile: DocumentParserProfile,
  chunkingStrategy: DocumentChunkingStrategy,
): DocumentTypeCatalogEntry {
  return { code, label: { cs, en }, active: true, defaultClassification, defaultTags, parserProfile, chunkingStrategy };
}

function groupLabel(value: string): string {
  const part = value.split("/").filter(Boolean).at(-1) ?? value;
  return part.replaceAll("_", " ");
}

function initials(value: string): string {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}
