# AKB central SSO and optional managed identity

## Status and ownership

This is the AKB implementation and activation runbook for STRATOS
`docs/64_MULTI_SOURCE_IDENTITY.md` and `docs/65_CENTRAL_SSO.md`. It is not a
production deployment or a successful test of the target directory, IAM
mapper or browser. Local regression evidence and target acceptance must be
recorded separately.

Current local evidence: [central SSO verification](../qa/central-sso-managed-identity-verification.md).

| Mode | Behavior | Activation |
| --- | --- | --- |
| `external_oidc` (default) | Existing approved Keycloak issuer; central SSO and signed session policy | Joint IAM mapper and browser acceptance before promotion |
| `managed` (explicit opt-in) | STRATOS OIDC provider via discovery; no Keycloak role format or browser secret required | Separate approved issuer, client registrations and complete service-identity contract |

AKB does not change STRATOS, Keycloak, AD/LDAP, client registrations or active
production configuration as part of this implementation. AKB never receives
LDAP passwords or creates directory connectors. Separate hosts need approved
HTTPS connectivity and TLS trust, not a shared Docker network or STRATOS DB.

**Full managed cutover is not yet an accepted production operation.** The
provided contract defines browser clients, Director sources and the Budget
rules reader. It does not define the managed credentials needed by Ingestion,
Evaluation, Governance, LLM Gateway and RAG-to-Registry worker routes. Those
must be agreed and tested; unknown service tokens fail closed. Do not reuse a
human bearer or a Director token to work around this boundary.

## Browser lifecycle

1. Without an AKB BFF session, protected entry starts one standard
   Authorization Code + PKCE S256 redirect. Normal entry does not set
   `prompt=login` or `max_age=0`. Existing central SSO in the same browser and
   profile can finish without another password form.
2. AKB holds the verifier and state/nonce in scoped HttpOnly cookies, for at
   most ten minutes. Unlike the STRATOS frontend, this BFF does not require
   sessionStorage for the transaction. Missing/mismatched cookie state or nonce
   rejects the callback; unavailable cookies cannot be bypassed.
3. An approved discovery/JWKS endpoint verifies the access signature, issuer,
   expiry and audience. The ID token is verified independently for its client
   audience, nonce and matching subject. Browser parameters, userinfo, ID token
   fields and unsigned token-response fields cannot decide persistence.
4. AKB generates a random 256-bit selector. Registry stores its SHA-256 and
   encrypted token material, bound to subject, issuer, client and central
   session. The browser receives only an opaque `HttpOnly`, `Secure`,
   `SameSite=Lax` cookie at the app path, without a shared `Domain`.
5. Every relevant request still requires the current STRATOS access projection
   and Information Policy. Revalidate identity on the next active request
   within fifteen minutes, or earlier when access-token expiry requires it.
   Managed tokens last at most five minutes. Cached discovery/JWKS is not a
   cached authorization grant.
6. Refresh may advance idle expiry only within the existing absolute limit.
   Registry uses row locking and `expected_updated_at` compare-and-swap;
   an expired/revoked row or stale token rotation cannot be overwritten.
   Only concurrent in-flight refresh work is shared, not a resolved allow.
7. Logout first revokes the AKB row. Issuer outage cannot prevent local logout;
   failure to persist local revocation instead returns an error and keeps the
   cookie so the user can retry. Approved central end-session/revocation is
   attempted when available. Device and all-user AKB revocation remain local.
8. Silent synchronization of the same central identity updates the existing
   selector with compare-and-swap, so a concurrent logout still targets that
   row. It does not create another device session or extend the deadline.
9. Separate attempt/signed-out session cookies suppress automatic retry after
   errors or logout. The user may explicitly retry. A late silent callback
   cannot recreate a missing, expired or revoked prior BFF session.

