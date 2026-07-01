# ADR 0004: Effect Server Boundary Pilot

Status: Accepted

## Context

AKB web contains server-side TypeScript bridge code that orchestrates OIDC
request context, Registry calls, STRATOS document contracts, source opening,
signed source downloads, retryable service boundaries, and audit events.

These flows have stronger correctness requirements than ordinary UI code:

- errors must keep stable status codes and `trace_id` compatibility,
- browser clients must not receive internal storage or service details,
- service-token and user-session paths must remain auditable,
- tests need deterministic control over request context, clients, and source
  download behavior.

Plain `try`/`catch` works, but it does not make dependencies, failure modes, or
resource boundaries explicit in TypeScript types.

## Decision

AKB may use the `effect` package in server-only TypeScript boundary code where
the flow coordinates multiple side effects or external services.

The initial pilot is the STRATOS `source-open` web bridge endpoint:

```text
POST /akb/api/stratos/documents/{documentId}/source-open?version_id={versionId}
```

The pilot uses Effect for:

- typed route failures,
- explicit route runtime dependencies,
- a small Next.js route runner that maps typed failures back to stable
  `NextResponse` payloads.

Effect is not adopted for React UI components, presentational shared
components, or simple route handlers by default.

## Compatibility

This decision does not change public API contracts, response status codes, JSON
error shapes, `trace_id`, signed download URLs, or STRATOS service-token
behavior.

Effect code must remain behind the Next.js server boundary and must not leak
Effect types into shared UI packages or external STRATOS integration contracts.

## Consequences

- Server-side orchestration can model expected failures explicitly.
- New Effect usage should start from a narrow pilot and preserve existing
  smoke/E2E tests.
- Future migration candidates are upload preflight/session, ingestion retry,
  citation open, and RAG bridge orchestration.
- Broad rewrites require a separate ADR after the pilot proves clearer tests
  and maintainability.
