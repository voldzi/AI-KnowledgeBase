# AKB G2/G3 Impact Report

> **HISTORICAL / SUPERSEDED — NOT CURRENT OPERATING GUIDANCE**
>
> This report preserves evidence from the 2026-07-12 G2/G3 checkpoint. Its
> implementation counts, migration baseline, remaining gates, and absence of
> anonymous public delivery no longer describe the current system. Current
> behavior is defined by `docs/security/access-information-policy-v2.md`,
> `docs/operations.md`, and
> `docs/adr/0007-immutable-public-document-delivery.md`, including migration
> `0015_document_publications` and immutable anonymous publication.

Date: 2026-07-12

## Status

AKB G2/G3 is implemented and verified locally. No production deployment, data
reset, reset rehearsal, or backup restore was performed as part of this work.
The AKB portion of G4 has passed in an isolated shared environment. Both G5
rehearsals, G6 isolated restore, and G7 remain coordinated STRATOS release
gates.

## Delivered

- `@voldzi/stratos-ui` is pinned to `0.3.32`.
- Accepted STRATOS schemas and unchanged conformance fixtures are vendored with
  deterministic digest verification.
- Registry enforces identity, membership, application access, capabilities,
  scopes, organization, policy audience, and TLP:RED explicit recipients.
- User access is loaded from the current STRATOS `/api/v1/auth/me` projection;
  static `stratos_access`/top-level claims and authorization headers are ignored
  in production.
- Service document and audit authorization is delegated to the central STRATOS
  policy decision endpoint with a dedicated runtime credential.
- Evaluation Service applies the same projection to Quality Lab admission and
  no longer grants access from static OIDC roles.
- Migration `0013_information_policy_v2` adds document/version binding snapshots.
- External and controlled-document upload validate policy before binary write
  and bind upload tokens to the policy hash.
- Ingestion propagates binding metadata into chunks, embedding requests,
  Qdrant, and OpenSearch.
- RAG filters stale vector hashes, returns binding-aware answers/citations, and
  forwards inherited obligations to the LLM Gateway.
- OpenSearch search/entity/relationship queries bind document ids to current
  policy hashes and post-filter returned evidence.
- Source-open, citation-open, and report export fail closed on stale or
  unsupported policy state.
- Authenticated document detail displays the shared STRATOS policy panel for
  the immutable current version plus its document-level parent context. Stale
  coordinates are not rendered, and publication status remains explicitly
  unknown when the caller cannot read the publication record.
- External AI rejects unbound, restricted, classified, unknown, or explicitly
  prohibited processing.
- `tools/reset_akb_epoch.py` provides dry-run inventory and a guarded apply path
  covering Registry/audit, object storage, Qdrant, OpenSearch, ingestion jobs,
  and evaluation data.

## Compatibility And Migration Impact

- Existing pre-policy documents remain readable only through the explicit
  legacy authorization path before G7. A STRATOS capability principal cannot
  search or open an unbound document.
- Every document entering the new epoch must have a valid V2 binding. Existing
  content must be reset/reimported or deliberately rebound and reingested.
- Policy relabeling invalidates old Qdrant/OpenSearch hits immediately. Current
  implementation conservatively excludes historical-version chunks whose hash
  differs from the current document binding.
- Legacy `AKL_*` technical prefixes and internal service ids are unchanged.
- The G7 Keycloak baseline proves identity only; it must not issue a static
  `stratos_access` mapper or assign legacy AKB roles to new-epoch users.

## Negative Coverage

Covered locally: classified upload, missing binding, unknown obligation,
unknown policy version, missing capability, inactive access, scope/audience
mismatch, TLP:RED recipient mismatch, stale Qdrant hash, stale OpenSearch hash,
global-admin bypass, external-AI denial, and source-token policy mismatch.
G4 follow-up coverage also includes immediate deny after AKB application
suspension, forged claim/header isolation, and fail-closed behavior when the
STRATOS projection is unavailable.

## G4 Shared Environment Evidence

The published G4 commit was exercised with a real STRATOS Keycloak realm,
authoritative `/api/v1/auth/me` projection, central Policy Registry and policy
decision endpoint, PostgreSQL Registry, ingestion, Qdrant, OpenSearch, RAG, and
a deterministic local mock LLM provider. The controlled-document flow passed
policy registration, workflow approval, version publication, ingestion into
both indexes, RAG citation generation, and citation source-open with an
unchanged binding id and policy hash. Missing policy, unknown obligation, and
stale candidate hash scenarios were denied.

The first shared run found that an authoritative scope serialized as
`organization:org_stratos` was accepted for global actions but rejected for
document actions. Registry now treats that scope as the explicit organization
equivalent of the legacy bare `organization` scope. A regression test covers
version creation with the central scope representation. The complete Registry
suite passes with 79 tests.

## Remaining Gates

1. G4: retain the shared AKB evidence and complete the remaining coordinated
   cross-application acceptance checks before declaring the gate closed.
2. G5: run `tools/reset_akb_epoch.py` twice against disposable G4 data and retain
   both reports proving zero old identifiers.
3. G6: restore an accepted backup into a separate environment and verify source,
   Registry, Qdrant/OpenSearch rebuild, retrieval, citation, and audit evidence.
4. G7: approve the new epoch, deploy coordinated versions, and run the guarded
   production reset. This report does not authorize G7.
