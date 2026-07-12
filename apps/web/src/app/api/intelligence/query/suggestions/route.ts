import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import { requireApiAccess } from "@/lib/auth/server-route-guard";
import {
  authorizedIndexSelection,
  type AuthorizedIndexSelection,
} from "@/lib/intelligence/policy-filter";
import {
  buildQueryIntelligenceResponse,
  buildQueryRecoveryCandidates,
} from "@/lib/intelligence/query-intelligence";
import {
  ApiClientError,
  type AnalystSearchField,
  type AnalystSearchMode,
  type ApiRequestContext,
  type EntityFacetReport,
  type QueryComposerRecoveryAction,
  type QueryComposerTokenInput,
  type QueryComposerTokenType,
  type QuerySuggestionRequest,
} from "@/lib/types";

export const runtime = "nodejs";

const TOKEN_TYPES = new Set(["term", "phrase", "field", "entity", "operator", "saved_query"]);
const SEARCH_MODES = new Set(["smart", "boolean", "phrase", "proximity", "fielded"]);
const SEARCH_FIELDS = new Set(["all", "title", "body", "section", "entity", "source"]);
const AUTHORIZED_IDS_TTL_MS = 5_000;
const AUTHORIZED_IDS_CACHE_LIMIT = 128;

interface AuthorizedIdsCacheEntry {
  expiresAt: number;
  selection: AuthorizedIndexSelection;
}

const authorizedIdsCache = new Map<string, AuthorizedIdsCacheEntry>();

export async function POST(request: NextRequest) {
  let payload: QuerySuggestionRequest;
  try {
    payload = sanitizePayload(await request.json());
  } catch {
    return querySuggestionsBadRequest("Invalid JSON body.");
  }

  try {
    const requestContext = await getServerRequestContext();
    const forbidden = requireApiAccess(requestContext, "knowledge_workspace");
    if (forbidden) return forbidden;

    const clients = getServerApiClients();
    const warnings: string[] = [];
    const queryState = buildQueryIntelligenceResponse({
      input: payload.input ?? "",
      tokens: payload.tokens ?? [],
      documents: [],
      entityFacets: emptyEntityFacets(),
      cases: [],
      activeCaseId: payload.active_case_id,
      language: payload.language ?? "cs",
      limit: payload.limit,
      warnings,
    });

    if (queryState.plan.can_run) {
      try {
        const selection = await authorizedDocumentSelection(clients, requestContext);
        const searchResult = await clients.ingestion.analystSearch(
          {
            query: queryState.plan.query_text,
            query_mode: queryState.plan.query_mode,
            search_fields: queryState.plan.search_fields,
            proximity_slop: queryState.plan.proximity_slop,
            allowed_document_ids: selection.documentIds,
            allowed_policy_hashes: selection.policyHashes,
            limit: 1,
          },
          requestContext,
        );
        const recoveryActions = searchResult.total_hits === 0
          ? await previewRecoveryActions(
              buildQueryRecoveryCandidates(queryState.plan, payload.language ?? "cs"),
              selection,
              clients,
              requestContext,
            )
          : [];
        queryState.preview = {
          status: "ready",
          total_hits: searchResult.total_hits,
          query_mode: searchResult.query_mode,
          recovery_actions: recoveryActions,
          warnings: searchResult.warnings.map((warning) => warning.code),
        };
      } catch {
        warnings.push("SEARCH_PREVIEW_UNAVAILABLE");
        queryState.preview = {
          ...queryState.preview,
          status: "unavailable",
          warnings: ["SEARCH_PREVIEW_UNAVAILABLE"],
        };
      }
    }

    queryState.status = warnings.length > 0 ? "partial" : "ready";
    queryState.warnings = warnings;
    return NextResponse.json(queryState, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return querySuggestionsBridgeError(error);
  }
}

async function previewRecoveryActions(
  actions: QueryComposerRecoveryAction[],
  selection: AuthorizedIndexSelection,
  clients: ReturnType<typeof getServerApiClients>,
  requestContext: ApiRequestContext,
): Promise<QueryComposerRecoveryAction[]> {
  return Promise.all(
    actions.map(async (action) => {
      try {
        const result = await clients.ingestion.analystSearch(
          {
            query: action.query_text,
            query_mode: action.query_mode,
            search_fields: action.search_fields,
            allowed_document_ids: selection.documentIds,
            allowed_policy_hashes: selection.policyHashes,
            limit: 1,
          },
          requestContext,
        );
        return { ...action, total_hits: result.total_hits };
      } catch {
        return action;
      }
    }),
  );
}

async function authorizedDocumentSelection(
  clients: ReturnType<typeof getServerApiClients>,
  context: ApiRequestContext,
): Promise<AuthorizedIndexSelection> {
  const now = Date.now();
  const key = authorizationCacheKey(context);
  const cached = authorizedIdsCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.selection;
  }

  const documents = await clients.registry.listDocuments(context);
  const selection = authorizedIndexSelection(documents, context);
  if (authorizedIdsCache.size >= AUTHORIZED_IDS_CACHE_LIMIT) {
    pruneAuthorizedIdsCache(now);
  }
  authorizedIdsCache.set(key, {
    expiresAt: now + AUTHORIZED_IDS_TTL_MS,
    selection,
  });
  return selection;
}

