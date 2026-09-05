# AKB Standalone And STRATOS Integration Security Guide

## Document control

| Field | Value |
| --- | --- |
| Status | Draft; current integrated boundary verified, standalone target incomplete |
| Evidence baseline | AKB `6405261f9279031bb090a85930fad61397fafe47`, 2026-08-26 |
| Owner | AKB security owner |
| Approvers | STRATOS security/integration owner, IAM owner, data owner |
| Classification | Internal - security architecture |

## Regime matrix

| Regime | Current support | Identity and policy authority | AKB behavior |
| --- | --- | --- | --- |
| Local development AKB | Supported for development | Mock/local or local Keycloak configuration | Never use as production evidence |
| Integrated AKB + STRATOS | Supported production regime | Keycloak identity, STRATOS access projection and Information Policy, Registry object/action authorization | Full governed document and optional read-only live-data integration |
| Autonomous production AKB | Not currently supported | Native equivalent is missing | Deployment must stop; mock auth, static claims and local broad roles are forbidden substitutes |
| STRATOS without AKB | Owned by STRATOS | STRATOS | AKB-dependent functions must be unavailable without degrading unrelated STRATOS business operations |

## Security ownership boundary

### AKB owns

- document records, immutable versions, attachments and source-object lineage;
- upload quarantine, malware gate, parsing/OCR/rendition and ingestion state;
- chunks, embeddings, Qdrant/OpenSearch index payloads and citations;
- document/action authorization enforcement in Registry;
- RAG evidence checks, conversation persistence and reauthorization;
- AKB session records and application audit events;
- controlled documentation packages and verified rule decisions.

### STRATOS owns in integrated mode

- central identity and active employment/application membership;
- fresh application capabilities, scopes and effective scopes;
- Information Policy bindings/decisions and governed-resource registration;
- Budget, ProjectFlow and ArchFlow business facts and source-side PEP;
- integration audit on its side of each boundary.

Neither side reads the other's database. Shared document content, chunks,
embeddings or answer caches are not replicated into source applications.

## Browser authentication and session

Production uses OIDC Authorization Code Flow with PKCE. On callback, AKB creates
a random opaque selector with at least 256 bits of entropy, stores only its hash
as the lookup key, and encrypts access/refresh tokens server-side with a key
outside Git and Compose.

The browser cookie is `HttpOnly`, `Secure`, `SameSite=Lax` and restricted to the
AKB path/domain. A normal login is a session cookie. Trusted-device mode is not
preselected and is bounded by 90 days absolute age, 30 days inactivity and a
maximum 15-minute interval between identity validations.

Every protected entry may perform a silent central SSO round trip. This does
not share an AKB cookie or token with another STRATOS application. It ensures
that switching central users replaces/revokes the former AKB browser session.

Cookie-authenticated state changes require exact origin evidence. Foreign or
missing origin evidence is rejected with a safe machine code before route
handling. Logout revokes the local session even when Keycloak is unavailable.

## Authorization chain

For a protected document action, all relevant checks must pass:

1. valid OIDC identity and active server session;
2. active central membership and AKB application access;
3. required operation-specific `akb:*` capability;
4. current scope/effective scope;
5. exact document/version state and classification;
6. current Information Policy binding/decision;
7. Registry action decision;
8. current source/citation reauthorization when content is opened.

Unknown, stale, inconsistent or unavailable projection/policy state denies the
request. Roles, prompt text, tags, browser headers and imported semantic
vocabulary cannot grant access.

The `recipient_set:employee-directives` scope is derived only for eligible
published internal directives and still requires `akb:read_document`, an
allowed classification and an organization-wide internal policy. It is not a
general `internal` bypass.

## Service identities

Use a separate confidential client for each trust purpose. Each boundary
requires:

- allowlisted `azp`/client ID and exact service-account subject;
- one expected audience for the target API;
- minimum role/capability and explicit route grant;
- credential stored in a protected secret mechanism and mounted read-only only
  to the caller that needs it;
- short token lifetime and rotation ownership;
- negative tests for wrong client, role, audience, subject and route.

Current examples include dedicated web-to-ingestion, ingestion-to-Registry,
RAG-to-Registry, RAG/ingestion-to-LLM, governance transport and Director
Copilot identities. Their literal current-site client names are compatibility
contracts, not permission to reuse one secret for another route.

The interactive user's token may be propagated only through an explicitly
designed actor channel and never reused as the service transport credential.

## Director Copilot integration

Director Copilot V2 uses contract `director-copilot-2` and revision-pinned
manifests for Budget, ProjectFlow and ArchFlow. Each source call has its own
target-specific token and fresh actor projection. The source applies its local
PEP; AKB then verifies schema, source version, candidate completeness, facts,
relationships, cursors and evidence before presentation.

