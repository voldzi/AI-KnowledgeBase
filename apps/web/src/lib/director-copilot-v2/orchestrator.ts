import "server-only";

import type { ApiRequestContext, ResponseLanguage } from "@/lib/types";
import type { ConversationQueryState } from "@/lib/director-copilot/query-state";
import { DirectorCopilotTransportError } from "@/lib/director-copilot/transport-error";

import { directorCopilotV2AccessFor } from "./access";
import {
  DIRECTOR_COPILOT_V2_CONTRACT,
  canonicalJson,
  directorCopilotV2StableId,
  type DirectorCopilotV2Application,
  type DirectorCopilotV2Item,
  type DirectorCopilotV2Response,
  type DirectorCopilotV2ToolId,
} from "./contracts";
import type { DirectorCopilotV2DomainToolClient } from "./domain-tool-client";
import type { DirectorCopilotV2ManifestCatalog } from "./manifest-catalog";
import { directorCopilotV2ContinuationQueryState } from "./continuation";
import {
  buildDirectorCopilotV2Plan,
  type DirectorCopilotV2Plan,
  type DirectorCopilotV2PlanNode,
} from "./planner";
import { accessProjectionHash, type DirectorCopilotIntent } from "./shared";

const MAX_PAGES_PER_TOOL = 5;
const MAX_ITEMS_PER_TOOL = 500;

export const DIRECTOR_COPILOT_V2_SNAPSHOT_VERSION =
  "director-copilot-v2-analysis-snapshot-1" as const;

export interface DirectorCopilotV2SourceOutcome {
  application: DirectorCopilotV2Application;
  tool_id: DirectorCopilotV2ToolId;
  schema_revision: string;
  status: "complete" | "partial" | "no_data" | "not_authorized" | "unavailable";
  reason_codes: string[];
  source_system: string | null;
  source_version: string | null;
  generated_at: string | null;
  as_of: string | null;
  pages: number;
  latency_ms: number;
  candidate_count: number;
  authorized_result_complete: boolean;
  items: DirectorCopilotV2Item[];
}

export interface DirectorCopilotV2Snapshot {
  schema_version: typeof DIRECTOR_COPILOT_V2_SNAPSHOT_VERSION;
  contract_version: typeof DIRECTOR_COPILOT_V2_CONTRACT;
  snapshot_id: string;
  snapshot_hash: string;
  created_at: string;
  correlation_id: string;
  projection_hash: string;
  plan: DirectorCopilotV2Plan;
  outcomes: DirectorCopilotV2SourceOutcome[];
  authorized_document_ids: string[];
  internal_warnings: string[];
}

export interface DirectorCopilotV2OrchestrationResult {
  status: "complete" | "partial" | "no_data" | "not_authorized" | "unavailable";
  plan: DirectorCopilotV2Plan;
  snapshot: DirectorCopilotV2Snapshot;
  continuation_query_state: ConversationQueryState;
}

type V2Executor = Pick<DirectorCopilotV2DomainToolClient, "execute">;

export async function orchestrateDirectorCopilotV2(input: {
  message: string;
  language: ResponseLanguage;
  context: ApiRequestContext;
  intent: DirectorCopilotIntent;
  queryState: ConversationQueryState;
  catalog: DirectorCopilotV2ManifestCatalog;
  client: V2Executor;
  refreshActorContext?: () => Promise<ApiRequestContext>;
  authorizeDocument?: (
    documentId: string,
    context: ApiRequestContext,
  ) => Promise<boolean>;
  now?: Date;
}): Promise<DirectorCopilotV2OrchestrationResult> {
  const now = input.now ?? new Date();
  const plan = buildDirectorCopilotV2Plan({
    message: input.message,
    language: input.language,
    context: input.context,
    intent: input.intent,
    queryState: input.queryState,
    catalog: input.catalog,
    now,
  });
  const outcomes = await Promise.all(
    plan.nodes.map((node) => executeNode(node, input.context, input.catalog, input.client)),
  );
  const refreshedContext = input.refreshActorContext
    ? await input.refreshActorContext()
    : input.context;
  assertReauthorized(plan, refreshedContext, input.catalog);
  const { authorizedDocumentIds, warnings } = await authorizeDocumentLinks(
    outcomes,
    refreshedContext,
    input.authorizeDocument,
  );
  const status = aggregateStatus(outcomes);
  const continuationQueryState = directorCopilotV2ContinuationQueryState(
    plan.query_state,
    outcomes,
    input.catalog,
  );
  const snapshotBase = {
    schema_version: DIRECTOR_COPILOT_V2_SNAPSHOT_VERSION,
    contract_version: DIRECTOR_COPILOT_V2_CONTRACT,
    created_at: now.toISOString(),
    correlation_id:
      refreshedContext.correlationId
      ?? refreshedContext.requestId
      ?? plan.plan_id,
    projection_hash: accessProjectionHash(refreshedContext),
    plan,
    outcomes,
    authorized_document_ids: authorizedDocumentIds,
    internal_warnings: warnings,
  };
  const snapshotHash = `sha256:${
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(canonicalJson(snapshotBase)),
    ).then((buffer) => Buffer.from(buffer).toString("hex"))
  }`;
  const snapshot: DirectorCopilotV2Snapshot = {
    ...snapshotBase,
    snapshot_id: directorCopilotV2StableId("snap", snapshotHash),
    snapshot_hash: snapshotHash,
  };
  return {
    status,
    plan,
    snapshot,
    continuation_query_state: continuationQueryState,
  };
}

