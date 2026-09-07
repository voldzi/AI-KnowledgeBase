import catalogJson from "./document-profile-catalog.json";
import type { DocumentAssignmentInput, DocumentType } from "@/lib/types/documents";

type Label = { cs: string; en: string };
export interface ProfileField {
  name: string;
  type: string;
  required: boolean;
  nullable: boolean;
  label: Label;
  options?: { value: string; label: Label }[];
}
export interface DocumentProfileDefinition {
  id: string;
  revision: string;
  family: string;
  label: Label;
  documentTypes: string[];
  sourceSystems: string[];
  lifecycle: { modes: string[]; reviewAtRequired: boolean; reviewRuleIds: string[]; retentionRuleIds: string[] };
  domainFields: ProfileField[];
  publicationRequiresIndependentApproval?: boolean;
}
export const DOCUMENT_PROFILE_CATALOG = catalogJson;
export const DOCUMENT_PROFILES: DocumentProfileDefinition[] = catalogJson.profiles;
export const NATIVE_DOCUMENT_PROFILES = DOCUMENT_PROFILES.filter((profile) => profile.sourceSystems.includes("AKB"));

export interface DocumentAuthorInput {
  kind: "person" | "organization" | "external_authority";
  id: string;
  evidenceReference: string;
}
export interface DocumentProfileInput {
  profile: { id: string; revision: string };
  authorship: DocumentAuthorInput[];
  provenance: { sourceSystem: string; sourceRecordId: string | null; sourceGovernedResourceId: string | null };
  accountability: { ownerSubjectId: string; gestor: { kind: "person" | "organization_unit"; id: string } };
}
export interface DocumentLifecycleInput {
  mode: "fixed_interval" | "until_superseded" | "record";
  effectiveFrom: string | null;
  effectiveTo: string | null;
  recordedOn: string | null;
  reviewAt: string | null;
  reviewRuleId: string;
  retentionRuleId: string;
}
export interface DocumentVersionProfileInput {
  expected_root_metadata_revision: string;
  lifecycle: DocumentLifecycleInput;
  domain_evidence: Record<string, string | string[] | null>;
}
export interface DocumentRootSnapshot extends DocumentProfileInput {
  schemaVersion: "stratos-document-root-1";
  organizationId: "org_stratos";
  documentId: string;
  metadataRevision: string;
  documentType: string;
}

export function profileForDocumentType(documentType: DocumentType): DocumentProfileDefinition | undefined {
  return NATIVE_DOCUMENT_PROFILES.find((profile) => profile.documentTypes.includes(documentType));
}

/** Preserve historical authorship and provenance while explicitly transferring current accountability. */
export function profileWithAssignments(snapshot: DocumentRootSnapshot, assignments: DocumentAssignmentInput[]): DocumentProfileInput {
  const primary = (role: string) => assignments.filter((item) => item.role === role && item.active !== false && item.is_primary);
  const owners = primary("owner"), gestors = primary("gestor");
  if (owners.length !== 1 || (owners[0].subject_type ?? "user") !== "user" || gestors.length !== 1
    || !["user", "unit"].includes(gestors[0].subject_type ?? "user")) {
    throw new Error("Choose one primary person as owner and one primary person or organizational unit as gestor.");
  }
  return {
    profile: { ...snapshot.profile }, authorship: snapshot.authorship.map((author) => ({ ...author })),
    provenance: { ...snapshot.provenance, sourceRecordId: snapshot.provenance.sourceSystem === "AKB" ? null : snapshot.provenance.sourceRecordId },
    accountability: { ownerSubjectId: owners[0].subject_id,
      gestor: { kind: gestors[0].subject_type === "unit" ? "organization_unit" : "person", id: gestors[0].subject_id } },
  };
}

export function canonicalDocumentSnapshot(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalDocumentSnapshot).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalDocumentSnapshot(item)}`).join(",")}}`;
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error("Snapshot contains an unsupported value.");
  return result;
}

export function readNativeDocumentProfile(
  form: FormData, profile: DocumentProfileDefinition, assignments: DocumentAssignmentInput[],
): DocumentProfileInput {
  const gestor = assignments.find((assignment) => assignment.role === "gestor");
  if (!gestor || !["user", "unit"].includes(gestor.subject_type ?? "user")) throw new Error("Document gestor must be a person or organizational unit.");
  const kinds = form.getAll("profile.author.kind");
  const ids = form.getAll("profile.author.id");
  const evidence = form.getAll("profile.author.evidence");
  if (!kinds.length || kinds.length !== ids.length || kinds.length !== evidence.length) throw new Error("Document authorship is incomplete.");
  const authorship = kinds.map((kind, index): DocumentAuthorInput => {
    if (!["person", "organization", "external_authority"].includes(String(kind))) throw new Error("Document author type is invalid.");
    return { kind: String(kind) as DocumentAuthorInput["kind"], id: requiredReference(ids[index]), evidenceReference: requiredReference(evidence[index]) };
  });
  return {
    profile: { id: profile.id, revision: profile.revision }, authorship,
    provenance: { sourceSystem: "AKB", sourceRecordId: null, sourceGovernedResourceId: null },
    accountability: { ownerSubjectId: requiredReference(form.get("profile.owner")),
      gestor: { kind: gestor.subject_type === "unit" ? "organization_unit" : "person", id: gestor.subject_id } },
  };
}

export function readDocumentVersionProfile(
  form: FormData, profile: DocumentProfileDefinition, rootRevision: string,
): DocumentVersionProfileInput {
  const read = (key: string) => String(form.get(`profile.lifecycle.${key}`) ?? "").trim();
  const mode = read("mode") as DocumentLifecycleInput["mode"];
  if (!profile.lifecycle.modes.includes(mode)) throw new Error("Document validity mode is invalid.");
  const lifecycle: DocumentLifecycleInput = {
    mode, effectiveFrom: mode === "record" ? null : read("effectiveFrom") || null,
    effectiveTo: mode === "fixed_interval" ? read("effectiveTo") || null : null,
    recordedOn: mode === "record" ? read("recordedOn") || null : null,
    reviewAt: read("reviewAt") || null, reviewRuleId: read("reviewRuleId"), retentionRuleId: read("retentionRuleId"),
  };
  if ((mode === "record" && !lifecycle.recordedOn) || (mode !== "record" && !lifecycle.effectiveFrom)
    || (mode === "fixed_interval" && (!lifecycle.effectiveTo || lifecycle.effectiveFrom! > lifecycle.effectiveTo))
    || (profile.lifecycle.reviewAtRequired && !lifecycle.reviewAt)
    || !profile.lifecycle.reviewRuleIds.includes(lifecycle.reviewRuleId)
    || !profile.lifecycle.retentionRuleIds.includes(lifecycle.retentionRuleId)) throw new Error("Document lifecycle evidence is incomplete.");
  const domain: DocumentVersionProfileInput["domain_evidence"] = { family: profile.family };
  for (const field of profile.domainFields) {
    const value = String(form.get(`profile.domain.${field.name}`) ?? "").trim();
    if (!value && field.nullable) { domain[field.name] = null; continue; }
    if (!value) throw new Error(`${field.label.en} is required.`);
    domain[field.name] = field.type === "reference_list" ? value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean) : value;
  }
  return { expected_root_metadata_revision: requiredReference(rootRevision), lifecycle, domain_evidence: domain };
}

function requiredReference(value: unknown): string {
  if (typeof value !== "string" || !/^\S{1,160}$/.test(value)) throw new Error("A verified document reference is required.");
  return value;
}
