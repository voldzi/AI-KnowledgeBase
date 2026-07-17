# STRATOS Access And Information Policy V2

## Accepted Contract

AKB G2/G3 accepts these exact versions:

- `stratos-access-1`
- `information-policy-2.0.0`
- `stratos-integration-envelope-1`

The byte-identical snapshot and conformance fixtures are under
`contracts/stratos/`. Run `scripts/verify_stratos_contract_snapshot.py` before
integration acceptance. Contract changes require a versioned replacement and
an impact review; unknown versions, obligations, bindings, or legal
classifications fail closed.

## Access Decision

For a `stratos-access-1` principal, AKB requires all of the following:

1. active identity, organization membership, and AKB application access;
2. `organizationId=org_stratos`;
3. the operation-specific `akb:*` capability;
4. a scope matching the document policy audience;
5. a valid current Information Policy V2 binding.

Global roles `stratos_user` and `stratos_admin` do not grant document content,
administration, or export by themselves. In particular, `stratos_admin` still
requires `akb:manage_access` for AKB administration. Registry remains the
authoritative enforcement point; web navigation is only progressive
disclosure.

The Keycloak token is accepted only after signature, issuer, audience, and
expiry verification and serves only as identity proof. For users, web and
Registry load the current AKB projection from STRATOS `GET /api/v1/auth/me`
using the user's bearer token. Capabilities, scopes, active membership, and AKB
application access are not read from `stratos_access`, top-level token claims,
or client headers. Missing, malformed, rejected, expired, or unavailable
projection data fails closed. The default projection cache TTL is zero; any
configured cache is bounded by token expiry.

Service-to-service document and audit decisions use STRATOS
`POST /api/v1/policy/decisions` with an AKB runtime credential and delegated
actor subject. Production callers cannot delegate roles, capabilities, scopes,
or active flags through `X-AKL-*`, `X-STRATOS-*`, or authz request fields.
Those inputs exist only in explicit mock/E2E mode.

Every production document operation also sends the concrete stored resource
scope to the central decision endpoint. AKB does not replace an
`organization_unit:it` or `project:*` scope with organization-wide scope. A
deactivated or unrelated scope therefore fails immediately even if an older
projection or index entry still exists.

Legacy AKB roles remain as an explicit pre-reset compatibility path only for
mock/local execution. They are not part of the new epoch and must not be
assigned by the G7 Keycloak baseline.

## Policy Inheritance

Upload admission validates the binding and integration envelope before binary
storage. The document and each immutable version store:

- organization id;
- policy binding id and policy version;
- canonical `sha256:` policy hash;
- policy summary used for local decisions.

They additionally store the central `GovernedInformationResource` id,
immutable source version, parent id, concrete registered scope, registration
status, and registration timestamp. Normal user operations register with the
verified user bearer. Generic service writes use the dedicated
`AKB_POLICY_SERVICE_TOKEN`, mapped to the fixed `service:akb` identity; an
integration-envelope actor on those routes remains audit metadata only. The
narrowly defined official-public-reference workflow is the only interactive
exception: a manager with `akb:manage_document` approves the collection, while
Registry uses the same fixed `service:akb` identity for central resource
registration and subsequent central runtime decisions, and records the manager
as audit metadata. Marker, metadata, public policy shape and organization scope
must all match; the manager's current local capability and ingestion proof are
still required, while ordinary uploads continue to use the verified user
bearer.

AIIP ingestion is a narrower exception described in ADR 0008. Only the
`aiip-service` client may enter the `aiip-upload` route family, and every call
must carry a second, independent current actor bearer in
`X-AIIP-Actor-Authorization`. Registry calls the dedicated central
AIIP-to-AKB resource endpoint with `AKB_AIIP_INGEST_SERVICE_TOKEN`; this token
must differ from `AKB_POLICY_SERVICE_TOKEN`. STRATOS verifies the actor's
active identity, membership, AIIP access, `aiip:ingest_own_document`, exact
registered source lineage, scope, policy, correlation id, and idempotency key.
AKB accepts only an exact confirmation and derives document owner,
assignments, `uploaded_by`, scope, parent, and policy from that confirmation.
Caller-supplied owner or arbitrary metadata is not part of this contract.
Generic external-document, version, and current-pointer write routes reject
`STRATOS_AIIP` and AIIP-governed lineage, so another valid AKB identity cannot
bypass the dedicated dual-identity and central-confirmation boundary.

A missing, stale, mismatched, or over-broad credential fails closed.
`akb:upload` deliberately does not imply `akb:assign_policy`. Because AKB has
no safe `POLICY_PENDING` read model, a denied resource registration aborts the
complete document or version write; no readable deferred record is created.
Child scope must equal the parent scope or be its active registered descendant.
AKB never creates a new governance scope as a side effect of an upload.

The same binding reference is inherited by extracted chunks, embeddings,
Qdrant payloads, OpenSearch payloads, RAG answers, citations, source-open tokens,
and controlled exports. Qdrant and OpenSearch retrieval bind an authorized
`document_id` to its current policy hash. A stale or missing hash is excluded.
Citation and source-open re-read Registry state before returning source bytes.
RAG authorization also binds every candidate to a currently `valid` immutable
`document_version_id`; archiving or superseding the version denies stale index
content immediately.

TLP:RED is not treated as a rank. It requires `recipient_set`, explicit
recipient subject ids, and an originator. Only an explicit recipient may read.