async function executeNode(
  node: DirectorCopilotV2PlanNode,
  context: ApiRequestContext,
  catalog: DirectorCopilotV2ManifestCatalog,
  client: V2Executor,
): Promise<DirectorCopilotV2SourceOutcome> {
  const startedAt = performance.now();
  if (node.planning_error_code) {
    return unavailableOutcome(
      node,
      node.planning_error_code,
      elapsedMilliseconds(startedAt),
    );
  }
  if (!node.access.authorized || !node.request) {
    return {
      application: node.application,
      tool_id: node.tool_id,
      schema_revision: node.schema_revision,
      status: "not_authorized",
      reason_codes: [`DIRECTOR_COPILOT_V2_${node.access.reason.toUpperCase()}`],
      source_system: null,
      source_version: null,
      generated_at: null,
      as_of: null,
      pages: 0,
      latency_ms: 0,
      candidate_count: 0,
      authorized_result_complete: false,
      items: [],
    };
  }
  const manifest = catalog.byTool.get(node.tool_id);
  if (!manifest) {
    return unavailableOutcome(
      node,
      "DIRECTOR_COPILOT_V2_MANIFEST_MISSING",
      elapsedMilliseconds(startedAt),
    );
  }
  const responses: DirectorCopilotV2Response[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES_PER_TOOL; page += 1) {
    const request = page === 0
      ? node.request
      : {
          ...node.request,
          tool_call_id: directorCopilotV2StableId("call", {
            plan_id: node.request.plan_id,
            node_id: node.node_id,
            cursor,
          }),
          parameters: {
            ...node.request.parameters,
            cursor,
          },
        };
    try {
      const response = await client.execute(node.application, request, context);
      responses.push(response);
      cursor = response.next_cursor;
      if (!cursor) break;
      if (responses.reduce((count, candidate) => count + candidate.items.length, 0) >= MAX_ITEMS_PER_TOOL) {
        break;
      }
    } catch (error) {
      if (error instanceof DirectorCopilotTransportError) {
        return {
          ...unavailableOutcome(node, error.code, elapsedMilliseconds(startedAt)),
          status: error.outcome === "not_authorized" ? "not_authorized" : "unavailable",
        };
      }
      return unavailableOutcome(
        node,
        "DIRECTOR_COPILOT_V2_SOURCE_UNAVAILABLE",
        elapsedMilliseconds(startedAt),
      );
    }
  }
  return mergeResponses(node, responses, cursor, elapsedMilliseconds(startedAt));
}

function mergeResponses(
  node: DirectorCopilotV2PlanNode,
  responses: DirectorCopilotV2Response[],
  remainingCursor: string | null,
  latencyMs: number,
): DirectorCopilotV2SourceOutcome {
  if (!responses.length) {
    return unavailableOutcome(node, "DIRECTOR_COPILOT_V2_SOURCE_UNAVAILABLE", latencyMs);
  }
  const first = responses[0]!;
  if (
    responses.some((response) => (
      response.source_system !== first.source_system
      || response.source_version !== first.source_version
      || response.period.fiscal_year !== first.period.fiscal_year
    ))
  ) {
    return unavailableOutcome(node, "DIRECTOR_COPILOT_V2_PAGE_CONFLICT", latencyMs);
  }
  const itemsByKey = new Map<string, DirectorCopilotV2Item>();
  for (const item of responses.flatMap((response) => response.items)) {
    const key = `${item.canonical_id}|${item.source_version}`;
    const existing = itemsByKey.get(key);
    if (existing && canonicalJson(existing) !== canonicalJson(item)) {
      return unavailableOutcome(node, "DIRECTOR_COPILOT_V2_PAGE_ITEM_CONFLICT", latencyMs);
    }
    itemsByKey.set(key, item);
  }
  const items = [...itemsByKey.values()].slice(0, MAX_ITEMS_PER_TOOL);
  const reasonCodes = [...new Set(responses.flatMap((response) => [
    ...response.warnings,
    ...response.completeness.missing_reasons,
  ]))];
  const sourceStatuses = responses.map((response) => response.status);
  const pageLimitReached = Boolean(remainingCursor);
  return {
    application: node.application,
    tool_id: node.tool_id,
    schema_revision: node.schema_revision,
    status: pageLimitReached || sourceStatuses.includes("partial")
      ? "partial"
      : sourceStatuses.every((status) => status === "not_authorized")
        ? "not_authorized"
        : sourceStatuses.every((status) => status === "no_data")
          ? "no_data"
          : "complete",
    reason_codes: [
      ...reasonCodes,
      ...(pageLimitReached ? ["DIRECTOR_COPILOT_V2_PAGE_LIMIT_REACHED"] : []),
    ],
    source_system: first.source_system,
    source_version: first.source_version,
    generated_at: responses.map((response) => response.generated_at).sort().at(-1) ?? null,
    as_of: responses.map((response) => response.as_of).sort().at(-1) ?? null,
    pages: responses.length,
    latency_ms: latencyMs,
    candidate_count: Math.max(...responses.map((response) => response.completeness.candidate_count)),
    authorized_result_complete: !pageLimitReached
      && responses.every((response) => response.completeness.authorized_result_complete),
    items,
  };
}

