import {
  ApiClientError,
  type AnalystSearchRequest,
  type EntityRelationshipRequest,
  type EntitySearchRequest,
  type IntelligenceDocumentCoordinate,
  type IntelligenceScopeAuthorizationOptions,
} from "@/lib/types";

const POLICY_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;

export function assertIntelligenceAuthorizationOptions(
  options: IntelligenceScopeAuthorizationOptions,
  traceId = "intelligence-scope",
): void {
  const documents = options?.authorizedDocuments;
  const documentIds = Array.isArray(documents)
    ? documents.map((document) => document.document_id)
    : [];
  if (
    typeof options?.authorizationToken !== "string"
    || options.authorizationToken.length < 32
    || options.authorizationToken.length > 4096
    || /\s/.test(options.authorizationToken)
    || typeof options?.idempotencyKey !== "string"
    || !IDEMPOTENCY_KEY_PATTERN.test(options.idempotencyKey)
    || typeof options?.correlationId !== "string"
    || !CORRELATION_ID_PATTERN.test(options.correlationId)
    || documentIds.length === 0
    || documentIds.length > 500
    || new Set(documentIds).size !== documentIds.length
    || documents.some((document) => !isExactCoordinate(document))
  ) {
    throw new ApiClientError(
      "The exact Registry-issued intelligence authorization is invalid.",
      400,
      "INTELLIGENCE_SCOPE_AUTHORIZATION_INVALID",
      traceId,
    );
  }
}

export function bindAuthorizedDocumentScope<
  T extends EntitySearchRequest | AnalystSearchRequest | EntityRelationshipRequest,
>(
  request: T,
  options: IntelligenceScopeAuthorizationOptions,
): T {
  assertIntelligenceAuthorizationOptions(options, options.correlationId);
  return {
    ...request,
    authorized_documents: options.authorizedDocuments,
    allowed_document_ids: options.authorizedDocuments.map(
      (document) => document.document_id,
    ),
    allowed_policy_hashes: Object.fromEntries(
      options.authorizedDocuments.map((document) => [
        document.document_id,
        [document.policy_hash],
      ]),
    ),
  };
}

export function coordinateByDocumentId(
  options: IntelligenceScopeAuthorizationOptions,
): Map<string, IntelligenceDocumentCoordinate> {
  assertIntelligenceAuthorizationOptions(options, options.correlationId);
  return new Map(
    options.authorizedDocuments.map((document) => [document.document_id, document]),
  );
}

function isExactCoordinate(document: IntelligenceDocumentCoordinate): boolean {
  return Boolean(
    document
    && typeof document.document_id === "string"
    && document.document_id.length >= 1
    && document.document_id.length <= 128
    && typeof document.document_version_id === "string"
    && document.document_version_id.length >= 1
    && document.document_version_id.length <= 128
    && typeof document.policy_hash === "string"
    && POLICY_HASH_PATTERN.test(document.policy_hash)
  );
}
