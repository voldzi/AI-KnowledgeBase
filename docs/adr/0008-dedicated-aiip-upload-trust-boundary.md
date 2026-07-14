# ADR 0008: Dedicated AIIP Upload Trust Boundary

- Status: Accepted
- Date: 2026-07-14

## Context

AIIP authors must be able to send an immutable, centrally governed document to
AKB without receiving broad AKB policy-administration rights. A service token
alone cannot prove which current person owns the source, while trusting actor,
owner, scope, policy, or metadata from the integration payload would create an
authorization and lineage-confusion boundary.

## Decision

AIIP upload uses a dedicated three-operation Registry route family:

```text
POST  /api/v1/integrations/aiip-upload/external-documents/upsert
PUT   /api/v1/integrations/aiip-upload/documents/{document_id}/versions
PATCH /api/v1/integrations/aiip-upload/external-documents/{external_document_id}/current
```

The route family accepts only the exact `aiip-service` transport identity with
the `aiip-upload` route grant. Every request also carries an independent actor
bearer in `X-AIIP-Actor-Authorization`; it may not equal the service bearer.
Registry uses the independent `AKB_AIIP_INGEST_SERVICE_TOKEN` only to call the
central AIIP-to-AKB resource endpoint. It may not equal the general
`AKB_POLICY_SERVICE_TOKEN`.

This route family is exclusive, not merely preferred. Generic external-document,
document-version, and current-pointer write routes reject
`external_system=STRATOS_AIIP` and AIIP-governed lineage. A caller with another
valid AKB service or user credential therefore cannot bypass the actor bearer,
central reconfirmation, or current-pointer compare-and-swap by choosing a
generic route.

The central endpoint authorizes the fresh person projection and confirms the
exact active AIIP source root, source version, scope, inherited policy,
correlation id, and idempotency key. Registry accepts an exact echo only. AKB
derives ownership, assignments, uploader, parent lineage, scope, and policy
from this result and rejects caller-supplied owner and arbitrary metadata.
The web bridge and Registry accept only their documented, operation-specific
allowlists and reject unknown fields. Safe context tags, source location,
citation/preview links, and an optional owner-id consistency claim may be
carried, but none is authority. `metadata`, `gestor_unit`, owner display name,
or any field capable of creating an assignment is outside the contract. The
integration-envelope payload is also closed and contains only the documented
document-upload descriptor.

The accepted entity types are exactly `InnovationRequest` and
`InnovationRequestImport`. The accepted document types are exactly
`ai_intake`, `ai_requirement_card`, `ai_security_appendix`,
`ai_governance_evidence`, `knowledge_base_article`, `project_documentation`,
`attachment`, and `other`; the rest of the general Registry catalog is not
available through this route family.

Preflight signs every confirmed governance coordinate into the upload token.
It returns that opaque token only in `required_headers`, never as a top-level
response property. The binary `PUT` verifies the signed session, size, media
type, and SHA-256 before persistence, then issues a second opaque
`upload_receipt` bound to the persisted object. Confirm requires both the
original token and this receipt; absence, replay against another session, or
any size/hash/object mismatch fails before a version or ingestion job exists.
Version creation is deterministic and idempotent under a database transaction
lock. Replay re-confirms central state and compares persisted document, version,
file, historical registrar/uploader, parent, policy, and scope. The historical
`registeredBySubjectId` may differ from the fresh
`confirmedBySubjectId` during an authorized coordinator replay; they are never
collapsed into one identity.

Creating a version does not mutate the external document's current pointer.
Preflight signs the expected prior current version, and only the dedicated
current reconciliation operation may advance it under a shared transaction
lock and compare-and-swap. Concurrent or stale preflights receive a conflict;
an exact already-applied replay is accepted without downgrading the pointer.

After dedicated confirm creates the ingestion job, the pipeline does not reuse
the `aiip-service` bearer on generic Registry paths. The narrower proof,
transport, authoritative-attempt, and recovery contract is now defined by ADR
0009. Ingestion obtains a short-lived client-credentials bearer for its own
`svc-ingestion` identity; the AIIP/person bearer is never an Ingestion or generic
Registry transport credential.

Registry trusts `svc-ingestion` only for `authz`, `audit`, `documents-read`, and
the exact `ingestion-status` route family. That last family covers only
`PATCH /documents/{document_id}/external-references/current`. For an AIIP
reference the request must repeat the already-selected immutable version and
may mutate only ingestion job id/status. It cannot establish or advance the
current pointer, file, URI, or source lineage. `aiip-service` retains only the
`aiip-upload` grant.

## Consequences

- A normal AIIP author needs only the scoped AIIP ingest capability, not broad
  AKB policy administration.
- A stolen service token is insufficient to impersonate an actor, and an actor
  bearer cannot enter the integration route without the service identity.
- Stale, private-to-review-confused, forged, or locally tampered lineage fails
  closed before a readable AKB derivative is created or selected as current.
- A crash after immutable version creation leaves the previous current pointer
  intact; it cannot publish a half-confirmed version without an ingestion job.
- Generic external-document routes remain available to non-AIIP callers, while
  every AIIP write is rejected outside the narrower route family.
- `openapi/openapi.json` describes the exact dual-identity preflight/confirm,
  signed binary `PUT`, strict request/response bodies, required upload headers,
  opaque receipt, and authoritative governance confirmation without generic
  JSON fallbacks.
- The two static AKB governance credentials have separate rotation and blast
  radii and must never be logged or committed.