function assertReauthorized(
  plan: DirectorCopilotV2Plan,
  context: ApiRequestContext,
  catalog: DirectorCopilotV2ManifestCatalog,
): void {
  const plannedActor = plan.nodes.find((node) => node.request)?.request?.actor.subject_id;
  if (plannedActor && context.subjectId !== plannedActor) {
    throw new DirectorCopilotTransportError(
      "DIRECTOR_COPILOT_V2_ACTOR_CHANGED",
      "Actor identity changed before synthesis.",
      "not_authorized",
      403,
    );
  }
  if (accessProjectionHash(context) !== plan.projection_hash) {
    throw new DirectorCopilotTransportError(
      "DIRECTOR_COPILOT_V2_ACCESS_CHANGED",
      "Actor access changed before synthesis.",
      "not_authorized",
      403,
    );
  }
  for (const node of plan.nodes) {
    if (!node.request) continue;
    const manifest = catalog.byTool.get(node.tool_id);
    if (!manifest) throw new Error(`Missing manifest ${node.tool_id}.`);
    const decision = directorCopilotV2AccessFor(
      context,
      node.application,
      manifest,
      node.request.parameters.granularity,
    );
    if (
      !decision.authorized
      || canonicalJson(decision.scopes) !== canonicalJson(node.request.requested_scopes)
    ) {
      throw new DirectorCopilotTransportError(
        "DIRECTOR_COPILOT_V2_REAUTHORIZATION_FAILED",
        "Actor authorization no longer covers the source result.",
        "not_authorized",
        403,
      );
    }
  }
}

async function authorizeDocumentLinks(
  outcomes: DirectorCopilotV2SourceOutcome[],
  context: ApiRequestContext,
  authorizeDocument:
    | ((documentId: string, context: ApiRequestContext) => Promise<boolean>)
    | undefined,
): Promise<{ authorizedDocumentIds: string[]; warnings: string[] }> {
  const documentIds = [...new Set(
    outcomes.flatMap((outcome) => outcome.items)
      .flatMap((item) => item.links)
      .filter((link) => (
        link.key === "projectflow.project.document"
        && link.relation_type === "direct"
        && link.target_entity_type === "document"
        && link.target_canonical_id.startsWith("stratos:document:")
      ))
      .map((link) => link.target_canonical_id.slice("stratos:document:".length)),
  )].slice(0, 32);
  if (!documentIds.length) return { authorizedDocumentIds: [], warnings: [] };
  if (!authorizeDocument) {
    return {
      authorizedDocumentIds: [],
      warnings: ["DIRECTOR_COPILOT_V2_DOCUMENT_AUTHORIZATION_UNAVAILABLE"],
    };
  }
  const decisions = await Promise.all(
    documentIds.map(async (documentId) => {
      try {
        return [documentId, await authorizeDocument(documentId, context)] as const;
      } catch {
        return [documentId, false] as const;
      }
    }),
  );
  const authorizedDocumentIds = decisions
    .filter(([, allowed]) => allowed)
    .map(([documentId]) => documentId)
    .sort();
  const deniedCount = decisions.length - authorizedDocumentIds.length;
  return {
    authorizedDocumentIds,
    warnings: deniedCount
      ? ["DIRECTOR_COPILOT_V2_DOCUMENT_LINK_DENIED"]
      : [],
  };
}

function aggregateStatus(
  outcomes: DirectorCopilotV2SourceOutcome[],
): DirectorCopilotV2OrchestrationResult["status"] {
  if (!outcomes.length || outcomes.every((outcome) => outcome.status === "unavailable")) {
    return "unavailable";
  }
  if (outcomes.every((outcome) => outcome.status === "not_authorized")) {
    return "not_authorized";
  }
  if (outcomes.every((outcome) => outcome.status === "no_data")) {
    return "no_data";
  }
  if (outcomes.some((outcome) => (
    outcome.status === "partial"
    || outcome.status === "unavailable"
    || outcome.status === "not_authorized"
  ))) {
    return "partial";
  }
  return "complete";
}

function unavailableOutcome(
  node: DirectorCopilotV2PlanNode,
  code: string,
  latencyMs = 0,
): DirectorCopilotV2SourceOutcome {
  return {
    application: node.application,
    tool_id: node.tool_id,
    schema_revision: node.schema_revision,
    status: "unavailable",
    reason_codes: [code],
    source_system: null,
    source_version: null,
    generated_at: null,
    as_of: null,
    pages: 0,
    latency_ms: latencyMs,
    candidate_count: 0,
    authorized_result_complete: false,
    items: [],
  };
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
