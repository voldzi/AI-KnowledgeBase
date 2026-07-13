# ADR 0007: Immutable Public Document Delivery

- Status: Accepted
- Date: 2026-07-13

## Context

AKB distinguished organization-visible `PUBLIC` content from truly anonymous
content, but had no anonymous endpoint bound to the central STRATOS
`InformationPublication` lifecycle. Reusing authenticated source-open or RAG
routes would either fail to provide true public access or risk exposing live
metadata, storage locations, extracted text, chunks, or stale approvals.

## Decision

AKB publishes only an explicit, exact `document_version_id`. An interactive
bearer with scoped `akb:assign_policy` and `akb:publish_public` creates the
corresponding central publication; terminal revocation requires scoped
`akb:publish_public` and never resubmits client-controlled scope coordinates.
Service credentials cannot
perform this human approval. The version must already be valid, centrally
registered, public-policy eligible, and linked to exactly one source descriptor
whose full SHA-256 matches the immutable version.

Registry persists a strict public metadata allowlist, its canonical hash, the
exact internal source descriptor, policy coordinates, central publication id,
approval actors/times, and audit reason. Database constraints bind the source
version to the document version; a PostgreSQL trigger freezes all public,
source, policy, lineage, approval, and central coordinates after publication.
Only transition to terminal `REVOKED` remains possible.

Every anonymous metadata read and every source download calls central
`POST /api/v1/policy/public-decisions` without a bearer. An `ALLOW` is accepted
only when every returned publication coordinate matches the immutable local
record and the strict response carries the expected policy version and hash
without unknown fields. Central deny/revoke, outage, malformed response, mismatch, or local
integrity failure denies delivery.

Registry's anonymous response contains only the approved snapshot. Its source
URI is available solely through an internal resolver protected by a separate
shared token. The web public source boundary invokes that resolver, verifies
length and SHA-256 in bounded chunks before releasing content, and streams an
attachment with Range/ETag, `no-store`, `nosniff`, and sandbox headers. It never returns storage URI, document body,
extracted text, chunks, embeddings, prompts, answers, or RAG output.

The human page, metadata, and source routes enforce per-client/public-slug and
global rate limits plus per-client/global concurrency limits. A source lease
is held for the complete stream. The client key is an HMAC of the address
selected only from an explicitly trusted proxy suffix; a bounded global limit
protects capacity even when forwarded identity is spoofed. Anonymous delivery
audits are deterministic fixed-window aggregates with occurrence/last-seen
fields and separate retention; authenticated audit is unchanged.

The human public page is a dedicated route outside the internal AppShell and
OIDC session layout. It performs the same fresh metadata decision, renders
only the sanitized snapshot, and offers only the verified source-download
link. Any lookup, policy, integrity, or availability error produces one
generic fail-closed page with no document data.

## Consequences

- Public approval is independent from upload, document management, access
  administration, and ordinary authenticated `PUBLIC` visibility.
- Revocation takes effect at the next request because decisions are never
  cached at the delivery boundary.
- A content or public-metadata change requires a new immutable version and new
  approval; published coordinates cannot be silently edited.
- Registry and central public decisions both produce bounded audit evidence;
  logs and audit metadata contain no source URI or document content.
- Web and Registry require the same private delivery token, but that token has
  no STRATOS authorization capability and cannot make content public by itself.