Existing BFF page entry retains its short signed central-identity sync marker
for detecting an account switch. A changed central subject replaces and
revokes the prior browser session; it does not merge accounts by login/email.
Same-app RSC navigation and `router.refresh()` do not start that additional
top-level OIDC synchronization. They still resolve the opaque server session
and current access projection, including expiry, revocation and required
identity revalidation. Next.js removes internal Flight headers (including
`rsc`) before exposing `headers()` to server components; the guard therefore
uses the preserved same-origin Fetch Metadata, not the removed RSC flag.
These headers classify transport only and never grant access. The regression
test passes through Next.js's actual render request store. AKB retains `Referrer-Policy:
no-referrer`, so an absent `Referer` is expected for these background requests.
When present, `Referer` must point inside this application and `Origin` must
match its public origin. Full document navigation, including sibling-application
entry, and missing/foreign Fetch Metadata keep the central synchronization
guard. This prevents a successful mutation from being followed by an OIDC
redirect inside a background refresh without weakening session authorization.
Local logout does not prove immediate revocation of every other application's
session. Test the actual propagation with IAM.

## Central session policy

There is no AKB remember-device checkbox. Only these claims on a verified
**access token** can establish long-term trust:

- `stratos_remember_device`: exact boolean;
- `stratos_session_started_at`: positive safe integer Unix seconds, no more
  than 30 seconds in the future. Accepted clock skew is clamped to current BFF
  time for deadline calculation. The central start is immutable during refresh.

| Verified policy | Idle upper bound | Absolute upper bound | Cookie |
| --- | --- | --- | --- |
| `true` and valid central start | 30 days | 90 days from central start | Remaining lifetime only |
| `false` and valid central start | 8 hours | 24 hours from central start | Session-only |
| Missing/malformed policy on otherwise valid external token | 8 hours | 24 hours from a valid central start, otherwise BFF creation | Session-only |

Managed nonboolean remember claims are rejected on the identity boundary.
Invalid token signature, issuer, audience or identity always rejects login.
There is no shorter-session fallback for an invalid token.

The technical policy reasons are `CENTRAL_REMEMBER_DEVICE`,
`CENTRAL_BROWSER_SESSION`, `REMEMBER_CLAIM_MISSING`,
`REMEMBER_CLAIM_INVALID`, `SESSION_START_MISSING`, `SESSION_START_INVALID`.
They explain an already verified identity; they are not permissions.

`auth_time` records authentication/step-up, not a fresh central lifetime.
Entering AKB on day 60 leaves at most 30 days of an original 90-day session.
Refresh takes the minimum of the previous deadline and the newly evidenced
central limit. A later `true` cannot extend a previous short deadline. A
remember downgrade updates Registry and the cookie; an already expired
central/BFF session gets no replacement period.

A browser may restore a session-only cookie when restoring its windows.
Closing a window is not a security logout; server expiry and revocation remain
authoritative. An isolated PWA/profile may need its own first central login.
Do not copy tokens or widen cookie Domain to hide this isolation.

## Token and authorization boundaries

| Identity | Required managed claims |
| --- | --- |
| AKB / Chat user | Exact audiences `akl-api` and `stratos-access-api`; canonical UUID `sub`; `stratos_roles=["stratos_user"]`; `identity_source`; `identity_audience=employees|external`; boolean remember; no service claims |
| Director Budget | Exact audience `budget-api`; scope `director-copilot:read`; `stratos_service=true`; exact configured `client_id`; no human roles/identity/session-policy claims |
| Director ProjectFlow | Same service constraints, exact audience `projectflow-api`, separate client |
| Director ArchFlow | Same service constraints, exact audience `archflow-api`, separate client |
| Budget rules reader | Exact audience `akl-api`; scope `controlled-rules-read`; `stratos_service_roles=["service_budget_rules_read"]`; exact trusted client and only the `controlled-rules-read` route grant |

Managed access tokens require RS256, a bounded `kid`, valid `iat`/`exp` and a
lifetime no greater than 300 seconds. ID tokens have their own browser client
audience. Duplicate/extra audiences, wrong scopes, mixed user/service claims,
unknown issuers and unsigned tokens are rejected.

Projection remains current and subject-bound. A managed external audience may
not receive `recipient_set:employee-directives`, even if a malformed projection
offers it. Source identifiers do not create roles. Identical emails/logins from
two sources do not merge subjects. Directory disable/group-removal propagation
is a separate IAM SLA, not guaranteed by possession of a valid JWT.

The three Director clients are not Registry writers. In managed mode the BFF
uses `POST /api/v1/internal/director-copilot/audit`, authenticated by its internal
Registry HMAC boundary. The fixed bounded schema allows only V2 event type,
technical status/counts/reason codes and correlation/actor coordinates. It
accepts no document text or model output. External OIDC keeps its existing
audited path. The domain manifest and Controlled Rules contracts do not change.
Manifest cache entries and in-flight lookups are bound to the approved issuer
and the configured service clients; another identity configuration must fetch
and validate its own catalog.

## Configuration and secrets

Keep the existing `AKL_OIDC_ISSUER` and `AKL_IDENTITY_MODE=external_oidc` for
the Keycloak rollout. Coordinate installation of
`stratos-session-policy-mapper` for `akl-web` and `akb-chat-web` with IAM;
this does not modify service identities, audiences or grants. Without its
signed policy, otherwise valid external OIDC is short-session only.

For a separately approved managed target:

| Setting | Requirement |
| --- | --- |
| `AKL_IDENTITY_MODE` | `managed`, explicitly |
| `AKL_OIDC_ISSUER` | Exact approved HTTPS issuer without trailing slash |
| `AKL_MANAGED_IDENTITY_ISSUER` | Exact same issuer as explicit trust marker |
| `AKL_OIDC_AUDIENCE` | `akl-api` |
| `AKL_OIDC_JWKS_URL` | Registry/RAG managed mode obtains JWKS from discovery; external mode still validates its required explicit JWKS setting |
| `AKL_WEB_OIDC_CLIENT_ID`, `AKL_CHAT_WEB_OIDC_CLIENT_ID` | Different browser clients, normally `akl-web`, `akb-chat-web` |
| Browser redirect/logout settings | Exact registered HTTPS URI for each app; no wildcard |
| `AKL_WEB_STRATOS_AUTH_ME_URL`, `AKL_CHAT_WEB_STRATOS_AUTH_ME_URL` | Approved HTTPS projection endpoint for each BFF; no cached-allow fallback |
| `AKL_DIRECTOR_COPILOT_{BUDGET,PROJECTFLOW,ARCHFLOW}_CLIENT_ID` | Three different service clients, one audience each |
| Corresponding `..._CLIENT_SECRET_FILE` | Separate protected managed host credential files mounted read-only; no inline production secret |
| `AKL_REGISTRY_TRUSTED_SERVICE_CLIENT_IDS` | Include only approved service clients; rules reader is separate |
| `AKL_REGISTRY_SERVICE_CLIENT_ROUTE_GRANTS` | Rules client has only `controlled-rules-read` |

Managed browser exchange has `token_endpoint_auth_method=none`, code + PKCE
S256, scopes `openid profile email`. Legacy Keycloak browser and Director
secrets are not sent to the managed issuer. The three managed Director clients
use their own `client_secret_post` credentials. Do not change service token
issuers of unspecified workers while switching the browser configuration.

Use a different encryption key for each BFF:

```dotenv
AKL_WEB_SESSION_ENCRYPTION_KEY_SOURCE_FILE=/srv/akl/env/akb-web-session-encryption.key
AKL_CHAT_WEB_SESSION_ENCRYPTION_KEY_SOURCE_FILE=/srv/akl/env/akb-chat-session-encryption.key
AKL_WEB_SESSION_STORE_SECRET_SOURCE_FILE=/srv/akl/env/akb-web-session-store.secret
```

These are paths, not secret values. Provision independent random keys of at
least 32 bytes, owner-controlled mode `0600`, outside Git/Compose. The internal
store HMAC secret is shared only among trusted AKB web/Chat/Registry services,
not with STRATOS. Existing web session secrets also remain separate. Runtime
entrypoints copy required mounted files into private tmpfs for the unprivileged
process. Restart consumers after key rotation; undecryptable sessions fail
closed. Provision the new distinct Chat key before any candidate deployment.

Discovery is bounded (5 seconds / 64 KiB), no redirects. All returned identity
endpoints must remain HTTPS, at the approved origin and under its issuer path.
JWKS/discovery have bounded caches; unknown signing keys trigger a rate-bounded
refresh, not arbitrary URL fetching. Install approved CA trust using the
runtime trust store, never by disabling certificate/hostname validation.

## Read-only registration preflight

The following prepares a JSON proposal only, with all six clients disabled:

```sh
python3 scripts/managed_identity_preflight.py \
  --issuer https://sso.example.org/identity \
  --approved-issuer https://sso.example.org/identity \
  --web-base https://apps.example.org/akb \
  --chat-base https://chat.example.org
