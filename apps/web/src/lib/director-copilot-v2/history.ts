import "server-only";

import type { AklConfig } from "@/lib/api/config";
import {
  conversationQueryState,
  type ConversationQueryState,
} from "@/lib/director-copilot/query-state";
import { assistantLiveSourcesFromOutcomes } from "@/lib/assistant/live-source-presentation";
import type {
  ApiClients,
  ApiRequestContext,
  AssistantChatResponse,
  AssistantConversationMessage,
  ResponseLanguage,
} from "@/lib/types";

import { DirectorCopilotV2DomainToolClient } from "./domain-tool-client";
import { loadDirectorCopilotV2ManifestCatalog } from "./manifest-catalog";
import {
  orchestrateDirectorCopilotV2,
  type DirectorCopilotV2Snapshot,
} from "./orchestrator";
import { stableSha256, type DirectorCopilotIntent } from "./shared";

const HISTORY_SCHEMA_VERSION = "director-copilot-history-1";
const MAX_SOURCE_REFERENCES = 200;

type SourceApplication = "budget" | "projectflow" | "archflow";
type SourceSystem = "STRATOS_BUDGET" | "STRATOS_PROJECTFLOW" | "STRATOS_ARCHFLOW";

interface SourceReference {
  source_system: SourceSystem;
  canonical_id: string;
  source_version: string;
  policy_hash: string | null;
}

interface V2HistoryEnvelope {
  schema_version: typeof HISTORY_SCHEMA_VERSION;
  contract_version: "director-copilot-2";
  intent: DirectorCopilotIntent;
  language: ResponseLanguage;
  generated_at: string;
  access_hash: string;
  source_applications: SourceApplication[];
  source_references: SourceReference[];
  query_state: ConversationQueryState;
}

export type DirectorCopilotV2HistoryAuthorization =
  | { status: "allowed" }
  | { status: "access_changed" }
  | { status: "source_unavailable" };

export function directorCopilotV2PersistenceMetadata(
  response: AssistantChatResponse,
  actorContext: ApiRequestContext,
): Record<string, unknown> {
  const snapshot = v2Snapshot(response.current_context.director_copilot_v2_snapshot);
  const envelope = snapshot
    ? {
        schema_version: HISTORY_SCHEMA_VERSION,
        contract_version: "director-copilot-2",
        intent: snapshot.plan.intent,
        language: snapshot.plan.language,
        generated_at: snapshot.created_at,
        access_hash: historyAccessHash(actorContext, sourceApplications(snapshot)),
        source_applications: sourceApplications(snapshot),
        source_references: sourceReferences(snapshot),
        query_state: snapshot.plan.query_state,
      } satisfies V2HistoryEnvelope
    : null;

  return {
    confidence: response.confidence,
    current_context: {
      answer_source: stringValue(response.current_context.answer_source),
      active_source_application: stringValue(response.current_context.active_source_application),
      requested_director_copilot_intent: snapshot?.plan.intent ?? null,
      stratos_query_state: conversationQueryState(response.current_context.stratos_query_state)
        ?? snapshot?.plan.query_state,
      live_sources: assistantLiveSourcesFromOutcomes(snapshot?.outcomes),
    },
    director_copilot_history: envelope,
    follow_up_questions: response.follow_up_questions,
    suggested_actions: response.suggested_actions,
    report_artifacts: response.report_artifacts,
    warnings: response.warnings,
    missing_information: response.missing_information,
    recommended_action: response.recommended_action,
  };
}

export function persistedDirectorCopilotV2Response(
  response: AssistantChatResponse,
): AssistantChatResponse {
  const snapshot = v2Snapshot(response.current_context.director_copilot_v2_snapshot);
  return {
    ...response,
    current_context: {
      answer_source: stringValue(response.current_context.answer_source),
      active_source_application: stringValue(response.current_context.active_source_application),
      requested_director_copilot_intent: snapshot?.plan.intent ?? null,
      stratos_query_state: conversationQueryState(response.current_context.stratos_query_state)
        ?? snapshot?.plan.query_state,
      live_sources: assistantLiveSourcesFromOutcomes(snapshot?.outcomes),
    },
  };
}

export async function authorizeDirectorCopilotV2History(input: {
  message: AssistantConversationMessage;
  previousUserMessage: string;
  actorContext: ApiRequestContext;
  config: AklConfig;
  clients?: Pick<ApiClients, "registry">;
}): Promise<DirectorCopilotV2HistoryAuthorization> {
  const rawEnvelope = input.message.metadata.director_copilot_history;
  if (rawEnvelope === undefined) return { status: "allowed" };
  const envelope = historyEnvelope(rawEnvelope);
  if (!envelope || !input.previousUserMessage.trim()) return { status: "access_changed" };
  if (historyAccessHash(input.actorContext, envelope.source_applications) !== envelope.access_hash) {
    return { status: "access_changed" };
  }
  try {
    const catalog = await loadDirectorCopilotV2ManifestCatalog({
      config: input.config,
      context: input.actorContext,
    });
    const orchestration = await orchestrateDirectorCopilotV2({
      message: input.previousUserMessage,
      language: envelope.language,
      context: input.actorContext,
      intent: envelope.intent,
      queryState: envelope.query_state,
      catalog,
      client: new DirectorCopilotV2DomainToolClient({ config: input.config, catalog }),
      authorizeDocument: input.clients
        ? async (documentId, context) => {
            await input.clients!.registry.getDocument(documentId, context);
            return true;
          }
        : undefined,
    });
    if (
      orchestration.status === "not_authorized"
      || orchestration.snapshot.outcomes.every((outcome) => outcome.status === "not_authorized")
    ) {
      return { status: "access_changed" };
    }
    if (orchestration.status === "unavailable") return { status: "source_unavailable" };
    const current = new Set(sourceReferences(orchestration.snapshot).map(sourceAuthorizationKey));
    return envelope.source_references.every((reference) => current.has(sourceAuthorizationKey(reference)))
      ? { status: "allowed" }
      : { status: "access_changed" };
  } catch (error) {
    return error instanceof Error && "outcome" in error
      && (error as { outcome?: unknown }).outcome === "not_authorized"
      ? { status: "access_changed" }
      : { status: "source_unavailable" };
  }
}

