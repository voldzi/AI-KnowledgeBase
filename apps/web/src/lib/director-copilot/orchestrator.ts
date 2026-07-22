import "server-only";

import type { ApiRequestContext, Citation, CitationPolicySummary, ResponseLanguage } from "@/lib/types";

import { domainAccessFor } from "./access";
import {
  DIRECTOR_COPILOT_CONTRACT_VERSION,
  DIRECTOR_COPILOT_EVIDENCE_VERSION,
  DIRECTOR_COPILOT_SNAPSHOT_VERSION,
  stableId,
  stableSha256,
  type AnalysisSnapshot,
  type DirectorQueryPlan,
  type DomainApplication,
  type DomainToolRequest,
  type DomainToolResponse,
  type EvidenceItem,
  type InformationClassification,
  type PolicyObligation,
  type StrictestPolicy,
} from "./contracts";
import type { DirectorDomainToolClient } from "./domain-tool-client";
import { buildDirectorQueryPlan, toolCallId } from "./planner";
import { DirectorCopilotTransportError } from "./transport-error";

export interface DirectorCopilotOrchestrationResult {
  plan: DirectorQueryPlan;
  snapshot: AnalysisSnapshot | null;
  status: "complete" | "partial" | "not_authorized" | "no_match";
  warnings: string[];
}

export interface FinalizedDirectorSnapshot {
  snapshot: AnalysisSnapshot;
  acceptedChunkIds: Set<string>;
  warnings: string[];
}

type DomainToolExecutor = Pick<DirectorDomainToolClient, "execute">;

interface SourceOutcome {
  application: DomainApplication;
  response: DomainToolResponse | null;
  status: "complete" | "partial" | "unavailable" | "not_authorized";
  code: string | null;
}

export async function orchestrateDirectorCopilot(input: {
  message: string;
  language: ResponseLanguage;
  context: ApiRequestContext;
  client: DomainToolExecutor;
  now?: Date;
  timeoutMs?: number;
}): Promise<DirectorCopilotOrchestrationResult> {
  const now = input.now ?? new Date();
  const plan = buildDirectorQueryPlan({
    message: input.message,
    language: input.language,
    context: input.context,
    now,
    timeoutMs: input.timeoutMs,
  });
  const outcomes = await Promise.all([
    executeSource("budget", plan, input.context, input.client, now),
    executeSource("projectflow", plan, input.context, input.client, now),
  ]);
  const warnings = outcomes.flatMap((outcome) => [
    ...(outcome.response?.warnings ?? []),
    ...(outcome.code ? [outcome.code] : []),
  ]);
  const availableResponses = outcomes.flatMap((outcome) => outcome.response ? [outcome.response] : []);
  const correlatedIds = correlatedProjectIds(availableResponses);
  const evidence = normalizeStructuredEvidence(availableResponses, correlatedIds, now.toISOString());
  if (!evidence.length) {
    const failed = outcomes.some((outcome) => outcome.status !== "complete");
    return {
      plan,
      snapshot: null,
      status: outcomes.every((outcome) => outcome.status === "not_authorized")
        ? "not_authorized"
        : failed
          ? "partial"
          : "no_match",
      warnings: [...new Set(warnings)],
    };
  }
  const strictestPolicy = deriveStrictestPolicy(evidence);
  const unavailableSources = outcomes.flatMap((outcome) => {
    if (outcome.status === "complete") return [];
    const status = outcome.status === "partial"
      ? "partial" as const
      : outcome.status === "not_authorized"
        ? "not_authorized" as const
        : "unavailable" as const;
    return [{
      source: outcome.application === "budget" ? "STRATOS_BUDGET" as const : "STRATOS_PROJECTFLOW" as const,
      status,
      code: outcome.code ?? (outcome.status === "partial" ? "SOURCE_PARTIAL" : "SOURCE_UNAVAILABLE"),
    }];
  });
  const documentContextBindings = [...new Map(
    [...correlatedIds].sort().map((canonicalId) => [canonicalId, {
      canonical_id: canonicalId,
      tags: boundedDocumentContextTags([...new Set(
        availableResponses.flatMap((response) => response.items)
          .filter((item) => item.canonical_id === canonicalId)
          .flatMap((item) => item.document_context_tags),
      )]),
    }]),
  ).values()];
  const tags = [...new Set(documentContextBindings.flatMap((binding) => binding.tags))].sort();
  const snapshotBase = {
    schema_version: DIRECTOR_COPILOT_SNAPSHOT_VERSION,
    created_at: now.toISOString(),
    correlation_id: input.context.correlationId ?? input.context.requestId ?? plan.plan_id,
    plan,
    projection_hash: plan.projection_hash,
    evidence,
    unavailable_sources: unavailableSources,
    strictest_policy: strictestPolicy,
    document_context_tags: tags,
    document_context_bindings: documentContextBindings,
  };
  const snapshotHash = stableSha256(snapshotBase);
  const snapshot: AnalysisSnapshot = {
    ...snapshotBase,
    snapshot_id: stableId("snap", snapshotHash),
    snapshot_hash: snapshotHash,
  };
  return {
    plan,
    snapshot,
    status: unavailableSources.length ? "partial" : "complete",
    warnings: [...new Set(warnings)],
  };
}

