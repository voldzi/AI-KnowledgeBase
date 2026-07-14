import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { assertIntelligenceAuthorizationOptions } from "@/lib/intelligence/authorization-contract";
import type {
  ApiClients,
  ApiRequestContext,
  IntelligenceScopeAuthorizationOptions,
  IntelligenceScopeAuthorizationResponse,
} from "@/lib/types";
import { ApiClientError } from "@/lib/types";

const POLICY_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SCOPE_AUTHORIZATION_ID_PATTERN = /^iscope_[A-Za-z0-9_-]{8,128}$/;

export async function authorizeIntelligenceScope(
  clients: ApiClients,
  context: ApiRequestContext,
  candidateDocumentIds: string[],
): Promise<IntelligenceScopeAuthorizationOptions> {
  const documentIds = [...new Set(candidateDocumentIds.map((value) => value.trim()))]
    .filter(Boolean)
    .sort();
  if (
    documentIds.length === 0
    || documentIds.length > 500
    || documentIds.some((documentId) => documentId.length > 128)
  ) {
    throw scopeError(
      "A bounded non-empty intelligence document scope is required.",
      "INTELLIGENCE_SCOPE_REQUIRED",
      context,
    );
  }

  const correlationId = context.correlationId ?? context.requestId ?? randomUUID();
  const idempotencyKey = `intelligence:${randomUUID()}`;
  const response = await clients.registry.createIntelligenceScopeAuthorization(
    {
      document_ids: documentIds,
      correlation_id: correlationId,
      idempotency_key: idempotencyKey,
    },
    {
      ...context,
      requestId: correlationId,
      correlationId,
    },
  );
  validateScopeResponse(
    response,
    documentIds,
    context.subjectId,
    correlationId,
    idempotencyKey,
  );
  const options = {
    authorizationToken: response.authorization_token,
    idempotencyKey,
    correlationId,
    authorizedDocuments: response.documents,
  };
  assertIntelligenceAuthorizationOptions(options, correlationId);
  return options;
}

function validateScopeResponse(
  response: IntelligenceScopeAuthorizationResponse,
  requestedDocumentIds: string[],
  subjectId: string,
  correlationId: string,
  idempotencyKey: string,
): void {
  if (
    !response
    || typeof response !== "object"
    || !Array.isArray(response.documents)
    || response.documents.some(
      (document) => !document || typeof document !== "object",
    )
  ) {
    throw invalidScopeResponse(correlationId);
  }
  const requested = new Set(requestedDocumentIds);
  const responseIds = response.documents.map((document) => document.document_id);
  const expiresAt = Date.parse(response.expires_at);
  const expectedScopeHash = canonicalScopeHash(response.documents);
  if (
    response.action !== "intelligence.query" ||
    response.confirmed_subject_id !== subjectId ||
    response.correlation_id !== correlationId ||
    response.idempotency_key !== idempotencyKey ||
    response.document_count !== response.documents.length ||
    response.documents.length === 0 ||
    response.documents.length > 500 ||
    new Set(responseIds).size !== responseIds.length ||
    responseIds.some((documentId) => !requested.has(documentId)) ||
    !SCOPE_AUTHORIZATION_ID_PATTERN.test(response.authorization_id) ||
    response.document_scope_hash !== expectedScopeHash ||
    response.documents.some(
      (document) =>
        !document.document_id ||
        document.document_id.length > 128 ||
        !document.document_version_id ||
        document.document_version_id.length > 128 ||
        !POLICY_HASH_PATTERN.test(document.policy_hash),
    ) ||
    typeof response.authorization_token !== "string" ||
    response.authorization_token.length < 32 ||
    response.authorization_token.length > 4096 ||
    /\s/.test(response.authorization_token) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    throw invalidScopeResponse(correlationId);
  }
}

function invalidScopeResponse(correlationId: string): ApiClientError {
  return new ApiClientError(
    "Registry returned an invalid intelligence scope authorization.",
    502,
    "INTELLIGENCE_SCOPE_AUTHORIZATION_INVALID",
    correlationId,
  );
}

function canonicalScopeHash(
  documents: IntelligenceScopeAuthorizationResponse["documents"],
): string {
  const canonical = [...documents]
    .sort((left, right) => compareCanonicalStrings(left.document_id, right.document_id))
    .map((document) => ({
      document_id: document.document_id,
      document_version_id: document.document_version_id,
      policy_hash: document.policy_hash,
    }));
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
}

function compareCanonicalStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function scopeError(
  message: string,
  code: string,
  context: ApiRequestContext,
): ApiClientError {
  return new ApiClientError(
    message,
    409,
    code,
    context.correlationId ?? context.requestId ?? "intelligence-scope",
  );
}
