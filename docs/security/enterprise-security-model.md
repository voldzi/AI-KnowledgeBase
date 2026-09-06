# Enterprise Security Model

Phase 04 keeps security centralized. Clients do not hold privileged service credentials and do not run local knowledge stores.

## Authentication

Local development can use dev auth. Enterprise pilot and production use the
shared STRATOS OIDC/SSO realm and dynamic access projection.

Expected identity inputs:

- user subject id,
- roles,
- groups,
- access token,
- request id,
- correlation id.

Service-to-service calls must preserve correlation headers and must not log full user questions, answers, source text, secrets, or access tokens.

AKB terminates OIDC Authorization Code + PKCE in a server-side session. The
browser receives only an opaque random selector in the profile-owned
`akb_platform_session` or `akb_chat_session` cookie;
the database stores only its one-way hash. Access and refresh tokens stay
server-side in an authenticated encrypted envelope and are never written to a
browser cookie, Web Storage or a client-readable response. The session is bound
to the internal user, issuer, client and Keycloak session.

Without trusted-device consent the browser receives a session cookie with no
`Max-Age` or `Expires`. Trusted-device sessions have a 90-day absolute limit,
expire after 30 days without activity and revalidate identity with Keycloak at
most 15 minutes after the previous successful check. Capability, scope and
Information Policy are loaded from the current STRATOS projection for each
relevant request and are not durable session authority. Cookie-authenticated
unsafe API methods require an exact same-origin request.

The browser never receives a readable refresh token and must not call Registry,
RAG or storage services directly. Concurrent BFF requests may share a bounded
in-process access-token refresh, but the durable authority remains the encrypted
server-side session. Restarting an application process does not require the
browser to hold or reconstruct any OIDC credential.

The OIDC callback consumes the one-time authorization code server-side, creates
the server-side session, sets the opaque cookie, and returns a short no-store page that uses
`location.replace()` to leave the callback URL. This keeps stale authorization
codes out of browser history and prevents repeated callback replay.

The two profiles also use separate OIDC state, PKCE, synchronization and logout
cookies. A visible-page monitor checks authority every 60 seconds and on return;
invalid authority unmounts protected UI. Probe reads do not extend BFF idle time.
See [ADR 0022](../adr/0022-profile-owned-browser-sessions.md).

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

Enterprise production uses Registry authorization backed by the current STRATOS
access projection. Static compatibility roles and browser-provided headers are
not authorization authorities.

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
- `assistant.conversation.deleted`
- `assistant.conversation.purged`

Employee Chat Portal source opening uses `GET /api/v1/assistant/citations/{chunk_id}/open` and audits `assistant.citation_opened`. Admin/technical citation viewer flows can still use the generic `citation.opened` event.

Audit metadata may include hashes, counts, ids, confidence, warnings, and cited document ids. It must not store full question or answer text by default.

## Production Hardening Backlog

- Add the authoritative STRATOS organization group directory before enabling new
  group shares.
- Expand audit review dashboards for no-answer, handoff, source-opening and
  cross-domain tool failures.
- Automate periodic rotation and expiry evidence for audience-bound service
  credentials without exposing secret values to application logs.

## Implemented Chat Security Controls

- Assistant conversations are persisted only with explicit ownership, default
  180-day retention, archive support, and user/group sharing records.
- Only the authenticated owner may permanently delete a conversation. Registry
  deletes the conversation, messages, and shares transactionally and retains
  no title, prompt, answer, citation, or shared participant identity in the
  deletion audit metadata. The standard audit envelope still identifies the
  deleting owner or the retention service. The content-free tombstone contains
  only the opaque
  conversation ID, reason, previous state, deletion time, retention deadline,
  and aggregate message/share counts.
- Expired conversations are hidden immediately and physically purged in bounded
  database batches. PostgreSQL workers use row locks with `SKIP LOCKED`, making
  concurrent purge cycles idempotent. A purge cycle also removes old deletion
  tombstones after their separate audit retention deadline.
- New person shares are selected from the active Keycloak directory and
  independently revalidated by Registry at write time. Arbitrary free-text
  identities and inactive accounts are rejected. New group shares remain
  fail-closed until the STRATOS organization group directory can verify them.
- Message authorship is derived by Registry from the authenticated or delegated
  subject. Browser and service payloads cannot forge author IDs or service
  labels; shared commenters retain their own author identity.
- Stored document citations, including report-row citations, are reauthorized
  against the current immutable document-version policy on Registry history
  responses and list items. A request-local cache avoids duplicate checks of the
  same version; no authorization is retained across requests. If any source is
  missing, unavailable, or no longer allowed, the whole conversation is returned
  without its title, prompts, answers, citations, feedback, suggestion signals
  or derived metadata. Structural messages remain `source_access_changed`.
  The model has no complete dependency graph: later prompts and uncited replies
  may quote the revoked source. Stored database content is not deleted by this
  read-time redaction. Conversation ownership or sharing never preserves
  obsolete source access. An authenticated employee with `akb:chat` and the
  public chat scope keeps RAG-only history access to an exact valid version of
  a curated official public reference. This exception never grants direct
  document/version reads, archived versions, untrusted sources, or internal
  organization content.
- Registry currently cannot verify fresh federated STRATOS source authority.
  Any conversation carrying a Director Copilot history envelope (including a
  malformed or null envelope) or a persisted federated source marker is therefore
  returned as a content-free refresh receipt to direct callers and the web BFF.
  Its metadata contains `history_live_source_refresh_required: true`; the UI
  asks for a new query against current authorized sources. Live authorized Chat
  remains available. This intentionally limits reopening and sharing stored
  federated content. Restoring it requires a Registry source verifier or an
  authenticated delegated transport with subject, source and policy binding;
  forwarding browser headers or conversation ownership is not such a proof.
- Stored Registry inventories, document lists and counts currently lack a
  complete source manifest: their rows can contain document titles, owners and
  descriptions with no citations. Their known tool/source/report markers also
  produce a content-free whole-conversation refresh receipt, with
  `history_source_refresh_required: true`. An empty citation list is not proof
  that an inventory contains no protected information. A new authorized query
  remains available; reopening needs complete document/query provenance.
- Web history GET, PATCH and share-replacement responses use the same fresh
  projection and source guard and are `private, no-store`. A projection failure
  hides every stored title and message; list responses also hide titles and
  suggestion signals. The list relies on Registry source checks instead of
  fetching each conversation again.
- Chat and citation-context Markdown render image descriptions as plain text and skip raw HTML.
  It never automatically loads Markdown image URLs, including same-origin URLs;
  external links require user navigation and use `noopener noreferrer`.
- PDF and XLSX report normalization preserves citation policy binding ID,
  version and hash. Every row must have complete source citations; each cited
  exact version requires current `rag.export` authorization and matching policy
  coordinates. `/authz/check` checks both document and version authority and
  returns their combined obligations. Export enforces `NO_EXPORT` and watermark
  obligations. Both formats include document/version/chunk and policy coordinates.
  Client-supplied cells and citations do not attest complete content provenance;
  server-owned artifacts with bound manifests remain an activation dependency of
  [ADR 0018](../adr/0018-federated-history-authority.md).
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
