import "server-only";

import { getDirectorCopilotConfig, type AklConfig } from "@/lib/api/config";
import type {
  ApiRequestContext,
  AssistantChatResponse,
  AssistantConversationMessage,
  ResponseLanguage,
} from "@/lib/types";

import { domainAccessFor } from "./access";
import {
  stableSha256,
  type AnalysisSnapshot,
  type DirectorCopilotIntent,
  type DomainApplication,
  type EvidenceItem,
} from "./contracts";
import { DirectorDomainToolClient } from "./domain-tool-client";
import { orchestrateDirectorCopilot } from "./orchestrator";
import {
  conversationQueryState,
  type ConversationQueryState,
} from "./query-state";

const HISTORY_SCHEMA_VERSION = "director-copilot-history-1";
const MAX_SOURCE_REFERENCES = 200;

interface DirectorHistorySourceReference {
  source_system:
    | "STRATOS_BUDGET"
    | "STRATOS_PROJECTFLOW"
    | "STRATOS_ARCHFLOW"
    | "STRATOS_AIIP";
  canonical_id: string;
  source_version: string;
  policy_hash: string;
}

interface DirectorHistoryEnvelope {
  schema_version: typeof HISTORY_SCHEMA_VERSION;
  intent: DirectorCopilotIntent;
  language: ResponseLanguage;
  generated_at: string;
  access_hash: string;
  source_applications: DomainApplication[];
  source_references: DirectorHistorySourceReference[];
  query_state?: ConversationQueryState;
}

export type DirectorHistoryAuthorization =
  | { status: "allowed" }
  | { status: "access_changed" }
  | { status: "source_unavailable" };

export function directorCopilotPersistenceMetadata(
  response: AssistantChatResponse,
  actorContext: ApiRequestContext,
): Record<string, unknown> {
  const snapshot = analysisSnapshot(response.current_context.director_copilot_snapshot);
  const planIntent = snapshot?.plan.intent
    ?? directorIntent(response.current_context.requested_director_copilot_intent);
  const sourceApplications = snapshot
    ? sourceApplicationsForSnapshot(snapshot)
    : sourceApplicationsForAnswerSource(response.current_context.answer_source);
  const envelope = snapshot && planIntent
    ? {
        schema_version: HISTORY_SCHEMA_VERSION,
        intent: planIntent,
        language: snapshot.plan.language,
        generated_at: snapshot.created_at,
        access_hash: historyAccessHash(actorContext, sourceApplications),
        source_applications: sourceApplications,
        source_references: historySourceReferences(snapshot),
        query_state: snapshot.plan.query_state,
      } satisfies DirectorHistoryEnvelope
    : null;

  return {
    confidence: response.confidence,
    current_context: {
      answer_source: stringValue(response.current_context.answer_source),
      active_source_application: stringValue(
        response.current_context.active_source_application,
      ),
      requested_director_copilot_intent: planIntent,
      stratos_query_state:
        snapshot?.plan.query_state
        ?? conversationQueryState(response.current_context.stratos_query_state),
    },
    director_copilot_history: envelope,
    follow_up_questions: response.follow_up_questions,
    suggested_actions: response.suggested_actions,
    report_artifacts: response.report_artifacts,
    warnings: response.warnings.filter(
      (warning) => warning !== "CONVERSATION_HISTORY_DISABLED_FOR_GOVERNED_FEDERATION",
    ),
    missing_information: response.missing_information,
    recommended_action: response.recommended_action,
  };
}

export function persistedDirectorCopilotResponse(
  response: AssistantChatResponse,
): AssistantChatResponse {
  const currentContext = {
    answer_source: stringValue(response.current_context.answer_source),
    active_source_application: stringValue(
      response.current_context.active_source_application,
    ),
    requested_director_copilot_intent:
      directorIntent(response.current_context.requested_director_copilot_intent)
      ?? analysisSnapshot(response.current_context.director_copilot_snapshot)?.plan.intent
      ?? null,
    stratos_query_state:
      analysisSnapshot(response.current_context.director_copilot_snapshot)?.plan.query_state
      ?? conversationQueryState(response.current_context.stratos_query_state),
  };
  return {
    ...response,
    current_context: currentContext,
    warnings: response.warnings.filter(
      (warning) => warning !== "CONVERSATION_HISTORY_DISABLED_FOR_GOVERNED_FEDERATION",
    ),
  };
}

