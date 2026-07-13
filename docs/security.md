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
  and uses central policy decisions for delegated service calls. Caller tokens
  are never reused as LLM Gateway credentials. Ingestion may preserve the
  caller id only as `X-AKL-On-Behalf-Of` audit context.
- AIIP uses only the dedicated Keycloak service identity `aiip-service`, realm
  role `service_aiip`, audience `akb-api`, and the `client_credentials` grant.
  The public AKB bridge introspects this token and rejects any different client,
  role, or audience. AIIP never sends `X-AKL-*` and never calls LLM Gateway,
  RAG, Qdrant, or OpenSearch directly. Client secrets stay only in the host or
  CI secret store.
- RAG uses the separate internal client `akb-rag-service`, role `service_rag`,
  and audience `akl-api` for Registry calls. Its secret is mounted read-only
  only into RAG; the AIIP credential is not shared with RAG or Registry.

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
The detailed current contract is in
`docs/security/access-information-policy-v2.md`.

Registry API owns document authorization. RAG retrieval filters candidate
documents through Registry authorization before answer composition. If sources
are unauthorized or insufficient, the assistant returns a no-answer or handoff
state instead of inventing unsupported information.

AKB has no anonymous public-document endpoint. Organization-visible and
legacy `classification=public` documents remain authenticated. True public
delivery requires a separate immutable representation plus an active central
`InformationPublication` and per-request public decision; until implemented,
the absence of that route is the fail-closed control.

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
propagate the current OIDC bearer token to AKB bridge routes; AKB forwards that
token to backend services for authorization and never exposes persistent storage
credentials to the browser.

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