## AI And Export Obligations

The LLM Gateway receives the most restrictive handling class and the union of
obligations inherited from all selected chunks. Local providers may process up
to `RESTRICTED`. External providers reject:

- missing policy metadata;
- `RESTRICTED` content;
- `NO_EXTERNAL_AI`;
- `LOCAL_PROCESSING_ONLY`;
- classified or unknown policy input.

Export requires `akb:export`. `NO_EXPORT` is denied, and obligations such as
`WATERMARK` must be fulfilled rather than silently ignored. Prompts, answers,
document bodies, bearer tokens, and credentials are not logged.

The export bridge does not trust policy ids, hashes, or obligations posted by
the browser. It extracts every cited document/hash from the normalized report,
requests a fresh `rag.export` decision for each source, verifies the current
hash, unions authoritative obligations, and only then generates XLSX/PDF. The
assistant hides export formats when any source denies export. Metadata-only
reports without immutable cited source snapshots are view-only and also hide
export formats.

## Organization Audience Versus True Public

`handlingClass=PUBLIC` or an AKB legacy `classification=public` does not make a
document anonymous. Organization audience still requires OIDC, AKB capability,
scope, and source policy. True public additionally requires an unscoped
`audience.scopeType=public`, `PUBLIC_INFORMATION`, `AUDIT_ACCESS`, allowed
TLP/PAP and no export-prohibiting obligation, followed by an active central
`InformationPublication` and a fresh no-store public decision.

True public AKB delivery is an explicit lifecycle over one exact published
`document_version_id`. An interactive user must carry both
`akb:assign_policy` and `akb:publish_public` to publish in the governed version
scope; terminal revoke requires `akb:publish_public` in that scope and sends no
client-controlled scope in the central request. The verified bearer is sent to
`PUT /api/v1/documents/{document_id}/versions/{version_id}/publication`.
Service credentials, role names, legacy `classification=public`, and a bare
`PUBLIC` label cannot publish. The selected version must already be valid,
centrally registered, have exactly one matching source-file descriptor, and
carry a public-eligible binding whose canonical hash still matches.

Registry stores a strict immutable metadata snapshot and exact source
descriptor for that version. PostgreSQL constraints bind `source_version` to
`document_version_id`; a trigger prevents mutation of slug, snapshot, source,
governed-resource, policy, approval, and central-publication coordinates after
`PUBLISHED`. Revocation is terminal. A changed document or file must therefore
be published as a new immutable version.

Every anonymous metadata request and every source download independently calls
STRATOS `POST /api/v1/policy/public-decisions` with `public_read` or
`public_download`. AKB strictly validates the complete decision response,
rejects unknown fields, and compares the policy version, hash, and all returned
publication coordinates to its local immutable record. It fails closed on
outage, deny/revoke, unknown slug, stale binding/hash, source-version mismatch,
malformed response, or local snapshot/source tamper. Both boundaries send
`Cache-Control: no-store` and audit the decision id without recording storage
locations or content. Repeated anonymous outcomes are aggregated in
deterministic fixed windows with an occurrence count and last-seen timestamp,
then removed after the configured anonymous-public retention period.
Authenticated audit remains event-by-event and is outside that pruning rule.

The public metadata response is an exact allowlist: title, document type,
version label, validity/publish dates, an explicitly approved description, and
sanitized file name/MIME/size/SHA-256. It never contains storage URI, document
body, extracted text, chunks, embeddings, prompts, answers, or RAG output. The
storage URI is available only from an internal Registry resolver protected by
`AKL_PUBLIC_DELIVERY_INTERNAL_TOKEN`. The anonymous web download boundary uses
that resolver, verifies size and SHA-256 using a 64 KiB bounded-memory pass
before releasing any content, then streams the file descriptor as an
attachment without exposing the URI or internal token. It supports one byte
Range and a strong SHA-256 ETag. Per-client/public-slug and global rates plus
held-through-stream concurrency limits fail with `429`; the bounded global
limits remain authoritative even if a forwarded client address is spoofed.

The anonymous human route `/public/documents/{publicSlug}` is outside the
internal AKB AppShell and never loads or requires an OIDC session. It renders
only the same sanitized snapshot and a link to the verified source endpoint.
Dynamic rendering, explicit `no-store` response headers, restrictive browser
security headers, and a single generic unavailable state prevent stale or
diagnostic content from leaking when central verification fails.

## Integration Envelope

External upload accepts only `stratos-integration-envelope-1`. Its organization,
binding id/version/hash, classification, `sourceResource`, and exact scope must
equal the supplied policy and the currently registered source lineage. AIIP
preflight, immutable version creation, current-pointer reconciliation, and
idempotent replay each re-confirm that lineage centrally. The signed upload
token binds all confirmation coordinates through confirm. It is returned only
inside preflight `required_headers`. Binary upload authenticates with that token,
performs a bounded read, verifies the exact signed size and SHA-256, persists
the object, and only then issues a separately signed `upload_receipt`. Confirm
requires both opaque credentials and re-verifies the receipt against the exact
persisted session/object/file coordinates, so a later request cannot skip
binary persistence or replace the actor, parent, policy, scope, source version,
media type, correlation id, or idempotency key. Only allowlisted safe fields are
retained. Closed schemas reject unknown fields; the payload does not override
AKB authorization, assignment, ingestion, DLP, or audit behavior.
