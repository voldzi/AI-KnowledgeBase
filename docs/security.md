# AKB Security

AKB security is centralized in backend services. Browser clients and STRATOS
host applications do not make authorization decisions for AKB documents.

## Authentication

- Local development may use mock/dev auth.
- Production and STRATOS integration use OIDC/SSO through the STRATOS realm.
- Server-to-server calls use service tokens or OIDC client credentials.
- Service calls preserve `X-Request-ID` and `X-Correlation-ID`.
- AIIP uses a dedicated service identity when possible:
  `client_id=aiip-akb-service`, `audience=akl-api`, and roles
  `stratos_service,document_manager`. Client secrets stay only in the host or
  CI secret store.

## Authorization

Registry API owns document authorization. RAG retrieval filters candidate
documents through Registry authorization before answer composition. If sources
are unauthorized or insufficient, the assistant returns a no-answer or handoff
state instead of inventing unsupported information.

STRATOS applications may pass business context, but AKB decides whether the
current user can pick, upload, view, ingest, or open cited sources.

AKB administrators may use the web UI role preview to test what selected user
types see. The preview is protected by the current OIDC session, stored in a
short-lived signed cookie, and only lowers or changes the effective AKB web
roles after the server verifies that the real signed-in user has `admin`. A
non-admin user cannot enable the preview by editing browser state. The preview
does not replace production role mapping in Keycloak or Registry.

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

## Audit

AKB records audit events for document changes, workflow decisions, assistant
queries, answer/no-answer events, source opening, and citation opening. Audit
events carry correlation ids and avoid storing full prompt/answer/source text
by default.

## Scanning

CI must include a secret scan (`gitleaks`) and stack-specific dependency scans
where practical. Critical findings block release until reviewed.

Detailed references:

- `docs/security/enterprise-security-model.md`
- `docs/security/registry-authz.md`
- `docs/security/stratos-identity-access-management.md`
- `docs/CONTRACTS/06_SECURITY_AUTHZ_MODEL.md`
