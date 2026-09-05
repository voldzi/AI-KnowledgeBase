# ADR 0015: Central SSO and optional managed identity

Status: accepted for implementation; production activation requires joint preflight.

## Context

AKB and its standalone Chat are separate browser clients in one STRATOS SSO
environment. A local remember-device choice and a deadline calculated when
entering each application would extend central trust unintentionally. The
optional STRATOS identity provider also uses explicit managed claims rather
than Keycloak-specific realm roles.

This decision refines the session-policy and browser-key portions of ADR 0014.
Its opaque server-side session and current authorization boundaries remain.

## Decision

1. Keep `external_oidc` and the approved Keycloak issuer as the default. Enable
   `managed` only with an exact approved HTTPS issuer and validated discovery.
   AKB is an OIDC consumer, never an LDAP client.
2. Validate access and ID tokens independently. Managed browser clients use
   code + PKCE S256 without a client secret. Do not send a legacy secret to a
   newly selected issuer.
3. Determine persistence only from verified access-token claims
   `stratos_remember_device` and `stratos_session_started_at`. Long sessions
   are bounded by 30 days idle / 90 days from central start; short sessions by
   8 hours idle / 24 hours. Refresh, application switches and `auth_time` cannot
   extend the prior deadline. Expired and revoked sessions cannot be revived.
4. Store only a selector hash and encrypted tokens server-side. AKB and Chat
   use separate encryption keys and host/path-scoped cookies. Share neither
   cookies nor browser secrets with STRATOS.
5. Start one normal redirect for a missing BFF session. Retain explicit retry
   after errors and logout. Fresh projection and Information Policy remain
   mandatory; successful SSO does not grant document or live-data access.
6. Use three independently scoped managed Director service clients. A separate
   Budget reader has only the Controlled Rules grant. Managed Director audit
   writes use the internal AKB BFF HMAC boundary, not broader domain tokens.
7. Reject unspecified managed worker identities. Complete those contracts and
   joint acceptance before changing a whole production installation to managed.

## Consequences

- Central SSO can be adopted with the existing Keycloak issuer independently
  of a later managed migration. The IAM mapper is a separate controlled change.
- Missing central policy can shorten an existing session or require re-login;
  it never grants another 90-day period.
- Concurrent session updates use compare-and-swap and row locking. Losing a
  refresh/logout race cannot restore old token material.
- AKB stores PKCE/state in short-lived HttpOnly cookies, not sessionStorage.
  Browser cookies must be available; a missing state cookie rejects callback.
- Shared SSO is verified per browser/profile. An isolated PWA may need its
  own first login. Closing a browser window is not guaranteed logout.
- Protocol changes and new internal request schemas are part of the root
  OpenAPI index. Application/IAM/proxy tests are separate acceptance evidence.

Implementation and operational checks: [identity runbook](../security/managed-identity.md).
