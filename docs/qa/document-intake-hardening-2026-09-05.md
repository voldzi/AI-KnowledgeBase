# Document intake hardening — validation, 2026-09-05

## Scope and state

Local working branch: `codex/document-intake-hardening`, based on
`398aec0593c34bbe8dc1d65423c280d483198ded`. This is an uncommitted implementation
increment, not a deployed release. The initial working tree was clean. The
baseline check passed against the stored `origin/main`; fetching Gitea failed
because SSH credentials were rejected. Current remote-main freshness is
therefore not independently established. Reconcile it before preparing a PR.

The increment strengthens preflight/content authorization, removes old binary
aliases, preserves canonical Budget files and original scan evidence on local
replay, rejects invalid scanner VERSION responses, and displays authoritative
policy context in the document detail and version-upload UI. The corresponding
API contract and clean-target handoff are updated together.

## Completed validation

| Check | Result and practical boundary |
| --- | --- |
| Full web unit suite (`node --conditions=react-server --import tsx --test --test-reporter=dot tests/*.test.ts`) | Passed. Includes local simulated services; this is not live STRATOS acceptance. |
| Full Registry suite (`../../.venv/bin/python -m pytest -q`) | 378 passed, 1 skipped at the full-suite checkpoint. Subsequent targeted tests cover the added OpenAPI and central-conflict regression. The skipped PostgreSQL migration fixture requires a dedicated destructive-test database; no migration is introduced by this increment. |
| Final focused intake authorization | Registry 32 passed; web intake 15 and CSRF 5 passed. Real Registry HTTP adapter maps central replay HTTP 409 to existing fail-closed 503. No database table changes; web reads no body and starts no intake/scanner pipeline on denial. |
| Budget immutable replay tests | Actual BFF confirm handler, signed tokens/receipts and local temporary files; external HTTP is simulated. Original file hash, policy, URI namespace and scan evidence are checked. Missing/tampered originals and inappropriate URIs fail. |
| Scanner tests | 8 passed, using a local simulated scanner. Invalid version/error replies cannot produce healthy readiness or clean scan metadata. No claim of live signature freshness or live EICAR acceptance. |
| Policy display tests | 5 passed, including unspecified TLP and invalid RED recipients. Display hints do not replace server enforcement. |
| Type checking | Passed after removing stale generated type-cache references to deleted routes and regenerating Next route types. |
| Browser checks | DW-02, DW-03 and DW-06A: 3 passed in Chromium against local mock mode. Covers creation, upload selection and document layout at 1440×1000 and 390×844. Initial launch was blocked by a missing test browser; a temporary browser installation resolved it. |
| OpenAPI/skeleton | Generator consistency, JSON validity and repository skeleton passed. Service OpenAPI parity checks passed. Budget parser/fixture/contract tests: 12 passed. The actual canonical intake response also passed JSON-schema validation, including file hash and scan metadata. |
| Whitespace | `git diff --check` passed. |

The document screenshot was visually inspected. Its test data exercises the
unavailable-policy warning; it is not proof of every TLP value, real identity
projection, every screen, keyboard accessibility or measured UI performance.

## Local image builds

All three affected service images were built successfully with the actual
Dockerfiles and configured build contexts. These are local `linux/arm64`
validation images, not immutable production release candidates. A release must
use its exact verified SHA, required CI, deployment platform and release gates.

| Service | Dockerfile/context and build arguments | Local image identity |
| --- | --- | --- |
| web | `apps/web/Dockerfile`, repository root; `NEXT_PUBLIC_AKL_BASE_PATH=/akb`, `AKL_IMAGE_SERVICE=web` | `akl/web:intake-hardening-check`, `sha256:1a0634593a0b5a6d9824989887ba9b1a48f0c6b126210818ec0499a92ff0df90` |
| chat-web | Same Dockerfile/root; empty base path, `AKL_IMAGE_SERVICE=chat-web` | `akl/chat-web:intake-hardening-check`, `sha256:9b5eb13f37db9853c86c800d70df5fa099ca319a631b435652118f011afe0700` |
| registry-api | `services/registry-api/Dockerfile`, service directory as defined by production Compose; `SOURCE_DATE_EPOCH=1788595593` | `akl/registry-api:intake-hardening-check`, `sha256:9ebd024cf6c2907c3ff79bfc37afbb0f4707cc5fdcc3b24afb2e7e4b871beb4a` |

No images were pushed or deployed. Runtime changes affect web, chat-web and
registry-api. The OpenAPI generator is a non-runtime script; review any broader
service selection by release automation before promotion.

## Required before coordinated release

1. STRATOS must correct exact root/version registration replay. Its current
   central implementation rejects a root when its version already owns the
   original operation key. Do not change that signed key or synthesize current
   confirmations. See the [specific handoff](../integration/STRATOS_DOCUMENT_INTAKE_HANDOFF.md#blocking-central-replay-change).
2. Prove the complete Budget flow against real source authorization, central
   registration, storage, ClamAV, ingestion and citation opening. Include lost
   replies, a new session after confirmation, revoked actors, scope/policy
   changes, unrelated key collisions, malware and outages.
3. Coordinate server-side Budget credentials and the canonical PUT path in
   STRATOS. ProjectFlow/ArchFlow require their own approved implemented source
   profiles; their intake is not established by this Budget increment.
4. Retain redundant upload objects during the retry window. Durable expiration
   and reference-aware cleanup are still planned; no completed cleanup claim
   is made here.
5. Continue the broader [product plan](../ARCHITECTURE/document-intake-hardening-plan.md),
   including Chat history/sharing/export authorization, rendering performance,
   OCR review, classification controls, accessibility and animations.

Public health/readiness checks and mocked component tests do not close these
cross-application and product acceptance gates.