```

Replace example addresses only with approved target addresses. Add
`--check-discovery` for one public, TLS-verified GET and optionally
`--ca-file /operator/approved-ca.pem`. There is no token argument, registration
API call, secret creation, apply flag or deployment operation. Output includes
exact callback/logout proposals, protocol requirements and an activation hold.
Review existing client IDs/revisions with IAM before any independent apply;
never blindly replace or rotate an existing client from this proposal.

The tool does not prove token issuance, authorization, directory reachability,
refresh, logout or browser SSO. Its result is an input to joint preflight, not
permission to change production.

## Joint acceptance and rollout order

1. Review the exact AKB SHA, focused tests, full CI and production-image builds.
   Preserve the current issuer/env snapshot and rollback image; no ad-hoc
   `compose up` or skipped release gates.
2. Verify distinct BFF encryption files, internal session-store HMAC, database
   migration `0026_web_sessions`, TLS trust and safe proxy/APM logging.
3. For Keycloak, IAM verifies its actual version, installs/tests the mapper and
   confirms both browser registrations. Realm policy changes are separate IAM
   work; their impact is not limited to AKB.
4. For managed, agree the remaining worker/service credentials and audiences,
   then provision reviewed disabled client revisions and test the separate
   environment. Do not activate an incomplete managed installation.
5. Run the following matrix per issuer and per browser/profile. Keep only
   scenario, release, time, status, policy reason and anonymized correlation.
6. Obtain explicit joint approval, promote exactly the accepted SHA and verify
   health/readiness plus authorized narrow document/live-data flows. Keep the
   existing Director mode and manifest bundle unchanged.

| Scenario | Required outcome |
| --- | --- |
| First visit / Budget to AKB to standalone Chat | One central form where needed; no additional AKB checkbox; separate BFF cookies |
| Same-profile active SSO / isolated PWA | No repeat password with shared SSO; isolated first login allowed and documented |
| True / false / missing / malformed policy | 30d/90d or 8h/24h; no browser-authoritative persistence |
| Central session already 60 days old / new auth_time | At most 30 days left; no restarted absolute period |
| Refresh, downgrade, concurrent logout, stale CAS | No extended deadline, persistent upgrade or session resurrection |
| Foreign Origin, bad state/nonce/signature/issuer/audience | Rejected without credentials in the error; no redirect loop |
| Callback denial, issuer outage, absent cookies, offline | No automatic retry loop; explicit retry only |
| Device revocation / all-user revocation / key rotation | Old selectors fail; no restored browser/session cache bypass |
| Disabled account, removed group/grant, projection outage | Fresh authorization denies access; measure directory propagation separately |
| External person / colliding logins or emails | No employee-directive scope, no identity merge or cross-user data |
| Wrong Director audience/scope/client or rules grant | Denied; no extra Registry/document/admin permissions |
| Logout with issuer unavailable / Registry unavailable | Local revoke succeeds without issuer; DB failure is explicit and retryable |
| Proxy, app, audit, exporter on success and failure | No token, cookie, auth code/state, body, prompt, answer or quoted document |

Local tests use synthetic signed JWTs and mocked directory/projection
boundaries. They do not prove real directory disable, deployed mapper,
multi-browser/PWA SSO, real PostgreSQL concurrency or production behavior.
Record those target tests separately; do not label them passed from unit tests.

## Outages, rollback and audit

Identity transport or validation failure cannot fall back to static claims,
LDAP login, a weaker issuer or document RAG. Existing unexpired identity still
needs fresh projection/policy; once identity validation is due it cannot skip
the check. Technical discovery/JWKS caching does not authorize a request.

Rollback is a controlled return to the prior approved issuer, code and secret
snapshot after evaluating the mapper and central lifetime policy. No runtime
automatic issuer fallback exists. Sessions are issuer/client/subject-bound;
an undecryptable or incompatible session requires re-login, not email-based
migration. Restoring a database must not re-enable revoked session rows.

Application audit uses internal session identifiers, event type, time and
correlation metadata only. Authentication HTTP requests are excluded from
tracing; the exporters additionally strip unsafe URLs, headers, bodies and
raw exceptions. Infrastructure must independently verify reverse proxy,
error logs and SIEM. Do not use a production bearer as a log-test sentinel.
Do not print token payloads wholesale, cookies, selector hashes, encrypted
payloads or connection strings in a preflight report.

References: [OIDC ID token validation](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation),
[OIDC discovery](https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfig),
[ADR 0015](../adr/0015-central-sso-and-managed-identity.md).