function authorizationCacheKey(context: ApiRequestContext): string {
  return [
    context.subjectId,
    [...(context.roles ?? [])].sort().join(","),
    [...(context.groups ?? [])].sort().join(","),
    [...(context.capabilities ?? [])].sort().join(","),
    [...(context.scopes ?? [])].sort().join(","),
    context.organizationId ?? "",
    String(context.identityActive),
    String(context.membershipActive),
    String(context.applicationAccessActive),
  ].join("|");
}

function pruneAuthorizedIdsCache(now: number) {
  for (const [key, entry] of authorizedIdsCache) {
    if (entry.expiresAt <= now || authorizedIdsCache.size >= AUTHORIZED_IDS_CACHE_LIMIT) {
      authorizedIdsCache.delete(key);
    }
  }
}

function sanitizePayload(value: unknown): QuerySuggestionRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid payload");
  }
  const body = value as Record<string, unknown>;
  return {
    input: optionalString(body.input, 200),
    tokens: sanitizeTokens(body.tokens),
    active_case_id: optionalString(body.active_case_id, 128),
    language: body.language === "en" ? "en" : "cs",
    limit: clampNumber(body.limit, 36, 1, 50),
  };
}

function sanitizeTokens(value: unknown): QueryComposerTokenInput[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .slice(0, 24)
    .map((item): QueryComposerTokenInput | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      const token = item as Record<string, unknown>;
      const type = tokenType(token.type);
      if (!type) {
        return null;
      }
      return {
        id: optionalString(token.id, 128) ?? undefined,
        type,
        label: optionalString(token.label, 160) ?? undefined,
        value: optionalString(token.value, 256) ?? undefined,
        query_fragment: optionalString(token.query_fragment, 300) ?? undefined,
        entity_type: optionalString(token.entity_type, 80) ?? undefined,
        entity_value: optionalString(token.entity_value, 256) ?? undefined,
        mode: searchMode(token.mode),
        field: searchField(token.field),
      };
    })
    .filter((item): item is QueryComposerTokenInput => item !== null);
}

function optionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function tokenType(value: unknown): QueryComposerTokenType | null {
  return typeof value === "string" && TOKEN_TYPES.has(value) ? (value as QueryComposerTokenType) : null;
}

function searchMode(value: unknown): AnalystSearchMode | undefined {
  return typeof value === "string" && SEARCH_MODES.has(value) ? (value as AnalystSearchMode) : undefined;
}

function searchField(value: unknown): AnalystSearchField | undefined {
  return typeof value === "string" && SEARCH_FIELDS.has(value) ? (value as AnalystSearchField) : undefined;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function emptyEntityFacets(): EntityFacetReport {
  return {
    status: "unavailable",
    index_name: "unavailable",
    total_chunks: 0,
    chunks_with_entities: 0,
    entity_types: [],
    entity_groups: [],
    generated_at: new Date().toISOString(),
    warnings: [{ code: "ENTITY_FACETS_UNAVAILABLE", message: "Entity facets are unavailable." }],
  };
}

function querySuggestionsBadRequest(message: string) {
  return NextResponse.json(
    {
      error: {
        code: "BAD_QUERY_SUGGESTIONS_REQUEST",
        message,
      },
    },
    { status: 400 },
  );
}

function querySuggestionsBridgeError(error: unknown) {
  if (isNextRedirectError(error)) {
    throw error;
  }

  if (error instanceof ApiClientError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          trace_id: error.traceId,
        },
      },
      { status: error.status },
    );
  }

  return NextResponse.json(
    {
      error: {
        code: "QUERY_SUGGESTIONS_ERROR",
        message: "Query suggestions failed.",
      },
    },
    { status: 500 },
  );
}

function isNextRedirectError(error: unknown): boolean {
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? (error as { digest?: unknown }).digest
      : undefined;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}