export function directorCopilotPromptEvidence(snapshot: AnalysisSnapshot): Record<string, unknown> {
  return {
    schema_version: snapshot.schema_version,
    snapshot_id: snapshot.snapshot_id,
    as_of: snapshot.created_at,
    evidence: snapshot.evidence.slice(0, 120).map((item) => ({
      evidence_id: item.evidence_id,
      source_system: item.source_system,
      canonical_id: item.canonical_id,
      entity_type: item.entity_type,
      entity_id: item.entity_id,
      fact: item.fact,
      as_of: item.as_of,
      deep_link: item.deep_link,
    })),
    unavailable_sources: snapshot.unavailable_sources,
  };
}

export function finalizeDirectorSnapshot(
  snapshot: AnalysisSnapshot,
  citations: Citation[],
  retrievedAt = new Date().toISOString(),
): FinalizedDirectorSnapshot {
  const documentEvidence: EvidenceItem[] = [];
  const acceptedChunkIds = new Set<string>();
  const warnings: string[] = [];
  for (const citation of citations) {
    const policy = citationPolicy(citation);
    if (!policy) {
      warnings.push("DIRECTOR_COPILOT_DOCUMENT_POLICY_MISSING");
      continue;
    }
    const citationTags = new Set(citation.document_context_tags ?? []);
    const citationProjects = snapshot.document_context_bindings
      .filter((binding) => binding.tags.some((tag) => citationTags.has(tag)))
      .map((binding) => binding.canonical_id);
    if (!citationProjects.length) {
      warnings.push("DIRECTOR_COPILOT_DOCUMENT_SCOPE_MISMATCH");
      continue;
    }
    for (const canonicalId of citationProjects) {
      if (documentEvidence.length >= 200) {
        warnings.push("DIRECTOR_COPILOT_DOCUMENT_EVIDENCE_TRUNCATED");
        break;
      }
      const identity = {
        source_system: "STRATOS_AKB" as const,
        canonical_id: canonicalId,
        document_id: citation.document_id,
        document_version_id: citation.document_version_id,
        chunk_id: citation.chunk_id,
        policy_hash: policy.hash,
      };
      documentEvidence.push({
        schema_version: DIRECTOR_COPILOT_EVIDENCE_VERSION,
        evidence_id: stableId("evi", identity),
        type: "document_finding",
        source_system: "STRATOS_AKB",
        entity_type: "project",
        entity_id: canonicalId.slice("stratos:project:".length),
        canonical_id: canonicalId,
        source_version: citation.document_version_id,
        as_of: snapshot.created_at,
        retrieved_at: retrievedAt,
        authorized_scope: { type: "document", id: citation.document_id },
        deep_link: `/documents/${encodeURIComponent(citation.document_id)}`,
        policy,
        source_hash: stableSha256(identity),
        quality: 1,
        document_citation: {
          document_id: citation.document_id,
          document_version_id: citation.document_version_id,
          chunk_id: citation.chunk_id,
          page_number: citation.page_number,
          section_path: citation.section_path,
        },
      });
      acceptedChunkIds.add(citation.chunk_id);
    }
  }
  const evidence = [
    ...snapshot.evidence,
    ...documentEvidence.filter((item, index, items) => (
      items.findIndex((candidate) => candidate.evidence_id === item.evidence_id) === index
    )),
  ];
  const { snapshot_id: _snapshotId, snapshot_hash: _snapshotHash, ...previousBase } = snapshot;
  const snapshotBase = {
    ...previousBase,
    evidence,
    strictest_policy: deriveStrictestPolicy(evidence),
  };
  const snapshotHash = stableSha256(snapshotBase);
  return {
    snapshot: {
      ...snapshotBase,
      snapshot_id: stableId("snap", snapshotHash),
      snapshot_hash: snapshotHash,
    },
    acceptedChunkIds,
    warnings: [...new Set(warnings)],
  };
}