function historyAccessHash(context: ApiRequestContext, applications: SourceApplication[]): string {
  const selected = new Set(applications);
  return stableSha256({
    subject_id: context.subjectId,
    organization_id: context.organizationId ?? null,
    identity_active: context.identityActive !== false,
    membership_active: context.membershipActive !== false,
    application_access_active: context.applicationAccessActive !== false,
    source_access: (context.applicationAccess ?? [])
      .filter((access) => selected.has(canonicalApplication(access.application)))
      .map((access) => ({
        application: canonicalApplication(access.application),
        capabilities: [...new Set(access.capabilities)].sort(),
        scopes: [...new Set(access.scopes ?? [])].sort(),
        effective_scopes: [...new Set(access.effectiveScopes ?? [])].sort(),
        valid_until: access.validUntil ?? null,
      }))
      .sort((left, right) => left.application.localeCompare(right.application)),
  });
}

function sourceApplications(snapshot: DirectorCopilotV2Snapshot): SourceApplication[] {
  return [...new Set(snapshot.plan.nodes.map((node) => node.application))].sort();
}

function sourceReferences(snapshot: DirectorCopilotV2Snapshot): SourceReference[] {
  const references = snapshot.outcomes.flatMap((outcome) => {
    const sourceSystem = sourceSystemFor(outcome.source_system);
    return sourceSystem
      ? outcome.items.map((item) => ({
          source_system: sourceSystem,
          canonical_id: item.canonical_id,
          source_version: item.source_version,
          policy_hash: item.policy.hash,
        }))
      : [];
  });
  return [...new Map(references.map((reference) => [sourceReferenceKey(reference), reference])).values()]
    .sort((left, right) => sourceReferenceKey(left).localeCompare(sourceReferenceKey(right)))
    .slice(0, MAX_SOURCE_REFERENCES);
}

function historyEnvelope(value: unknown): V2HistoryEnvelope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<V2HistoryEnvelope>;
  const applications = Array.isArray(candidate.source_applications)
    ? candidate.source_applications.filter(isSourceApplication)
    : [];
  const references = Array.isArray(candidate.source_references)
    ? candidate.source_references.filter(isSourceReference)
    : [];
  const queryState = conversationQueryState(candidate.query_state);
  if (
    candidate.schema_version !== HISTORY_SCHEMA_VERSION
    || candidate.contract_version !== "director-copilot-2"
    || !isIntent(candidate.intent)
    || (candidate.language !== "cs" && candidate.language !== "en")
    || typeof candidate.generated_at !== "string"
    || typeof candidate.access_hash !== "string"
    || applications.length === 0
    || references.length > MAX_SOURCE_REFERENCES
    || !queryState
  ) return null;
  return {
    schema_version: HISTORY_SCHEMA_VERSION,
    contract_version: "director-copilot-2",
    intent: candidate.intent,
    language: candidate.language,
    generated_at: candidate.generated_at,
    access_hash: candidate.access_hash,
    source_applications: [...new Set(applications)].sort(),
    source_references: references,
    query_state: queryState,
  };
}

function v2Snapshot(value: unknown): DirectorCopilotV2Snapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<DirectorCopilotV2Snapshot>;
  return candidate.schema_version === "director-copilot-v2-analysis-snapshot-1"
    && candidate.contract_version === "director-copilot-2"
    && candidate.plan?.schema_version === "director-copilot-v2-query-plan-1"
    && Array.isArray(candidate.outcomes)
    ? candidate as DirectorCopilotV2Snapshot
    : null;
}

function canonicalApplication(value: string): SourceApplication {
  const normalized = value.trim().toLowerCase().replaceAll("_", "-");
  return normalized === "project-flow" ? "projectflow" : normalized as SourceApplication;
}

function isSourceApplication(value: unknown): value is SourceApplication {
  return value === "budget" || value === "projectflow" || value === "archflow";
}

function sourceSystemFor(value: string | null): SourceSystem | null {
  return value === "STRATOS_BUDGET" || value === "STRATOS_PROJECTFLOW"
    || value === "STRATOS_ARCHFLOW" ? value : null;
}

function isSourceReference(value: unknown): value is SourceReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<SourceReference>;
  return sourceSystemFor(candidate.source_system ?? null) !== null
    && typeof candidate.canonical_id === "string"
    && typeof candidate.source_version === "string"
    && (typeof candidate.policy_hash === "string" || candidate.policy_hash === null);
}

function sourceReferenceKey(reference: SourceReference): string {
  return [reference.source_system, reference.canonical_id, reference.source_version, reference.policy_hash ?? ""].join("|");
}

function sourceAuthorizationKey(reference: SourceReference): string {
  return [reference.source_system, reference.canonical_id, reference.policy_hash ?? ""].join("|");
}

function isIntent(value: unknown): value is DirectorCopilotIntent {
  return value === "portfolio_risk_correlation" || value === "portfolio_performance_overview"
    || value === "project_portfolio_status" || value === "budget_portfolio_status"
    || value === "project_access_overview" || value === "archflow_demand_overview";
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
