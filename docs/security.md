# AKB Security

AKB security is centralized in backend services. Browser clients and STRATOS
host applications do not make authorization decisions for AKB documents.

## Authentication

- Local development may use mock/dev auth.
- Production and STRATOS integration use OIDC/SSO through the STRATOS realm.
- Server-to-server calls use service tokens or OIDC client credentials.
- Service calls preserve `X-Request-ID` and `X-Correlation-ID`.
- LLM Gateway calls use a separate audience-bound service credential. Ingestion
  presents `svc-ingestion`/`service_ingestion`; RAG presents
  `svc-rag`/`service_rag`; both target audience `llm-gateway-service`.
- Caller OIDC tokens prove identity but do not contain authoritative dynamic
  document permissions. AKB loads user access from STRATOS `/api/v1/auth/me`
  and Registry evaluates the current document action before issuing a
  short-lived proof bound to the exact actor, action, document/version,
  correlation id and idempotency key. Caller tokens are never reused as
  Ingestion, LLM Gateway, or ingestion-to-Registry credentials.
- A person submitting an AIIP idea may authorize only the first ingest of their
  own exact, centrally registered AIIP document version without receiving a
  general AKB ingest capability. Registry requires the matching AIIP external
  reference, own-scope owner, immutable parent lineage and uploader identity;
  other documents, users and ingestion actions remain under normal AKB
  capability and scope checks.
- The web backend uses the exact confidential transport
  `svc-akb-web-ingestion`/`service_akb_web_ingestion` for interactive Ingestion
  calls. It sends a Registry-issued proof and the bound subject; Ingestion
  confirms that proof through Registry with its own short-lived
  `svc-ingestion` bearer. The subject header becomes audit context only after
  exact proof confirmation and is never independently authoritative.
- AIIP document transport uses only `aiip-document-service`, realm role
  `service_aiip_document`, audience `akl-api`, and the `client_credentials`
  grant. Registry gives this client exactly `aiip-upload`. AI assistance uses
  the independent `aiip-service` identity with `service_aiip` and audience
  `akb-api`; it has no Registry route grant. The public AKB bridge rejects a
  client, role, audience, or service-account name from the other profile. AIIP
  never sends `X-AKL-*` and never calls LLM Gateway, RAG, Qdrant, or OpenSearch
  directly. Client secrets stay only in the host or CI secret store.
- RAG uses the separate internal client `akb-rag-service`, role `service_rag`,
  and audience `akl-api` for Registry calls. Its secret is mounted read-only
  only into RAG; the AIIP credential is not shared with RAG or Registry.
- A service role is not sufficient to establish machine identity. Registry and
  RAG require an allowlisted `azp`/`client_id` bound to the exact Keycloak
  `service-account-<client_id>` identity. Conflicting claims and untrusted
  service-looking tokens fail with 403. Registry then applies a per-client,
  default-deny route allowlist; `akb-rag-service` receives only `authz`,
  `audit`, and `idempotency`.
- `svc-ingestion` receives only `authz`, `audit`, `documents-read`, and the exact
  `ingestion-status` route. The latter reads authoritative attempt coordinates
  and can update job/status only for an already selected AIIP version;
  `documents-read` returns only registered document/version metadata required
  to verify the immutable source. `aiip-document-service` remains restricted
  to `aiip-upload` and can never be reused by the pipeline on generic Registry
  paths.
- `svc-akb-web-ingestion` receives no Registry route grant. Ingestion Service
  accepts it only on the bounded job/read/cancel and web-transport readiness
  surface. A valid service token without a matching Registry proof is denied.
- RAG separates user audience `akl-api` from AIIP service audience `akb-api`.
  Generic RAG and all other end-user routes reject service identities and bind
  the request subject to the verified user bearer. Only the two AIIP
  integration routes accept exact `aiip-service` with `service_aiip`,
  organization `org_stratos`, and classification `public` or `internal`.

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

The synthetic authenticated scope `public` is also not an organization scope
or a shortcut to `document.read`. It permits only governed `rag.query` over an
exact active immutable public version after a fresh anonymous central
`public_read` ALLOW. That exact public-resource decision is authoritative and
is not reinterpreted by the unrelated generic scope PDP. Full Registry
`/documents*` views remain unavailable to a public-only subject even if the
subject also presents `akb:read_document`.

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
ids and policy hashes in a five-second in-process cache keyed by the complete
access context. OpenSearch requires both the authorized document id and its
current policy hash. Executing an analyst search reloads current Registry
authorization, so result content never relies on the preview cache.

Retrieval Quality Lab uses the same identity boundary. Evaluation Service
validates the current OIDC token against issuer, audience and JWKS, requires a
current AKB capability from the STRATOS projection, and forwards the token to
RAG/Registry. Private
datasets and run reports are visible only to their owner or an administrator;
draft cases do not enter the production quality gate. A benchmark therefore
cannot grant access to a document that the caller cannot retrieve normally.

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

AIIP documents marked with `Tajné` in `metadata.aiip.sensitivity`,
`metadata.aiip.input_data_sensitivity`, or
`metadata.aiip.output_data_sensitivity` are rejected by the standard AKB
external document upsert until a separate classified boundary is explicitly
approved.

AIIP application API processing accepts only `public` and `internal`.
`restricted` and `confidential` requests are rejected at the web boundary
before RAG or model invocation. Duplicate retrieval also enforces `tenant_id`,
`external_system=STRATOS_AIIP`, the classification ceiling, and Registry
document authorization.

## Audit

AKB records audit events for document changes, workflow decisions, assistant
queries, answer/no-answer events, source opening, and citation opening. Audit
events carry correlation ids and avoid storing full prompt/answer/source text
by default.

Conversation deletion is a physical data operation. Only the owner may request
it interactively; the retention worker performs the same cascade after
`retention_until`. Messages, citations, answer metadata, and sharing grants are
removed transactionally. The remaining audit tombstone is content-free and is
itself removed after the separately configured deletion-audit retention period.

For service-written events, Registry always stores the verified caller subject
as `actor_id`; a payload actor is only `reported_actor_id` metadata, and the
server-derived `service_client_id` overwrites any supplied value. Idempotency
reserve and complete are likewise caller-bound. Cross-client namespaces are
denied except for the explicit `akb-rag-service=aiip-service` delegation used
by the AIIP bridge.

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
