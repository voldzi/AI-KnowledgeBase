# AKB Security

Use `docs/security/standalone-and-stratos-integration.md` for the portable
security and integration guide, including the explicit unsupported status of
autonomous production AKB, service identities, network flows and fail-closed
outage behavior.

AKB security is centralized in backend services. Browser clients and STRATOS
host applications do not make authorization decisions for AKB documents.

## Authentication

- Local development may use mock/dev auth.
- Production uses the explicitly approved OIDC issuer. The default
  `external_oidc` mode retains the existing Keycloak integration. The optional
  `managed` mode consumes STRATOS discovery only after explicit issuer approval;
  AKB never connects to LDAP or accepts directory passwords.
- Interactive OIDC login terminates in a server-side AKB session. The browser
  receives only an opaque 256-bit session selector in an `HttpOnly`, `Secure`,
  `SameSite=Lax` cookie scoped to the AKB base path. Access and refresh tokens
  are encrypted at rest on the server and are never stored in browser storage.
- Only the signature-verified access token determines persistence:
  `stratos_remember_device=true` and a valid `stratos_session_started_at`
  allow at most 30 days idle and 90 days from the central session start.
  AKB has no separate remember-device checkbox. A missing or invalid policy
  on an otherwise valid external identity permits only a session cookie,
  at most 8 hours idle and 24 hours absolute. Invalid token signature, issuer
  or audience rejects login, rather than enabling a shorter fallback login.
  Refresh, step-up `auth_time`, and entry into another application never extend
  an existing absolute deadline. Identity is revalidated on the next active
  request at most 15 minutes after its previous successful validation.
- Without an AKB session, a protected page starts one normal Authorization
  Code + PKCE redirect, without `prompt=login` or `max_age=0`. A valid central
  session in the same browser/profile avoids another password form. Existing
  AKB page-entry sessions use a silent central identity check. The short-lived
  30-second AKB-only synchronization marker is signed, `HttpOnly`, bound to one
  opaque server-session selector and used solely to complete this round trip. It is
  not an identity token. Failed callbacks and logout require explicit retry;
  there is no repeating automatic login loop. A successful central identity
  change replaces and revokes the previous AKB session in that browser. An
  expired or revoked session cannot be recreated by a late silent callback.
- Cookie-authenticated state-changing API requests (`POST`, `PUT`, `PATCH`,
  `DELETE`) require an exact `Origin` match with `AKL_WEB_PUBLIC_BASE_URL`.
  Browser form navigations that omit `Origin` are accepted only when both an
  exact-origin `Referer` and `Sec-Fetch-Site: same-origin` are present. A
  browser-managed opaque `Origin: null` is accepted only by the login or
  logout form when Fetch Metadata proves a same-origin top-level document
  navigation.
  Missing or foreign evidence fails with `SESSION_REQUEST_ORIGIN_FORBIDDEN`
  before route handling. Audience-bound bearer-only service integrations do
  not use the browser cookie and remain on their existing token boundary.
- Local session revocation does not depend on issuer availability. Logout
  then continues to its approved end-session endpoint when available.
  Revoking one AKB session does not prove immediate logout of every other
  application; that propagation needs joint acceptance. Selective device
  revocation remains local to AKB. A restored browser session cookie cannot
  override server expiry or revocation; closing a window is not logout.
  Current STRATOS capabilities, scopes and Information Policy are still
  evaluated on every relevant request and are not copied into the session as
  durable authority. See [central SSO and managed identity](security/managed-identity.md)
  and [ADR 0015](adr/0015-central-sso-and-managed-identity.md).
- Server-to-server calls use service tokens or OIDC client credentials.
- Service calls preserve `X-Request-ID` and `X-Correlation-ID`.
- Web-to-Governance calls use the internal
  `AKL_GOVERNANCE_SERVICE_TOKEN` solely as their transport identity. The
  verified interactive subject remains explicit in the governance request.
  The current person bearer is sent separately in the internal
  `X-STRATOS-Actor-Authorization` header and Governance forwards it only to
  Registry and RAG for their own OIDC, subject, capability, scope and
  Information Policy checks. It is never reused as the Governance service
  credential, exposed to the browser response, or written to logs. Missing or
  identical service/actor credentials fail closed.