Security invariants:

- a token with multiple or wrong audiences is rejected;
- unknown manifest revision/hash/fact/link/reason code is drift and fails
  closed;
- no relationship is inferred from names or embeddings;
- a ProjectFlow document link is reauthorized independently by AKB;
- incomplete pagination cannot become a count/rank result;
- `not_authorized`, `no_data`, `partial`, `conflict`, transport failure and
  policy denial remain distinguishable;
- document RAG never replaces unavailable live business data.

Enable the feature only after joint positive/negative acceptance against the
exact deployed source manifests.

## Document Intake and content security

1. Validate declared size and allowed type before content processing.
2. Store the upload only in quarantine with a pending scan state.
3. Stream bytes to the internal `clamd` `INSTREAM` endpoint.
4. Promote only an `OK` result and a durable object-storage write verified by
   exact size and SHA-256.
5. Keep `FOUND`, timeout and error unavailable; record only safe technical
   metadata and signature name where permitted.
6. Registry verifies the clean attestation; Ingestion verifies Registry state
   before reading.

Format validation, an Office rendition or successful parsing is not a malware
decision. The scanner has no public endpoint and no browser route.

## Storage, network and browser boundaries

- Use the native S3 API adapter. Do not replace it with a FUSE/rclone mount as
  the primary production implementation.
- S3, PostgreSQL, Qdrant, OpenSearch, `clamd`, LLM Gateway and internal APIs are
  private dependencies.
- Browser access terminates at the public AKB gateway/web BFF.
- Cross-host service traffic uses private DNS and HTTPS/mTLS according to the
  site decision. Raw container ports are not cross-host contracts.
- Restrict egress from ingestion and source-fetching functions to approved
  endpoints. Official public-source discovery uses allowlists and SSRF-safe
  resolution.
- Validate request/upload limits and trusted proxy hops at the gateway and
  application boundaries.

## Prompt injection and answer safety

Retrieved document text is evidence, not an instruction to the system. The
assistant must not let source content change tools, capabilities, scopes,
policy, citation rules or output safety. Deterministic routing and evidence
gates precede LLM composition. Unsupported recommendations, causal claims and
scenario calculations are not converted into facts by model confidence.

## Logging, telemetry and audit

Allowed operational data includes service/release ID, event type, time,
duration, safe status/reason code, counts and anonymized request/correlation
IDs. Do not log/export:

- access/refresh tokens, client secrets, private keys or cookie values;
- encrypted token payloads or session selector hashes;
- document bodies or full citation passages;
- prompts, answers or RAG context;
- raw SQL or authorization headers;
- signed source URLs or sensitive query parameters.

OTLP processing must remove these fields before storage. Audit retention and
access are separate from application logs.

## Required fail-closed behavior

| Failure | Required result |
| --- | --- |
| Keycloak unavailable after validation expires | New identity-dependent access denied; local logout still works |
| Access projection or policy unavailable | Protected operation denied; no static fallback |
| Registry unavailable | No document mutation, citation opening or RAG authorization |
| S3 unavailable | Upload not confirmed; source not served from an unverified copy |
| Malware scanner unavailable | Upload remains pending/rejected |
| Qdrant/OpenSearch unavailable | Retrieval degraded/unavailable; no stale unauthorized chunk answer |
| Model/embedding unavailable | Explicit unavailable/incomplete state; no unapproved provider swap |
| STRATOS tool unavailable/drifted | Explicit live-source failure; no document replacement |
| Incomplete/changed cursor chain | No count/rank decision |
| Unknown controlled-rule revision or conflict | `no_data`/`conflict`; no computed replacement value |

## Production standalone gap

Before autonomous AKB can be approved, it needs at least:

1. a native active-user/application membership source;
2. a canonical capability/scope/effective-scope projection;
3. an Information Policy authority and decision contract;
4. service-client/audience/route-grant administration;
5. governed-resource registration and reconciliation;
6. bootstrap/recovery administration without a hidden permanent superuser;
7. positive and negative conformance tests equal to the integrated boundary;
8. outage and DR behavior that stays fail closed.

Until those controls exist, `AKL_AUTH_MODE=mock`, local roles and disabled
callbacks are development tools only.

## Related evidence

- `docs/security.md`
- `docs/security/access-information-policy-v2.md`
- `docs/security/stratos-identity-access-management.md`
- `docs/adr/0014-server-side-browser-sessions.md`
- `docs/integration/AKB_DOCUMENT_INTAKE_V1.md`
- `docs/integration/DIRECTOR_COPILOT_V2_IMPLEMENTATION.md`