export async function authorizeDirectorCopilotHistory(input: {
  message: AssistantConversationMessage;
  previousUserMessage: string;
  actorContext: ApiRequestContext;
  config: AklConfig;
}): Promise<DirectorHistoryAuthorization> {
  const rawEnvelope = input.message.metadata.director_copilot_history;
  const envelope = historyEnvelope(rawEnvelope);
  if (!envelope) {
    return rawEnvelope === undefined
      ? { status: "allowed" }
      : { status: "access_changed" };
  }
  if (!input.previousUserMessage.trim()) {
    return { status: "access_changed" };
  }
  if (
    historyAccessHash(input.actorContext, envelope.source_applications)
    !== envelope.access_hash
  ) {
    return { status: "access_changed" };
  }
  if (
    envelope.source_applications.some(
      (application) => !domainAccessFor(input.actorContext, application).authorized,
    )
  ) {
    return { status: "access_changed" };
  }

  try {
    const orchestration = await orchestrateDirectorCopilot({
      message: input.previousUserMessage,
      language: envelope.language,
      context: input.actorContext,
      client: new DirectorDomainToolClient({ config: input.config }),
      intent: envelope.intent,
      queryState: envelope.query_state,
      timeoutMs: getDirectorCopilotConfig(input.config).timeoutMs,
    });
    if (!orchestration.snapshot) {
      return orchestration.status === "not_authorized"
        ? { status: "access_changed" }
        : { status: "source_unavailable" };
    }
    const currentReferences = new Set(
      historySourceReferences(orchestration.snapshot).map(sourceAuthorizationKey),
    );
    if (
      envelope.source_references.some(
        (reference) => !currentReferences.has(sourceAuthorizationKey(reference)),
      )
    ) {
      return { status: "access_changed" };
    }
    return { status: "allowed" };
  } catch {
    return { status: "source_unavailable" };
  }
}

function historyAccessHash(
  context: ApiRequestContext,
  applications: DomainApplication[],
): string {
  return stableSha256(
    [...applications]
      .sort()
      .map((application) => {
        const access = domainAccessFor(context, application);
        return {
          application,
          authorized: access.authorized,
          required_capabilities: access.requiredCapabilities,
          scopes: access.scopes
            .map((scope) => `${scope.type}:${scope.id ?? ""}`)
            .sort(),
        };
      }),
  );
}

function historySourceReferences(
  snapshot: AnalysisSnapshot,
): DirectorHistorySourceReference[] {
  const references = snapshot.evidence
    .filter(
      (
        evidence,
      ): evidence is EvidenceItem & {
        source_system: DirectorHistorySourceReference["source_system"];
      } => (
        evidence.type === "structured_fact"
        && (
          evidence.source_system === "STRATOS_BUDGET"
          || evidence.source_system === "STRATOS_PROJECTFLOW"
          || evidence.source_system === "STRATOS_ARCHFLOW"
          || evidence.source_system === "STRATOS_AIIP"
        )
      ),
    )
    .map((evidence) => ({
      source_system: evidence.source_system,
      canonical_id: evidence.canonical_id,
      source_version: evidence.source_version,
      policy_hash: evidence.policy.hash,
    }));
  return [...new Map(
    references.map((reference) => [sourceReferenceKey(reference), reference]),
  ).values()]
    .sort((left, right) => sourceReferenceKey(left).localeCompare(sourceReferenceKey(right)))
    .slice(0, MAX_SOURCE_REFERENCES);
}

function sourceReferenceKey(reference: DirectorHistorySourceReference): string {
  return [
    reference.source_system,
    reference.canonical_id,
    reference.source_version,
    reference.policy_hash,
  ].join("|");
}