- LLM Gateway calls use a separate audience-bound service credential. Ingestion
  presents `svc-ingestion`/`service_ingestion`; RAG presents
  `svc-rag`/`service_rag`; both target audience `llm-gateway-service`.
- Caller OIDC tokens prove identity but do not contain authoritative dynamic
  document permissions. AKB loads user access from STRATOS `/api/v1/auth/me`
  and Registry evaluates the current document action before issuing a
  short-lived proof bound to the exact actor, action, document/version,
  correlation id and idempotency key. Caller tokens are never reused as
  Ingestion, LLM Gateway, or ingestion-to-Registry credentials.
- The web backend uses the exact confidential transport
  `svc-akb-web-ingestion`/`service_akb_web_ingestion` for interactive Ingestion
  calls. It sends a Registry-issued proof and the bound subject; Ingestion
  confirms that proof through Registry with its own short-lived
  `svc-ingestion` bearer. The subject header becomes audit context only after
  exact proof confirmation and is never independently authoritative.
- RAG uses the separate internal client `akb-rag-service`, role `service_rag`,
  and audience `akl-api` for Registry calls. Its secret is mounted read-only
  only into RAG and is not shared with another service.
- A service role is not sufficient to establish machine identity. Registry and
  RAG require an allowlisted `azp`/`client_id` bound to the exact Keycloak
  `service-account-<client_id>` identity. Conflicting claims and untrusted
  service-looking tokens fail with 403. Registry then applies a per-client,
  default-deny route allowlist; `akb-rag-service` receives only `authz`,
  `audit`, and `idempotency`.
- `svc-ingestion` receives only `authz`, `audit`, `documents-read`, and the exact
  `ingestion-status` route. The latter reads authoritative attempt coordinates
  and can update job/status only for an already selected immutable version;
  `documents-read` returns only registered document/version metadata required
  to verify the immutable source.
- `svc-akb-web-ingestion` receives no Registry route grant. Ingestion Service
  accepts it only on the bounded job/read/cancel and web-transport readiness
  surface. A valid service token without a matching Registry proof is denied.
- RAG uses user audience `akl-api`. End-user routes reject service identities
  and bind the request subject to the verified user bearer.

The service-account names above describe the existing external OIDC runtime.
Managed mode currently specifies the three separate Director clients and the
Budget Controlled Rules reader only. The remaining worker identities require
an agreed contract before a full managed production cutover; unknown services
are denied, not mapped to a human user or given legacy credentials.

## Authorization

AKB accepts `stratos-access-1` and Information Policy
`information-policy-2.0.0`. Global STRATOS roles, static `stratos_access`
claims, top-level capability/scope claims, and client authorization headers do
not substitute for the current STRATOS access projection and an
operation-specific `akb:*` capability. Identity, membership, application
access, organization, capability, scope, audience, and policy binding must all
allow the operation. Projection or policy-decision unavailability fails closed.
Document and version records carry their immutable central governed-resource
coordinates. Runtime decisions use that concrete active scope; an IT scope
does not authorize Logistics and an archived version does not remain readable
from a stale vector entry.
The authenticated document detail renders the shared STRATOS information-policy
panel for the authoritative current version and a compact document-level parent
context. The UI accepts a policy only when its binding id, version and hash
coordinates are complete and consistent. It distinguishes a confirmed missing
publication from a publication status that the current user is not authorized
to inspect; an unknown status is never presented as proof that a version is not
public. This explanation is informational only and does not replace Registry or
central policy enforcement.
The detailed current contract is in
`docs/security/access-information-policy-v2.md`.

Registry API owns document authorization. RAG retrieval filters candidate
documents through Registry authorization before answer composition. If sources
are unauthorized or insufficient, the assistant returns a no-answer or handoff
state instead of inventing unsupported information.

The default active employee projection is deliberately narrower than general
organization access. STRATOS grants `akb:access`, `akb:chat`, and
`akb:read_document` in scopes `public` and
`recipient_set:employee-directives`. The recipient scope authorizes only exact
document versions referenced by a `valid` controlled package whose source type
is `internal_directive`, whose effective date has started, and whose package
metadata does not set `employee_access=false`. Registry additionally requires
an `INTERNAL` Information Policy with organization-wide audience, no explicit
recipients, no narrower scope IDs, no TLP/PAP, and document classification no
higher than `internal`. A matching scope therefore cannot expose an unrelated
internal document, a draft or future package, or a restricted/confidential
source. Direct source opening still requires `akb:read_document`; deterministic
chat rule resolution requires `akb:chat` and reauthorizes every package source.
The derived projection is evaluated from the fresh STRATOS access projection
and exact package membership. It is never inferred from a role, prompt, tag, or
client-supplied scope header in production.
Registry list/search and metadata counts use the same employee projection as
detail reads. Service identities do not receive this human employee exception.
An unrelated document sharing a policy does not inherit a package member's
access decision.

