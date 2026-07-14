import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import { requireApiAccess } from "@/lib/auth/server-route-guard";
import {
  candidateIndexSelection,
  exactAuthorizedIndexSelection,
  indexHitMatchesSelection,
} from "@/lib/intelligence/policy-filter";
import { authorizeIntelligenceScope } from "@/lib/intelligence/scope-authorization";
import { ApiClientError, type EntityRelationshipRequest } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let payload: EntityRelationshipRequest;
  try {
    payload = sanitizePayload(await request.json());
  } catch {
    return relationshipBadRequest("Invalid JSON body.");
  }

  try {
    const requestContext = await getServerRequestContext();
    const forbidden = requireApiAccess(requestContext, "knowledge_workspace");
    if (forbidden) return forbidden;

    const clients = getServerApiClients();
    const documents = await clients.registry.listDocuments(requestContext);
    const candidates = candidateIndexSelection(documents);
    const scope = await authorizeIntelligenceScope(
      clients,
      requestContext,
      candidates.documentIds,
    );
    const selection = exactAuthorizedIndexSelection(scope.authorizedDocuments);
    const response = await clients.ingestion.getEntityRelationships(
      {
        ...payload,
        allowed_document_ids: selection.documentIds,
        allowed_policy_hashes: selection.policyHashes,
      },
      requestContext,
      scope,
    );
    const authorizedEdges = response.edges
      .map((edge) => ({
        ...edge,
        evidence: edge.evidence.filter((item) =>
          indexHitMatchesSelection(item, selection),
        ),
      }))
      .filter((edge) => edge.evidence.length > 0);

    return NextResponse.json({
      ...response,
      edges: authorizedEdges,
      returned_edges: authorizedEdges.length,
    });
  } catch (error) {
    return relationshipBridgeError(error);
  }
}

function sanitizePayload(value: unknown): EntityRelationshipRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid payload");
  }
  const body = value as Record<string, unknown>;
  return {
    entity_type: optionalString(body.entity_type, 80),
    entity_value: optionalString(body.entity_value, 256),
    document_type: optionalString(body.document_type, 80),
    classification: optionalString(body.classification, 80),
    status: optionalString(body.status, 80),
    min_evidence_count: clampNumber(body.min_evidence_count, 1, 1, 20),
    limit: clampNumber(body.limit, 12, 1, 50),
  };
}

function optionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function relationshipBadRequest(message: string) {
  return NextResponse.json(
    {
      error: {
        code: "BAD_INTELLIGENCE_RELATIONSHIP_REQUEST",
        message,
      },
    },
    { status: 400 },
  );
}

function relationshipBridgeError(error: unknown) {
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
        code: "INTELLIGENCE_RELATIONSHIP_ERROR",
        message: "Intelligence relationship graph failed.",
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