async function executeSource(
  application: DomainApplication,
  plan: DirectorQueryPlan,
  context: ApiRequestContext,
  client: DomainToolExecutor,
  now: Date,
): Promise<SourceOutcome> {
  const access = domainAccessFor(context, application, now.getTime());
  if (!access.authorized) {
    return {
      application,
      response: null,
      status: "not_authorized",
      code: `ACCESS_${access.reason.toUpperCase()}`,
    };
  }
  const node = plan.nodes.find((candidate) => candidate.source_application === application);
  if (!node || node.tool_id === "akb.contract_risk_retrieval.v1") {
    return { application, response: null, status: "unavailable", code: "QUERY_PLAN_NODE_MISSING" };
  }
  const request: DomainToolRequest = {
    schema_version: DIRECTOR_COPILOT_CONTRACT_VERSION,
    tool_id: node.tool_id,
    tool_call_id: toolCallId(plan.plan_id, node.node_id),
    plan_id: plan.plan_id,
    organization_id: "org_stratos",
    actor: { type: "person", subject_id: context.subjectId },
    requested_at: now.toISOString(),
    requested_scopes: node.requested_scopes,
    parameters: { as_of: plan.as_of, limit: 25 },
  };
  try {
    const response = await client.execute(application, request, context);
    return {
      application,
      response,
      status: response.status,
      code: response.next_cursor
        ? "SOURCE_RESULT_TRUNCATED"
        : response.status === "partial"
          ? "SOURCE_PARTIAL"
          : null,
    };
  } catch (error) {
    if (error instanceof DirectorCopilotTransportError) {
      return { application, response: null, status: error.outcome, code: error.code };
    }
    return { application, response: null, status: "unavailable", code: "SOURCE_CONTRACT_INVALID" };
  }
}

function correlatedProjectIds(responses: DomainToolResponse[]): Set<string> {
  const budget = new Set(
    responses
      .filter((response) => response.source_system === "STRATOS_BUDGET")
      .flatMap((response) => response.items)
      .filter((item) => item.facts.some(isBudgetVariance))
      .map((item) => item.canonical_id),
  );
  const delivery = new Set(
    responses
      .filter((response) => response.source_system === "STRATOS_PROJECTFLOW")
      .flatMap((response) => response.items)
      .filter((item) => item.facts.some(isDelayedMilestone))
      .map((item) => item.canonical_id),
  );
  return new Set([...budget].filter((canonicalId) => delivery.has(canonicalId)));
}

function isBudgetVariance(fact: { key: string; value: unknown }): boolean {
  if (!fact.key.includes("variance")) return false;
  return typeof fact.value === "number" ? Math.abs(fact.value) > 0 : Boolean(fact.value);
}

function isDelayedMilestone(fact: { key: string; value: unknown }): boolean {
  if (!fact.key.includes("delay")) return false;
  return typeof fact.value === "number" ? fact.value > 0 : Boolean(fact.value);
}

function normalizeStructuredEvidence(
  responses: DomainToolResponse[],
  correlatedIds: Set<string>,
  retrievedAt: string,
): EvidenceItem[] {
  return responses.flatMap((response) => response.items)
    .filter((item) => correlatedIds.has(item.canonical_id))
    .flatMap((item) => item.facts.map((fact): EvidenceItem => {
      const sourceSystem = responses.find((response) => response.items.includes(item))?.source_system
        ?? "STRATOS_AKB";
      const identity = {
        source_system: sourceSystem,
        canonical_id: item.canonical_id,
        source_version: item.source_version,
        as_of: item.as_of,
        fact,
      };
      return {
        schema_version: DIRECTOR_COPILOT_EVIDENCE_VERSION,
        evidence_id: stableId("evi", identity),
        type: "structured_fact",
        source_system: sourceSystem,
        entity_type: item.entity_type,
        entity_id: item.entity_id,
        canonical_id: item.canonical_id,
        source_version: item.source_version,
        as_of: item.as_of,
        retrieved_at: retrievedAt,
        authorized_scope: item.authorized_scope,
        deep_link: item.deep_link,
        policy: item.policy,
        source_hash: stableSha256(identity),
        quality: fact.quality ?? 1,
        fact,
      };
    }))
    .slice(0, 200);
}

