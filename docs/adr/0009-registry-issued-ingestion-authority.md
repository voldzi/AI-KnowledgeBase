# ADR 0009: Registry-Issued Ingestion Authority

- Status: Accepted
- Date: 2026-07-14

## Context

AKB web requests have a current person identity, while Ingestion Service is an
independent backend that must never accept browser claims, static roles, or an
unverified `X-AKL-On-Behalf-Of` value as document authority. Reusing the person
bearer at the Ingestion or Registry service would widen its audience and make a
technical worker responsible for reconstructing dynamic STRATOS access.

Job persistence creates a second boundary. A network timeout or process crash
between local job creation, Registry status synchronization, indexing, and a
terminal report must not allow two jobs to become current, execute an
unselected version, or publish a terminal local result without an authoritative
Registry transition that can be reconciled.

## Decision

The AKB web backend is the only production transport allowed to start or read
an interactive ingestion job. It authenticates to Ingestion Service with the
confidential Keycloak client `svc-akb-web-ingestion`, realm role
`service_akb_web_ingestion`, and audience `akl-api`. The client has no Registry
route grants. Its secret is held in a mode-`0600` host file, mounted read-only,
copied by the container entrypoint into a private runtime tmpfs, and readable
only by the unprivileged web process.

Before every create, read, retry, or cancel operation, the web backend asks
Registry with the current interactive person bearer to issue a short-lived,
closed authorization proof. Registry requires both the document root and the
requested immutable version to pass central authorization. The version must be
a registered governed resource whose parent is the exact registered document
root. The proof is bound to the exact person subject, action
(`document.ingest`, `document.read`, or `document.reindex`), document and
immutable version, organization, version governed-resource id and source
version, governed parent id, policy binding id/version/hash, canonical
governance-scope hash, correlation id, idempotency key, authorization id, and
expiry. Registry signs the proof with the independent
`AKL_INGESTION_AUTHORIZATION_SECRET`; this secret is never given to the web or
Ingestion Service.

Web sends only its own service bearer, the bounded subject in
`X-AKL-On-Behalf-Of`, and the proof in
`X-AKL-Ingestion-Authorization`. Ingestion Service accepts only the exact web
client for these routes and calls Registry with its separate `svc-ingestion`
client-credentials bearer to confirm every proof. Confirmation must echo every
bound coordinate and the current correlation/idempotency values. Registry
re-resolves the exact version authority at confirmation, so parent, policy, or
scope drift invalidates an otherwise correctly signed proof. The inbound person
bearer is never forwarded. A subject header is audit correlation only after
Registry has confirmed the signed proof; it is not an authorization source.

Registry persists one authoritative `ingestion_attempts` row per document. The
row binds one immutable version and globally unique job id and permits only
`QUEUED`, `INGESTING`, `INDEXED`, or `FAILED`. Initial selection and replacement
use row-locking compare-and-swap. An `INGESTING` lease cannot be taken over by a
retry. Version identity is protected by a composite foreign key to the same
document. Alembic revision `0018_ingestion_attempts` backfills unambiguous
current external-reference state and aborts rather than guessing when legacy
rows conflict.

The initial AIIP upload is a deliberately narrow authorization case. An AIIP
submitter does not need a general AKB `document.ingest` capability merely to
store the source of their own submitted idea. Registry may issue the
`document.ingest` proof without that capability only when the document has an
exact `STRATOS_AIIP` external reference, both the document and immutable version
are centrally registered with `own` scope for the same current person, the
person is the persisted document owner, the version inherits from that exact
document root, and its single file was uploaded by the same person. This does
not authorize read, reindex, another user's document, an organization-scoped
artifact, or any non-AIIP document. The issuance audit records
`authorization_basis=aiip_owner_submission`; every other issuance continues
through normal application capability and scope evaluation.

An interrupted AIIP upload may have already persisted its immutable AKB
version before a later confirmation failed. A retry that presents the same
content hash, filename, media type, byte size, AIIP source path, policy, and
governance lineage reuses that first canonical version and file even when the
retry uploaded the bytes into a fresh staging object. Object URI, storage
reference, and capture time are transport coordinates, not a new document
version. Any change to the immutable content or source lineage remains a
conflict.

For a centrally `REGISTERED` immutable version, the Registry-issued ingestion
authority is bound to the exact policy hash confirmed by STRATOS and persisted
with that registration. AKB must not replace it with a locally recomputed hash.
Mock or otherwise non-central registrations continue to require the locally
canonical policy hash.

The durable Ingestion job keeps the confirmed authorization id, exact web
transport client, canonical request hash, and deterministic job id. Jobs
without complete lineage are quarantined. Processing first obtains the
authoritative Registry claim and then an `INGESTING` lease before reading the
source, embedding, or indexing. Local terminal state, report, and pending
Registry outbox are one atomic durable write. Recovery replays only fully
verified jobs, reconciles an unknown claim or terminal outcome, and never
converts transport uncertainty into permission to execute.

The authoritative current-attempt read and update route is an internal
`ingestion-status` contract for the exact `svc-ingestion` client. A worker may
read only the attempt coordinates needed to select and recover the immutable
version; this route does not grant document content access or substitute for a
person's `document.read` decision. Interactive person reads continue through
normal document authorization.

Production global job listing and the legacy bulk reindex contract fail closed.
Static JWT roles do not authorize either operation. Intelligence queries use a
separate Registry-issued proof over the exact sorted set of current indexed
`document_id`, `document_version_id`, and `policy_hash` coordinates. Ingestion
confirms that proof through Registry before querying OpenSearch. The legacy
unscoped facet route is development/test-only; production uses the scoped POST
contract.

Ingestion readiness is authenticated. Deployment runs the probe inside the
container with the exact `svc-ingestion` identity and also checks the separate
non-mutating web-transport readiness route with
`svc-akb-web-ingestion`.

This decision supersedes only the post-confirm ingestion authorization
paragraphs of ADR 0008. ADR 0008 remains authoritative for the AIIP dual-identity
upload, immutable lineage, and current-pointer compare-and-swap.

## Consequences

- Neither a browser bearer, a service role, nor a caller-controlled subject
  header is sufficient to create, read, cancel, retry, reindex, or search
  document-derived content.
- Root-only access never implies access to a historical or differently governed
  immutable version; issuance requires both root and exact-version decisions.
- The web and worker credentials have separate rotation and blast radii; the
  Registry signing secret has a third independent rotation boundary.
- Retry and crash recovery preserve one authoritative current attempt without
  resetting data or downgrading the database.
- Production deployment must provision all three private files before build,
  run the forward-only `0018` migration after a verified backup, and verify the
  exact Registry, Ingestion, RAG, and web images before activation.
- Existing ambiguous legacy ingestion state is an explicit pre-migration
  remediation item, never an automatic winner-selection rule.
