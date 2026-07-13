# AKB AIIP Application API v1

## Public Contract

AIIP calls only the AKB application boundary:

```text
POST https://stratos.zeleznalady.cz/akb/api/integrations/aiip/v1/harmonize
POST https://stratos.zeleznalady.cz/akb/api/integrations/aiip/v1/duplicates/search
```

The versioned machine-readable contract is
`openapi/aiip-application-api.v1.json`. Request and response examples are in
`docs/integration/fixtures/aiip-application-api/`.

AIIP must not call RAG Retrieval Service, Qdrant, OpenSearch, or LLM Gateway
directly.

RAG uses a separate internal `akb-rag-service` client with role `service_rag`
and audience `akl-api` for Registry authorization, audit, and idempotency. The
AIIP token is never repurposed as a Registry or LLM Gateway credential.
Generic RAG, assistant, citation, extraction, and governance routes reject all
service identities; only the two versioned AIIP integration routes accept the
exact AIIP client.

## Identity And Headers

The caller obtains a Keycloak token through `client_credentials`:

| Property | Required value |
| --- | --- |
| Client id | `aiip-service` |
| Realm role | `service_aiip` |
| Audience | `akb-api` |
| Token transport | `Authorization: Bearer <token>` |

Every request also supplies stable `X-Request-ID`, `X-Correlation-ID`, and
`Idempotency-Key` headers. AIIP must never send `X-AKL-*`; the AKB bridge
derives trusted internal identity headers only after token introspection.

## Policy And Limits

- Allowed classifications: `public`, `internal`.
- The compatibility `tenant_id` field must be exactly `org_stratos`; it is an
  organization boundary and cannot select an arbitrary tenant namespace.
- `restricted` and `confidential` return `403 CLASSIFICATION_NOT_ALLOWED`
  before any model or retrieval call.
- Maximum JSON body size: 64 kB.
- AKB upstream processing timeout: 70 seconds. The AIIP client timeout is 75
  seconds so AKB can return a controlled error first.
- Rate limit: 30 requests per service subject per minute.
- Concurrency limit: 4 active requests per service subject.
- `429` includes `Retry-After`; retry uses the same idempotency key.
- AKB does not persist or log prompts, source record bodies, model responses,
  bearer tokens, or vectors.

## Idempotency

Registry stores `(client_id, operation, Idempotency-Key)` with a canonical
SHA-256 request-body hash for 24 hours.

The public request namespace is `aiip-service`. The Registry caller is the
separate `akb-rag-service`, which may reserve and complete that namespace only
through the explicit deployment delegation
`akb-rag-service=aiip-service`. Neither client can access any other namespace.

Production creates this storage through Alembic revision
`0010_integration_idempotency`. Revision `0011_aiip_service_access` adds the
application role to existing AIIP read/RAG policies; automatic schema creation
remains disabled.

- First request: processing is reserved and the completed response is stored.
- Exact replay: HTTP 200, identical body, `Idempotency-Replayed: true`.
- Same key with another body: HTTP 409 `IDEMPOTENCY_KEY_REUSED`.
- Concurrent duplicate while the first request runs: HTTP 409
  `IDEMPOTENCY_REQUEST_PROCESSING`.
- A processing reservation left behind by a process or network failure can be
  reclaimed after five minutes.

## Harmonization

`harmonize` requests advisory normalization only. `result.suggestions` carries
the proposed field value, confidence from 0 to 1, input-field provenance, and
prompt-template version. `review_required` is always true. AKB never writes the
suggestions back to AIIP and never mutates the source record.

`model_preference=standard` requests `gemma4:12b-mlx`.
`model_preference=high_quality` requests `gemma4:31b-mlx`; LLM Gateway may fall
back to `gemma4:12b-mlx`. The response states requested and actual model plus
`fallback_applied`. AKB attempts one strict JSON repair. A second invalid result
returns `422 STRUCTURED_OUTPUT_INVALID` without a partial result.

## Duplicate Search

`duplicates/search` performs hybrid semantic and lexical retrieval over
`ai_intake` and `ai_requirement_card` documents, including drafts because AIIP
ideas are compared before publication. Retrieval is constrained by:

- exact organization boundary `tenant_id=org_stratos`,
- `external_system=STRATOS_AIIP`,
- requested classification ceiling,
- Registry document authorization.

Candidates use a normalized 0-to-1 score, stable source and AKB identifiers,
matched areas, and one or more citations. Pagination uses `limit` (1-20) and
`offset` (0-200). The response exposes the retrieval index version but never
embeddings or unrestricted source text.

Existing AIIP documents must be reingested after deployment so tenant and
external identity fields are present in both Qdrant and OpenSearch payloads.

## Audit And Retention

Each successful operation writes one Registry audit event and returns its
`audit_event_id`. Registry stores the verified RAG service-account subject as
the actual `actor_id`; the AIIP identity declared by the integration layer is
stored only as `reported_actor_id`, together with the server-derived
`service_client_id`. Audit metadata also includes identifiers, classification,
processing purpose, canonical input hash, model/index version, usage counts,
latency, result counts, and correlation id. It excludes prompts, record bodies,
answers, cited text, credentials, and vectors. Application audit metadata is
retained for 180 days under the standard AKB audit retention policy.

## Errors

All public errors use the AKB envelope:

```json
{
  "error": {
    "code": "STABLE_CODE",
    "message": "Safe message",
    "details": {},
    "trace_id": "correlation-id",
    "request_id": "request-id",
    "correlation_id": "correlation-id",
    "audit_event_id": null
  }
}
```

The binding OpenAPI enumerates `400`, `401`, `403`, `409`, `413`, `422`,
`429`, `502`, and `503` responses. No error includes a prompt, model output, or
sensitive source data.

## Acceptance Checks

AKB contract tests cover service identity, role and audience, both rejected
classifications, 64 kB enforcement, rate limiting, trusted-header creation,
model fallback, structured-output repair failure, cited duplicate candidates,
tenant-scoped index filters, and exact idempotent replay. Production acceptance
must additionally obtain a real `aiip-service` token and execute both public
operations using synthetic `public` or `internal` fixtures.

The safe production smoke prints only statuses, identifier-presence flags,
model/index metadata, counts, and error codes:

```bash
python3 scripts/aiip_application_api_smoke.py
```