function sourceAuthorizationKey(reference: DirectorHistorySourceReference): string {
  // source_version is live-data provenance, not an authorization attribute.
  return [
    reference.source_system,
    reference.canonical_id,
    reference.policy_hash,
  ].join("|");
}

function sourceApplicationsForSnapshot(
  snapshot: AnalysisSnapshot,
): DomainApplication[] {
  return [...new Set(
    snapshot.plan.nodes.flatMap((node) => (
      node.source_application === "budget"
      || node.source_application === "projectflow"
      || node.source_application === "archflow"
      || node.source_application === "aiip"
        ? [node.source_application]
        : []
    )),
  )].sort();
}

function sourceApplicationsForAnswerSource(value: unknown): DomainApplication[] {
  if (value === "director_copilot_budget") {
    return ["budget"];
  }
  if (value === "director_copilot_projectflow") {
    return ["projectflow"];
  }
  if (value === "director_copilot_archflow") {
    return ["archflow"];
  }
  if (value === "director_copilot_aiip") {
    return ["aiip"];
  }
  if (value === "director_copilot_federation") {
    return ["budget", "projectflow"];
  }
  return [];
}

function analysisSnapshot(value: unknown): AnalysisSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<AnalysisSnapshot>;
  return candidate.schema_version === "director-copilot-analysis-snapshot-1"
    && (
      candidate.plan?.schema_version === "director-copilot-query-plan-4"
      || (candidate.plan?.schema_version as string | undefined) === "director-copilot-query-plan-3"
      || (candidate.plan?.schema_version as string | undefined) === "director-copilot-query-plan-2"
    )
    && Array.isArray(candidate.evidence)
    ? candidate as AnalysisSnapshot
    : null;
}

function historyEnvelope(value: unknown): DirectorHistoryEnvelope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<DirectorHistoryEnvelope>;
  const intent = directorIntent(candidate.intent);
  const applications = Array.isArray(candidate.source_applications)
    ? candidate.source_applications.filter(
        (application): application is DomainApplication => (
          application === "budget"
          || application === "projectflow"
          || application === "archflow"
          || application === "aiip"
        ),
      )
    : [];
  const references = Array.isArray(candidate.source_references)
    ? candidate.source_references.filter(isHistorySourceReference)
    : [];
  const queryState = conversationQueryState(candidate.query_state);
  if (
    candidate.schema_version !== HISTORY_SCHEMA_VERSION
    || !intent
    || (candidate.language !== "cs" && candidate.language !== "en")
    || typeof candidate.generated_at !== "string"
    || typeof candidate.access_hash !== "string"
    || applications.length === 0
    || references.length === 0
    || references.length > MAX_SOURCE_REFERENCES
  ) {
    return null;
  }
  return {
    schema_version: HISTORY_SCHEMA_VERSION,
    intent,
    language: candidate.language,
    generated_at: candidate.generated_at,
    access_hash: candidate.access_hash,
    source_applications: [...new Set(applications)].sort(),
    source_references: references,
    ...(queryState ? { query_state: queryState } : {}),
  };
}

function isHistorySourceReference(
  value: unknown,
): value is DirectorHistorySourceReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<DirectorHistorySourceReference>;
  return (
    (
      candidate.source_system === "STRATOS_BUDGET"
      || candidate.source_system === "STRATOS_PROJECTFLOW"
      || candidate.source_system === "STRATOS_ARCHFLOW"
      || candidate.source_system === "STRATOS_AIIP"
    )
    && typeof candidate.canonical_id === "string"
    && typeof candidate.source_version === "string"
    && typeof candidate.policy_hash === "string"
  );
}

function directorIntent(value: unknown): DirectorCopilotIntent | null {
  return value === "portfolio_risk_correlation"
    || value === "portfolio_performance_overview"
    || value === "project_portfolio_status"
    || value === "budget_portfolio_status"
    || value === "project_access_overview"
    || value === "archflow_demand_overview"
    || value === "aiip_idea_overview"
    || value === "innovation_delivery_trace"
    ? value
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