Within a workflow request only, repeated identical policy checks may reuse a
successful response keyed by the policy endpoint, credential hash, operation,
capability, scope and full binding/hash. This memo is discarded when the
request ends, never reused by another request, and never caches transport or
validation errors. A new request always obtains a fresh policy decision.

Director Copilot semantic resolution uses an immutable local SSP snapshot.
Only code-reviewed bindings can map an imported concept to a known STRATOS
source or metric. Imported labels, external APIs, prompts, browser context and
conversation state cannot create capabilities, scopes or policy decisions.
User questions are never sent to the public SSP endpoint. Audit records include
the semantic catalog version plus the local registry snapshot ID and digest,
not the prompt or imported definition text.

The STRATOS domain catalog is also non-authoritative for access: it declares
tool contracts, capabilities, scope types, fact types and permitted relation
strategies, but AKB still loads the actor's fresh STRATOS access projection and
every source applies its own PEP and Information Policy. Canonical relations
must be source-declared IDs. Names, embedding similarity, browser state and
LLM output cannot create a cross-application join.

Director Copilot V2 strengthens this boundary with a separate target-specific
client-credentials token for each source. AKB rejects a token containing more
than the one expected audience, obtains requested scopes only from the fresh
STRATOS access projection, and reauthorizes immediately before synthesis.
Runtime manifest drift, unknown fact/link/reason keys, changed access, invalid
policy lineage and unrecognized relationships fail closed. A ProjectFlow link
to `stratos:document:<id>` is not evidence of document access; AKB authorizes
that document independently before acknowledging the relation.

The same rule applies to ingestion and Intelligence. Every production job
create/read/retry/cancel is authorized with a short-lived Registry proof for
one immutable document version. Production Intelligence queries use a separate
proof over the exact current indexed document/version/policy-hash set. Static
service roles, `allowed_document_ids`, client-supplied policy hashes, and global
administrator-looking JWT claims do not establish that scope. The legacy global
job list, unscoped facet GET, and bulk reindex paths fail closed in production.
The full boundary and crash-recovery invariants are in ADR 0009.

Organization-visible and legacy `classification=public` documents remain
authenticated; they do not become anonymously readable. True public delivery
uses a separate immutable publication of one exact document version. Its
sanitized snapshot and exact source descriptor are frozen after `PUBLISHED`,
and the only later transition is terminal `REVOKED`. Only a locally
`PUBLISHED` record backed by the matching active central
`InformationPublication` is deliverable. Document-management authority cannot
bypass that lifecycle: a `DRAFT` or `PUBLISHED` publication blocks both version
archival and logical document deletion with `409
publication_lifecycle_active`. The publication must first be revoked through
the governed publication endpoint; only the resulting local `REVOKED` state
releases those operations.

The same distinction applies to official public-source collections. Their
public classification describes the source material, while the default
audience remains the authenticated STRATOS organization. Collection sync uses
code-reviewed HTTPS host allowlists, checked redirects, bounded file sizes,
file signatures and SHA-256 version identity. It never creates an anonymous
publication record. Details are in
`docs/ingestion/official-public-sources.md`.

For these strictly marked official references only, an active authenticated
employee with `akb:chat` and the `public` chat scope may perform `rag.query`
over an exact valid indexed version. This does not grant Registry document
reads, anonymous delivery, storage access, or access to any ordinary
organization-scoped content. An archived version, policy-hash mismatch,
incomplete marker, disabled identity/membership/application access or missing
capability is denied.

The synthetic authenticated scope `public` is also not an organization scope
or a shortcut to `document.read`. It permits only governed `rag.query` over an
exact active immutable public version after a fresh anonymous central
`public_read` ALLOW. That exact public-resource decision is authoritative and
is not reinterpreted by the unrelated generic scope PDP. Full Registry
document views remain unavailable to a public-only subject even if the subject
also presents `akb:read_document`. The bounded
`/documents/rag-metadata-summary` aggregate is the only document-metadata
exception: it applies the same `rag.query` decision as retrieval and returns
counts/buckets rather than document bodies or storage access.

