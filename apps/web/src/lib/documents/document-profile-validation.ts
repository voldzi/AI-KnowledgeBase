import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import inputsSchema from "./document-profile-inputs.schema.json";
import { DOCUMENT_PROFILES, type DocumentProfileDefinition, type DocumentProfileInput,
  type DocumentVersionProfileInput } from "./document-profile";
import { ApiClientError } from "@/lib/types";

const ajv = new Ajv2020({ strict: false, allErrors: false, coerceTypes: false, removeAdditional: false });
addFormats(ajv);
ajv.addSchema(inputsSchema);
const rootShape = ajv.compile({ $ref: `${inputsSchema.$id}#/$defs/DocumentProfileInput` });
const versionShape = ajv.compile({ $ref: `${inputsSchema.$id}#/$defs/DocumentVersionProfileInput` });
const versionDefinition = inputsSchema.$defs.DocumentVersionProfileInput;
const draftShape = ajv.compile({ ...versionDefinition, $defs: inputsSchema.$defs,
  required: versionDefinition.required.filter((key) => key !== "expected_root_metadata_revision"),
  properties: Object.fromEntries(Object.entries(versionDefinition.properties).filter(([key]) => key !== "expected_root_metadata_revision")),
});

export type DocumentVersionProfileDraft = Omit<DocumentVersionProfileInput, "expected_root_metadata_revision">;

function invalid(message: string): never {
  throw new ApiClientError(message, 422, "DOCUMENT_PROFILE_INVALID", "web-document-profile");
}
function required(value: unknown): void {
  if (value === null || value === undefined) {
    throw new ApiClientError("document_profile is required.", 422, "DOCUMENT_PROFILE_REQUIRED", "web-document-profile");
  }
}
function definition(root: DocumentProfileInput): DocumentProfileDefinition {
  const profile = DOCUMENT_PROFILES.find((candidate) => candidate.id === root.profile.id && candidate.revision === root.profile.revision);
  if (!profile) invalid("Unknown document profile or catalog revision.");
  return profile;
}

/** Structural/catalog validation only; current source authority belongs to Registry. */
export function parseDocumentProfileInput(value: unknown, options: { documentType?: string; sourceSystem?: string } = {}): DocumentProfileInput {
  required(value);
  if (!rootShape(value)) invalid("document_profile must contain the complete closed root profile shape.");
  const root = value as DocumentProfileInput;
  const profile = definition(root);
  if (!profile.sourceSystems.includes(root.provenance.sourceSystem)
      || (options.sourceSystem && root.provenance.sourceSystem !== options.sourceSystem)
      || (options.documentType && !profile.documentTypes.includes(options.documentType))) {
    invalid("Document profile does not match its document type or source system.");
  }
  if (new Set(root.authorship.map((author) => `${author.kind}:${author.id}`)).size !== root.authorship.length) invalid("Document authorship references must be unique.");
  if (root.provenance.sourceSystem === "AKB") {
    if (root.provenance.sourceRecordId !== null || root.provenance.sourceGovernedResourceId !== null) invalid("Native root provenance is allocated by Registry.");
  } else if (!root.provenance.sourceRecordId || !root.provenance.sourceGovernedResourceId) {
    invalid("Imported document provenance requires its exact source record and governed resource.");
  }
  if (profile.family === "official_public_reference" && !root.authorship.some((author) => ["organization", "external_authority"].includes(author.kind))) {
    invalid("Official references require an identified issuing authority.");
  }
  return structuredClone(root);
}

export function parseDocumentVersionProfileInput(value: unknown, rootProfile?: DocumentProfileInput): DocumentVersionProfileInput {
  required(value);
  if (!versionShape(value)) invalid("document_profile must contain the complete closed version profile shape.");
  const version = value as DocumentVersionProfileInput;
  validateVersion(version, rootProfile);
  return structuredClone(version);
}

