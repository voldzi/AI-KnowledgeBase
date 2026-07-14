import type { InformationPolicyDetails } from "@voldzi/stratos-ui";

import type {
  Document,
  DocumentPublication,
  DocumentVersion,
  InformationPolicyBindingSummary,
} from "@/lib/types";

type PolicyResource = Pick<
  Document | DocumentVersion,
  "policy_binding_id" | "policy_version" | "policy_hash" | "policy_summary"
>;

export function documentInformationPolicyDetails(
  document: Document,
): InformationPolicyDetails | null {
  return policyDetails(document, `Dokument ${document.document_id}`);
}

export function versionInformationPolicyDetails(
  version: DocumentVersion | null | undefined,
  publication?: DocumentPublication | null,
): InformationPolicyDetails | null {
  if (!version) {
    return null;
  }
  const details = policyDetails(version, `Verze ${version.version_label}`);
  if (!details) {
    return null;
  }
  return {
    ...details,
    publication: publicationDetails(version, publication),
  };
}

function policyDetails(
  resource: PolicyResource,
  sourceLabel: string,
): InformationPolicyDetails | null {
  const summary = resource.policy_summary;
  if (
    !isInformationPolicySummary(summary) ||
    resource.policy_binding_id !== summary.policyBindingId ||
    resource.policy_version !== summary.policyVersion ||
    !isPolicyHash(resource.policy_hash)
  ) {
    return null;
  }

  return {
    schemaVersion: summary.schemaVersion,
    policyBindingId: summary.policyBindingId,
    policyVersion: summary.policyVersion,
    policyHash: resource.policy_hash,
    // stratos-ui 0.3.33 predates the centrally defined PROJECT_MANAGEMENT class;
    // retain the authoritative value until the shared type package catches up.
    handlingClass: summary.handlingClass as InformationPolicyDetails["handlingClass"],
    legalClassification: summary.legalClassification,
    tlp: summary.tlp ?? null,
    pap: summary.pap ?? null,
    contentCategories: summary.contentCategories,
    audience: summary.audience,
    obligations: summary.obligations,
    inherited: false,
    sourceLabel,
    issuedAt: summary.issuedAt ?? null,
    reviewAt: summary.reviewAt ?? null,
  };
}

function publicationDetails(
  version: DocumentVersion,
  publication: DocumentPublication | null | undefined,
): InformationPolicyDetails["publication"] {
  if (publication === undefined) {
    return null;
  }
  if (publication === null) {
    return { status: "NOT_PUBLISHED" };
  }
  if (
    publication.document_id !== version.document_id ||
    publication.document_version_id !== version.document_version_id ||
    publication.policy_binding_id !== version.policy_binding_id ||
    publication.policy_version !== version.policy_version ||
    publication.policy_hash !== version.policy_hash ||
    publication.source_version !== version.document_version_id
  ) {
    return null;
  }
  return {
    status: publication.status,
    publicSlug: publication.public_slug,
    publishedAt: publication.published_at,
    revokedAt: publication.revoked_at,
  };
}

function isInformationPolicySummary(
  value: unknown,
): value is InformationPolicyBindingSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const policy = value as Partial<InformationPolicyBindingSummary>;
  return (
    policy.schemaVersion === "stratos-information-policy-2" &&
    policy.policyVersion === "information-policy-2.0.0" &&
    typeof policy.policyBindingId === "string" &&
    /^(?:pol|pb)_[A-Za-z0-9_-]{8,}$/.test(policy.policyBindingId) &&
    ["PUBLIC", "INTERNAL", "PROJECT_MANAGEMENT", "RESTRICTED"].includes(policy.handlingClass ?? "") &&
    policy.legalClassification === "NONE" &&
    Array.isArray(policy.contentCategories) &&
    Array.isArray(policy.obligations) &&
    Boolean(policy.audience) &&
    policy.audience?.organizationId === "org_stratos" &&
    ["organization", "organization_unit", "project", "document", "recipient_set", "public"].includes(
      policy.audience?.scopeType ?? "",
    )
  );
}

function isPolicyHash(value: string | null | undefined): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}