Anonymous delivery is available through the human page
`/public/documents/{publicSlug}`, the web metadata/source endpoints under
`/api/public/documents/{publicSlug}`, and the Registry metadata endpoint
`/api/v1/public/documents/{public_slug}`. Every metadata read and source
download performs a fresh central `public_read` or `public_download` decision
and fails closed on deny, revoke, outage, mismatch, or integrity failure. All
public responses are `no-store`. Anonymous metadata never exposes an internal
source URI, document body, extracted text, chunks, embeddings, prompts,
answers, or RAG output. The source URI is available only to the token-protected
internal resolver; the public web source endpoint returns only bytes whose
length and SHA-256 match the immutable descriptor. Verification reads the file
in bounded 64 KiB chunks before any response body is released; delivery then
uses a streaming file descriptor and supports a single byte `Range`, strong
SHA-256 `ETag`, `If-None-Match`, and `If-Range` without buffering the file.

Anonymous page, metadata, and source requests share bounded in-process
availability controls: a fixed-window rate limit per HMAC-derived
client/public slug, a global fixed-window rate limit, and per-client plus
global concurrency limits. The source concurrency lease remains held until
the stream completes or is cancelled. Client attribution trusts only the
configured right-hand proxy chain; the conservative default treats all
requests as one client. The global limits cannot be bypassed by spoofing
`X-Forwarded-For`, and the client map has a hard size bound. Capacity denial is
`429` with `Retry-After`.
The directly reachable Registry anonymous metadata boundary and the
token-protected private source resolver have an independent, higher-capacity
`AKL_REGISTRY_PUBLIC_*` limiter, so bypassing the web path cannot bypass the
global central-decision work bound.

Anonymous Registry decision audits are aggregated by immutable publication,
version, policy, operation, outcome/reasons, and deterministic time window.
Each row exposes `occurrence_count` and `last_seen_at`; an opportunistic bounded
pruner removes only expired `anonymous:public` delivery events according to
`AKL_PUBLIC_AUDIT_RETENTION_DAYS`. Authenticated audit events are neither
aggregated nor removed by that pruner. See
`docs/security/access-information-policy-v2.md`,
`docs/api/registry-api.md`, and
`docs/adr/0007-immutable-public-document-delivery.md`.

STRATOS applications may pass business context, but AKB decides whether the
current user can pick, upload, view, ingest, or open cited sources.

AKB also owns the binary trust decision through Document Intake. Every
interactive, STRATOS-originated and controlled public-source upload is written
to quarantine before normal object storage. The exact signed content is checked
for declared-type consistency and streamed to private ClamAV. `FOUND`, scanner
error, timeout and invalid response fail closed. Only a clean result creates a
signed receipt; Registry binds that receipt to the immutable document/file
coordinates and Ingestion can require the resulting `clean` state before
opening the object. Source applications cannot assert this state themselves.
See ADR 0010.

AKB administrators may use the web UI role preview to test what selected user
types see. The preview is protected by the current OIDC session, stored in a
short-lived signed cookie, and only lowers or changes the effective AKB web
view after the server verifies that the real signed-in user has the current
`akb:manage_access` capability. A user without that capability cannot enable
the preview by editing browser state. The preview does not replace the
production STRATOS access projection.

The web shell filters navigation and Command Center actions by the effective
STRATOS projection to avoid inaccessible or irrelevant affordances. This is progressive
disclosure, not access control: direct page requests and every bridge/backend
operation remain independently authorized.

The Query Intelligence preview route stores only permission-scoped document
coordinates in a five-second in-process cache keyed by the complete access
context. OpenSearch requires the indexed SHA-256 authorization key derived from
the exact document id, document-version id, and current policy hash. One
bounded `terms` filter replaces per-document Boolean branches. Invalid or empty
coordinates become `match_none`. Executing an analyst search reloads current
Registry authorization, so result content never relies on the preview cache.