export function parseDocumentVersionProfileDraft(value: unknown, rootProfile: DocumentProfileInput): DocumentVersionProfileDraft {
  required(value);
  if (!draftShape(value)) invalid("document_version_profile must contain lifecycle and domain_evidence only; Registry allocates the root revision.");
  const version = value as DocumentVersionProfileDraft;
  validateVersion(version, rootProfile);
  return structuredClone(version);
}

function validateVersion(version: DocumentVersionProfileDraft, root?: DocumentProfileInput): void {
  const profile = root ? definition(root) : DOCUMENT_PROFILES.find((candidate) => candidate.family === version.domain_evidence.family);
  if (!profile) invalid("Version profile requires an explicit known domain family.");
  const { lifecycle, domain_evidence: evidence } = version;
  if (!profile.lifecycle.modes.includes(lifecycle.mode)
      || (profile.lifecycle.reviewAtRequired && !lifecycle.reviewAt)
      || !profile.lifecycle.reviewRuleIds.includes(lifecycle.reviewRuleId)
      || !profile.lifecycle.retentionRuleIds.includes(lifecycle.retentionRuleId)) invalid("Document lifecycle does not match the selected profile rules.");
  if (lifecycle.mode === "fixed_interval" && (!lifecycle.effectiveFrom || !lifecycle.effectiveTo || lifecycle.effectiveFrom > lifecycle.effectiveTo)) invalid("Fixed interval requires ordered explicit effectivity dates.");
  if (lifecycle.mode === "until_superseded" && (!lifecycle.effectiveFrom || lifecycle.effectiveTo !== null)) invalid("Until superseded requires a start and an explicitly open end.");
  if (lifecycle.mode === "record" && (!lifecycle.recordedOn || lifecycle.effectiveFrom !== null || lifecycle.effectiveTo !== null)) invalid("Record lifecycle requires its event date and no normative effectivity.");
  const keys = ["family", ...profile.domainFields.map((field) => field.name)].sort();
  if (evidence.family !== profile.family || JSON.stringify(Object.keys(evidence).sort()) !== JSON.stringify(keys)) invalid("Domain evidence must contain exactly the selected profile fields.");
  for (const field of profile.domainFields) {
    const value = evidence[field.name];
    if (value === null && field.nullable) continue;
    if (field.type === "reference_list") {
      if (!Array.isArray(value) || value.length === 0 || new Set(value).size !== value.length
          || value.some((item) => typeof item !== "string" || !item || item.trim() !== item)) invalid(`Invalid domain evidence: ${field.name}.`);
      continue;
    }
    if (typeof value !== "string" || !value || value.trim() !== value) invalid(`Missing domain evidence: ${field.name}.`);
    if (field.type === "enum" && !field.options?.some((option) => option.value === value)) invalid(`Invalid domain option: ${field.name}.`);
    if (field.type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) invalid(`Invalid domain date: ${field.name}.`);
    if (field.type === "https_url") {
      try { const url = new URL(value); if (url.protocol !== "https:" || !url.hostname || url.username || url.password) invalid(`Invalid source URL: ${field.name}.`); }
      catch { invalid(`Invalid source URL: ${field.name}.`); }
    }
  }
  if (profile.family === "contract") {
    if (root?.provenance.sourceSystem === "STRATOS_BUDGET" && evidence.contractReference !== root.provenance.sourceRecordId) invalid("Contract evidence must identify the exact Budget source record.");
    if (["draft", "terminated"].includes(String(evidence.executionStatus)) !== (lifecycle.mode === "record")) invalid("Draft and terminated contracts are event records; signed or effective contracts require normative effectivity.");
    if (evidence.executionStatus !== "draft" && evidence.executionEvidenceReference === null) invalid("Executed contracts require execution evidence.");
  }
  if (profile.family === "official_public_reference" && evidence.sourceKind === "regulation"
      && (lifecycle.mode === "record" || evidence.effectiveDateEvidenceReference === null)) invalid("Regulations require verified normative effectivity.");
}
