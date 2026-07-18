# Enterprise Security Model

Phase 04 keeps security centralized. Clients do not hold privileged service credentials and do not run local knowledge stores.

## Authentication

Local development can use dev auth. Enterprise pilot and production must use OIDC/SSO.

Expected identity inputs:

- user subject id,
- roles,
- groups,
- access token,
- request id,
- correlation id.

Service-to-service calls must preserve correlation headers and must not log full user questions, answers, source text, secrets, or access tokens.

AKB web stores OIDC browser credentials only inside sealed HTTP-only cookies:
`akl_session` carries only compact session claims, while `akl_refresh` carries
the refresh token separately. The access token is not persisted in a browser
cookie; browser-facing BFF routes obtain it server-side from the sealed refresh
cookie before calling Registry or RAG. Splitting and minimizing the cookies keeps
the browser session below proxy and browser header limits and still prevents
JavaScript from reading credentials. The browser never receives a readable
refresh token and must not call Registry, RAG, or storage services directly.
AKB keeps the short-lived access session only in a bounded process-memory cache
addressed by a one-way hash of the refresh token. Concurrent BFF requests share
one refresh operation, including rotated refresh tokens; after a restart the
cache is safely reconstructed by refreshing from the sealed browser cookie.

The OIDC callback consumes the one-time authorization code server-side, sets the
sealed session cookie, and returns a short no-store page that uses
`location.replace()` to leave the callback URL. This keeps stale authorization
codes out of browser history and prevents repeated callback replay.

## Roles

Initial role model:

- authenticated OIDC user: can enter the Employee Chat Portal shell.
- `employee`: can open authorized sources when backend policy grants access.
- `reader`: can read allowed documents and ask sourced questions.
- `document_manager`: can create documents, versions, imports, and reindex jobs.
- `knowledge_admin`: can manage domains, metadata rules, and knowledge quality.
- `it_manager`: can access operational and managerial views.
- `auditor`: can inspect audit trails and governed evidence.
- `admin` / `global_admin`: can manage platform configuration.

## Authorization

Authorization is enforced in the backend, not in the browser.

The Employee Chat Portal is intentionally available to every authenticated OIDC
user. This only grants access to the chat shell. Document search, citation
opening, source preview, report rows, and downloads remain permission-scoped by
AKB Registry/RAG using the current user identity.

RAG retrieval filters chunks through Registry authorization before answer composition. If sources are denied or insufficient, the assistant must return a no-answer or handoff state instead of inventing an answer.

Local real RAG profile uses:

```text
AKL_RAG_AUTHZ_MODE=dev
```

Enterprise pilot should move to Registry/OIDC backed authorization before employee rollout.

## Classification

Documents use:

- `public`,
- `internal`,
- `restricted`,
- `confidential`.

Employee Chat Portal defaults to `classification_max=internal` until enterprise policy maps roles and groups to higher classifications.

## Assistant Audit Events

The assistant workflow emits these event types:

- `assistant.question_asked`
- `assistant.clarification_requested`
- `assistant.answer_returned`
- `assistant.no_answer_returned`
- `assistant.handoff_recommended`
- `assistant.citation_opened`

Employee Chat Portal source opening uses `GET /api/v1/assistant/citations/{chunk_id}/open` and audits `assistant.citation_opened`. Admin/technical citation viewer flows can still use the generic `citation.opened` event.

Audit metadata may include hashes, counts, ids, confidence, warnings, and cited document ids. It must not store full question or answer text by default.

## Production Hardening Backlog

- Replace dev auth with OIDC in pilot.
- Add service credentials and audience-bound tokens for backend calls.
- Add audit review dashboards for no-answer, handoff, and source-opening events.

## Implemented Chat Security Controls

- Assistant conversations are persisted only with explicit ownership, default
  180-day retention, archive support, and user/group sharing records.
- Every cited assistant message is reauthorized against the current immutable
  document-version policy when conversation history is returned. If any cited
  version is missing, unavailable, or no longer allowed, Registry returns the
  message as `source_access_changed` without its stored answer, citations, or
  structured metadata. Conversation ownership or sharing never preserves
  obsolete source access.
- Server-side web route guards redirect employee chat-only users away from
  knowledge-management and admin surfaces.
- The standalone `AKL_WEB_PROFILE=chat` instance applies an environment-level
  server allowlist before route execution. Direct management API requests
  return bounded `403` JSON even for privileged identities; management pages
  redirect to the chat shell.
- `chat.zeleznalady.cz` uses the dedicated public OIDC client
  `akb-chat-web`, Authorization Code + PKCE, a separate session secret and
  host-only `HttpOnly`, `Secure`, `SameSite=Lax` cookies.
- The service worker caches only versioned framework assets, icons, manifest
  and a content-free offline page. Auth, profile, chat, history, citations,
  documents, exports and every API request remain network-only and `no-store`.
- Mutating web BFF routes for document administration, governance, workflow
  actions, upload preflight, and admin access require management/admin roles.
- Regression tests cover restricted and confidential document filtering for
  reader metadata reports so chat inventory answers cannot count or list
  documents outside the caller's AKB permissions.