function boundedDocumentContextTags(tags: string[]): string[] {
  return [...tags].sort((left, right) => contextTagRank(left) - contextTagRank(right) || left.localeCompare(right)).slice(0, 4);
}

function contextTagRank(value: string): number {
  if (value.startsWith("project:")) return 0;
  if (value.startsWith("contract:") || value.startsWith("budget-contract:")) return 1;
  if (value.startsWith("projectflow-project:")) return 2;
  return 3;
}

function citationPolicy(citation: Citation): EvidenceItem["policy"] | null {
  const summary = citation.policy_summary;
  if (
    !summary
    || !citation.policy_binding_id
    || citation.policy_version !== "information-policy-2.0.0"
    || !citation.policy_hash
    || !citation.policy_summary_hash
    || summary.policyBindingId !== citation.policy_binding_id
    || summary.policyVersion !== citation.policy_version
    || stableSha256(summary) !== citation.policy_summary_hash
  ) {
    return null;
  }
  const obligations = summary.obligations.filter((value): value is PolicyObligation => (
    POLICY_OBLIGATIONS.has(value as PolicyObligation)
  ));
  if (obligations.length !== summary.obligations.length) return null;
  return {
    binding_id: citation.policy_binding_id,
    version: "information-policy-2.0.0",
    hash: citation.policy_hash,
    classification: {
      handling_class: summary.handlingClass,
      legal_classification: "NONE",
      tlp: summary.tlp,
      pap: summary.pap,
    },
    audience: policyAudience(summary),
    obligations,
  };
}

function policyAudience(summary: CitationPolicySummary): string[] {
  const audience = summary.audience;
  return [...new Set([
    `organization:${audience.organizationId}`,
    ...(audience.scopeIds.length
      ? audience.scopeIds.map((id) => `${audience.scopeType}:${id}`)
      : [`${audience.scopeType}:*`]),
    ...audience.recipientSubjectIds.map((id) => `recipient:${id}`),
  ])].sort();
}

function deriveStrictestPolicy(evidence: EvidenceItem[]): StrictestPolicy {
  const policies = evidence.map((item) => ({ sourceSystem: item.source_system, policy: item.policy }));
  const audience = new Set(policies.flatMap(({ policy }) => policy.audience));
  const strictestClassification = policies
    .map(({ policy }) => policy.classification)
    .sort((left, right) => classificationRank(right.handling_class) - classificationRank(left.handling_class))[0];
  return {
    classification: {
      ...strictestClassification,
      tlp: strictestValue(policies.map(({ policy }) => policy.classification.tlp), TLP_ORDER),
      pap: strictestValue(policies.map(({ policy }) => policy.classification.pap), PAP_ORDER),
    },
    audience_mode: "all_source_policies_required",
    audience: [...audience].sort(),
    obligations: [...new Set(policies.flatMap(({ policy }) => policy.obligations))].sort() as PolicyObligation[],
    source_policies: [...new Map(policies.map(({ sourceSystem, policy }) => [
      `${sourceSystem}|${policy.binding_id}|${policy.hash}`,
      {
        source_system: sourceSystem,
        binding_id: policy.binding_id,
        version: policy.version,
        hash: policy.hash,
      },
    ])).values()],
  };
}

const TLP_ORDER = [null, "TLP:CLEAR", "TLP:GREEN", "TLP:AMBER", "TLP:AMBER+STRICT", "TLP:RED"] as const;
const PAP_ORDER = [null, "PAP:CLEAR", "PAP:GREEN", "PAP:AMBER", "PAP:RED"] as const;
const POLICY_OBLIGATIONS = new Set<PolicyObligation>([
  "AUDIT_ACCESS",
  "NO_EXTERNAL_AI",
  "LOCAL_PROCESSING_ONLY",
  "NO_PUBLIC_EXPORT",
  "NO_EXPORT",
  "WATERMARK",
  "ENCRYPT_AT_REST",
  "RECIPIENT_CONFIRMATION",
  "ORIGINATOR_APPROVAL",
  "PAP_ENFORCEMENT",
]);

function classificationRank(value: InformationClassification["handling_class"]): number {
  return ["PUBLIC", "INTERNAL", "PROJECT_MANAGEMENT", "RESTRICTED"].indexOf(value);
}

function strictestValue<T extends string>(values: Array<T | null>, order: readonly (T | null)[]): T | null {
  return [...values].sort((left, right) => order.indexOf(right) - order.indexOf(left))[0] ?? null;
}