Retrieval Quality Lab uses the same identity boundary. Evaluation Service
validates the current OIDC token against issuer, audience and JWKS, requires a
current AKB capability from the STRATOS projection, and forwards the token to
RAG/Registry. Private
datasets and run reports are visible only to their owner or an administrator;
draft cases do not enter the production quality gate. A benchmark therefore
cannot grant access to a document that the caller cannot retrieve normally.

Chat response feedback is deliberately separate from conversation content.
Registry accepts only `helpful | not_helpful` and a bounded reason code; it
does not accept free text. Audit and telemetry therefore never contain the
prompt, response, citation text, or a user explanation. Historical cited
answers are reauthorized on each load. If current source access is absent, the
stored answer, citations, and structured artifacts are withheld and only a
content-free aggregate audit event is written.

Chat suggestion personalization does not read full thread details. Registry
derives a bounded profile from conversations owned by the current subject and
returns only source kind, known intent, time, bounded feedback and a one-way
normalized prompt fingerprint. Signals from shared conversations owned by
another subject are withheld. The web bridge then intersects candidates with
the current STRATOS access projection and validates each live-data question
through the pinned Director Copilot V2 planner. A stale profile, browser input
or suggested prompt cannot create a capability, scope or policy decision.

Federated ProjectFlow/Budget answers are stored without raw domain payloads,
access tokens, or access projections. Their bounded provenance is revalidated
against both the current STRATOS access projection and a fresh source-domain
response whenever the thread is reopened. If the source cannot be verified,
AKB fails closed and withholds the historical answer instead of treating an
outage as an authorization denial. A changed live-data `source_version` alone
does not revoke an otherwise authorized historical answer: AKB requires the
same source system, canonical item and policy hash under the current access
projection. A changed policy, missing item, missing capability or uncovered
scope still withholds the answer.

The chat may persist a bounded `ConversationQueryState` containing only query
semantics: selected source domains, metrics, period, operation, granularity,
narrowing entity IDs, filters and ordering. The server validates this browser-provided
state against a closed catalog and discards unknown fields. It never accepts
capabilities, requested authorization scopes, policy claims or identity data
from the state. Source scopes are rebuilt from the current verified STRATOS
access projection for every turn, and query-state entity IDs can only narrow a
source request.

Authorization coverage and requested result shape are evaluated separately.
An organization or portfolio scope may authorize a bounded item list, count or
ranking, but it does not force an aggregate response. AKB validates the entity
type returned by each live source and withholds a mismatched response instead
of exposing an aggregate under an item label or falling back to document RAG.

The Director Copilot V2 evidence gate runs after source authorization and
before synthesis. It verifies source revision and timestamps, candidate
completeness, item provenance, fact quality, manifest-declared relationships
and operation-specific guarantees. A count requires an explicitly complete
authorized result. A maximum or minimum additionally requires every candidate,
a numeric source-owned metric and comparable currencies. Failed evidence is
audited through bounded reason codes; document content, tokens and raw source
payloads are not added to the audit event.

Conversation focus is also fail-closed. AKB persists at most a bounded set of
canonical entity identifiers and automatically focuses only a single source
candidate or the winner of a complete ranking. A broad list cannot silently
narrow a later turn to the first page of results.

Temporal controlled-document rules are never authorized by a client-supplied
date, package id or scope. Registry first selects packages effective on
`valid_on`, then applies current document authorization to every exact package
member. RAG may propose a rule only from retrieved authorized chunks and every
proposal must cite a member version of the package. Only human-accepted or
human-edited, non-conflicting rules can become consumer eligible. A lower
authority rule is withheld when the same normative key exists in an effective
higher-authority source. Missing packages, conflicts, unknown fields and
authorization outages fail closed.

## Secrets

Secrets must not be committed to Git, documentation, package artifacts, shell
history, or CI logs. `.env.example` uses placeholders only.

GitHub Packages tokens, OIDC client secrets, session secrets, upload signing
secrets, database credentials, and storage credentials belong in host or CI
secret stores.

## Sensitive Data Handling

Technical logs and audit metadata must not contain:

- full document bodies,
- full prompts,
- full answers,
- bearer tokens,
- API keys,
- passwords,
- private keys,
- unnecessary personal data.

Allowed operational metadata includes ids, counts, hashes, latency, status
codes, error codes, request id, correlation id, and cited document ids.

## Browser Boundary

The browser uses AKB web/API bridge routes only. It must not call:

- object storage directly,
- Registry API directly from STRATOS host apps,
- Ingestion Service directly,
- Qdrant,
- LLM Gateway,
- Keycloak Admin API.

Source preview and document viewer flows use AKB-authorized endpoints and
short-lived signed source tokens where needed. Host STRATOS applications may
propagate the current OIDC bearer token to AKB bridge routes. The bridge uses it
only at a user-authority boundary such as Registry; it does not forward it to
Ingestion. Persistent service and storage credentials are never exposed to the
browser.

Office preview is an authorized derivative, not a second document authority.
The web bridge reloads the current document version and policy on every open,
requires a clean content-security result when scanning is mandatory, and sends
only immutable source coordinates to the rendition endpoint using the exact
web-to-ingestion service identity. The headless converter reads original
storage through a read-only mount and writes only to a separate disposable
rendition cache. Returned bytes must have a valid PDF signature and remain
private with `no-store`; source content is never written to application logs.

## Container Runtime Boundary

The production Registry, RAG, LLM Gateway and Governance containers run as the
unprivileged `akb` user. Their root filesystems are read-only, Linux
capabilities are dropped, `no-new-privileges` is enabled and the only generic
writable path is an in-memory `/tmp`. Runtime secrets remain read-only mounts
owned by the same numeric service identity. A service that needs durable state
must use its declared database, object-storage or named-volume boundary; it
must not write into the image filesystem.

All release-managed service images use the exact `AKL_IMAGE_TAG` selected by
the immutable release. Infrastructure images are pinned to an explicit
version rather than `latest`. These controls complement application authorization;
they do not replace capability, scope or Information Policy checks.

## Audit

Document approval is bound to an exact version and a snapshot of source files,
metadata, policy and active responsibilities. A new source or changed binding
requires fresh approval. The approver must be the assigned person or a verified
member of the assigned group, with current workflow-write and document-publish
authority. Service identities and the submitter of an explicit review cannot
approve it. Assignment is not an authorization grant. The document and exact
version policy are rechecked when deciding and publishing; publication cannot
be bypassed through generic task closure or document status patching.

Personal task/document lists filter by verified subject/group membership and
fresh document authorization before counting or pagination. `akb:read_document`
opens personal work only; `akb:manage_document` is needed for the team view.
Neither navigation visibility nor an assignment grants decision authority.
Exact-version fields and task actions retain their own policy checks.
Review comments
are authorized workflow data, not audit metadata. Audit events retain only
technical review/document/version/assignment coordinates and decision types;
they do not include comments, document content, session values or credentials.

AKB records audit events for document changes, workflow decisions, assistant
queries, answer/no-answer events, source opening, and citation opening. Audit
events carry correlation ids and avoid storing full prompt/answer/source text
by default.

Employee controlled-rule reads are written by Registry as
`controlled_rules.user_read`. The event records only the domain, requested
date, consumer-view flag, package/rule counts, and warning codes. The web BFF
does not need or receive a separate audit-write permission for this path.

Conversation deletion is a physical data operation. Only the owner may request
it interactively; the retention worker performs the same cascade after
`retention_until`. Messages, citations, answer metadata, and sharing grants are
removed transactionally. The remaining audit tombstone is content-free and is
itself removed after the separately configured deletion-audit retention period.

For service-written events, Registry always stores the verified caller subject
as `actor_id`; a payload actor is only `reported_actor_id` metadata, and the
server-derived `service_client_id` overwrites any supplied value. Idempotency
reserve and complete are likewise caller-bound. Cross-client namespaces are
denied except for explicitly configured least-privilege delegations.

Audit CSV export is generated in the browser only from events already returned
by the authorized Registry audit endpoint and filtered in the current view. It
does not add document bodies, prompts, answers or hidden metadata.

Assistant report export is separately enforced. The server reloads a
`rag.export` decision for every cited document, validates current policy hashes,
and aggregates obligations; browser-supplied policy metadata is never the
authorization source.

## Scanning

CI must include a secret scan (`gitleaks`) and stack-specific dependency scans
where practical. Critical findings block release until reviewed.

Detailed references:

- `docs/security/enterprise-security-model.md`
- `docs/security/registry-authz.md`
- `docs/security/stratos-identity-access-management.md`
- `docs/security/access-information-policy-v2.md`
- `docs/CONTRACTS/06_SECURITY_AUTHZ_MODEL.md`
