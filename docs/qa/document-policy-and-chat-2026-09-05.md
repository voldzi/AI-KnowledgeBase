# Document profiles, extraction and Chat — local verification

Date: 2026-09-05. Working branch: `codex/document-intake-hardening`, based on
`398aec0593c34bbe8dc1d65423c280d483198ded`. This record covers the subsequent
profile/Chat implementation, not the earlier intake-only checkpoint. Work is
local and uncommitted. Required release and shared STRATOS acceptance are open.

## Implemented boundaries

- Mandatory explicit effective TLP across Registry document admission/use,
  web intake, ingestion, index writes and production retrieval. No approval
  without TLP and no missing-value conversion to CLEAR.
- Versioned five-family metadata catalog, closed root/version inputs, append-only
  root metadata revisions and immutable content/version snapshots. Current
  accountability is verified independently of historical authorship. The
  canonical metadata hashes do not redefine the Information Policy hash.
- Native, Budget and official-source inputs bind the exact version proposal to
  the signed upload and freshly check authority before file reads. A missing
  central admission confirmation is an unavailable state, never local approval.
- Explicit owner/author/gestor forms; responsibility transfer uses a current
  root revision. A record date is not normative effectivity. Draft contracts
  can be processed for review while remaining unavailable as current RAG sources.
- Native confirmation has durable database uniqueness for the verified session
  and deterministic ingestion recovery. Cleanup requires signed expiry evidence,
  complete references and a committed permanent database fence. It is disabled
  by default; no target-environment objects were deleted.
  S3 apply is explicitly unavailable: actual MinIO testing showed ignored
  conditional deletion. The guard rejects before Registry claim or storage action.
- Empty-environment admission readiness uses an authenticated, nonce-bound
  central confirmation of the exact catalog and both required capabilities.
  It never creates a test document or authorizes a particular upload.
- Current authorization protects persisted Chat history, mutations and exports;
  revoked sources remove prompts, titles and derived answers from the response.
  Stored content is not new application-level encrypted storage. Federated
  history remains a neutral refresh receipt pending the provider contract.
- Source-safe Markdown, response-specific citation selection, guarded stop/retry,
  and bounded transcript rendering. All loaded history remains in memory; this
  is not history API pagination or guaranteed cancellation of server work.
- One format capability catalog shared by admission and extraction. Office
  locators preserve sheet/row/slide identity and review warnings. Unsupported
  adapters have explicit unavailable intake states. Processing limits do not
  constitute an operating-system resource sandbox.

## Recorded verification checkpoints

| Check | Evidence and limits |
| --- | --- |
| Final web unit suite | 977 passed, 0 skipped, including the scanner simulator, actual BFF handlers and native confirmation recovery. |
| Final Registry suite | 685 passed, 0 skipped, with all PostgreSQL and actual MinIO fixtures enabled against disposable local resources. Includes schema placement/reference regression, metadata revocation, native races and cleanup fences. |
| Budget profile checkpoint | 63 focused web tests and 61 Registry cases passed: distinct actor/owner, exact signed profile, current authority before bytes, immutable recovery, draft exclusion from current RAG. |
| Public sources | 51 unit/client/BFF cases and 2 Chromium scenarios passed. Approved picker, unavailable/retry state, stale collection revision, strict preparation and current root conflicts. Desktop and 390px viewport; upstream responses are simulated. |
| Native forms | DW-02, DW-03 and DW-06A passed after required profile inputs and guarded submission. Authorship and lifecycle screenshots inspected. Includes local mock creation and 390px document detail, not a live STRATOS admission. |
| Final whole browser suite | All 45 Chromium scenarios passed, including Chat, document workbench, keyboard/focus, mobile navigation, approved sources and both native lost-confirmation-reply flows. Each recovery scenario proves one preflight, one binary PUT and two identical confirmations. This is not full contrast or assistive-technology certification. |
| History/export/extraction after profile cutover | 54 Registry history/exact-export and 9 extraction tests passed using explicit signed receipts and current atomic profile confirmations through the actual verifiers. |
| Temporal/review | 70 Registry cases passed for temporal selection, exact review workspace and document versions. Actual independent review is required for controlled publication. |
| Workflow/public delivery | 29 cases passed after explicit profile cutover, preserving review assignments, SLA/audit context, exact public policy and sanitized immutable publication. |
| Central readiness | 69 profile/readiness cases passed, including exact HTTP request/credential/nonce, rejected stale or mismatched catalog/identity, unsupported upstream and no document creation. This simulates STRATOS transport, not deployed upstream support. |
| PostgreSQL migration smoke | Separate disposable PostgreSQL 16 container: clean upgrade through 0029, actual external-document idempotency, publication immutability and audit aggregation passed. The 0018 migration ambiguity/rollback and concurrent-attempt test also passed with historical schema fixtures and current admitted profiles. Only randomized or explicitly dedicated test databases were created and removed. |
| Actual object-store safety | Disposable MinIO `RELEASE.2025-09-07T16-13-09Z`, image `sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e`: wrong IfMatch was ignored. Three backend tests now explicitly establish this unsupported capability and prove AKB refuses S3 apply before claim/delete while retaining both versioned and unversioned objects. This is evidence for the unavailable state, not successful S3 cleanup. |
| Other shared-contract consumers | LLM gateway 48, evaluation 26 and governance 20 tests passed. The existing CI selector chooses all runtime components for the shared contract and mixed service changes; no selector shortcut was introduced. |
| Contract/build inputs | TypeScript, semantic registry, Director Copilot contract, format/profile catalog parity, skeleton, OpenAPI regeneration and diff whitespace checks passed. Redocly 2.51.1: 0 errors, 483 recommended-rule warnings. Six production build-input tests passed, including the actual local Docker check. |
| Office and retrieval | Full ingestion checkpoint: 229 passed. Full RAG checkpoint: 328 passed. Chunk neighbors and locators remain exact and authorized. |
| Chat interaction | 7 browser scenarios and focused renderer controls passed; reproducible measured comparison is in [Chat performance](chat-history-performance-2026-09-05.md). |
| Real OCR stack | Newly built ingestion image: synthetic PNG/JPEG/WebP each returned 770 recognized characters with review required and no fictional PDF page. Five-page mixed PDF retained native pages 1, 3, 5 and OCR read only scanned pages 2, 4, with no duplicate/missing physical page. Network disabled. |

For 1,000 turns (2,000 messages), the controlled local Chat measurement reduced
history rendering from 472.5 to 36.3 ms and typing-to-two-animation-frame p95
from 229.1 to 16.3 ms; mounted DOM elements fell from 58,001 to 1,741. These
Chromium measurements compare the same fixture and shell, not production INP,
network latency, provider response time or every device.

Retained synthetic screenshots show [authorship](document-profile-ui-2026-09-05/document-profile-authorship.png)
and [contract fields](document-profile-ui-2026-09-05/document-profile-lifecycle.png).
The final field-alignment adjustment passed the three document creation/detail
desktop/mobile scenarios after the full 45-scenario run.

## Current local images

The following are actual service Dockerfile builds on local ARM64. They were not
pushed or deployed and are not immutable production release candidates.

| Service | Build context/arguments | Local Docker identity |
| --- | --- | --- |
| ingestion-service | `services/ingestion-service/Dockerfile`, service directory, `AKL_INSTALL_DOCLING=false` | `akl/ingestion-service:document-policy-check`, `sha256:a76d41adecda68fa19a282db6d4a604d4b0b091c7904e747e6f475f76e51b57a` |
| rag-retrieval-service | `services/rag-retrieval-service/Dockerfile`, service directory | `akl/rag-retrieval-service:document-policy-check`, `sha256:1d7766288fab24837bf65a12ee2054600b0a22e439b4d93e47bb472790fadd48` |
| llm-gateway-service | Existing service Dockerfile and service context | `akl/llm-gateway-service:document-policy-check`, `sha256:32152e9979d45a36d059ee01ae8d513cad5c980550b7c446865fe0db873fe596` |
| evaluation-service | Existing service Dockerfile and service context | `akl/evaluation-service:document-policy-check`, `sha256:bcd9f965741c9f9c2fda679dcbfa842809e76360c2dcc1d6dcd50a683cb61989` |
| governance-service | Existing service Dockerfile and service context | `akl/governance-service:document-policy-check`, `sha256:872bc0acda54708c1f181ef03261842a90ec54612735fcec59a6ca9e630b495f` |
| web | Repository-root context, `apps/web/Dockerfile`, `NEXT_PUBLIC_AKL_BASE_PATH=/akb`, `AKL_IMAGE_SERVICE=web` | `akl/web:document-policy-check`, `sha256:392f2ddd921d3fde3810f3b88afc4f908c348f200f4ac369cd11efc9e705cfea` |
| chat-web | Same Dockerfile/context, empty base path, `AKL_IMAGE_SERVICE=chat-web` | `akl/chat-web:document-policy-check`, `sha256:bfd1bd4aef354ace6ed60b6af0b1b5b84c6f068437ee4efd0d52146fe3881acd` |
| registry-api | Service Dockerfile/context, `SOURCE_DATE_EPOCH=1788595593` (verified base commit), final migrations and OpenAPI | `akl/registry-api:document-policy-check`, `sha256:57bcc7196482ea8c7caccb648ee4fa438e65b4e739194b2405194faef97faec0` |

The ingestion build retains pinned Debian snapshot packages. The snapshot's
`unpaper` package is explicitly `7.0.0-3+b2` on amd64 and `7.0.0-3+b3` on arm64;
the architecture correction does not replace the pin with an unbounded version.
All eight local images passed their actual Dockerfile builds. This is local
ARM64 build evidence; target-platform promotion remains a separate gate.

## Open acceptance work

1. Local suites, OpenAPI/skeleton and eight image builds are complete. Remote
   required CI/security, committed-history secret scanning and the target's
   integrated README source/assistant smoke checks were not run. They remain
   release gates; these local results do not stand in for them.
2. STRATOS must implement atomic metadata admission/revalidation and approve
   the profile catalog; fix exact Budget root/version replay; provide approved
   official-source collection projection and per-source preparation. Missing
   authority keeps intake unavailable.
3. Accept and enable ProjectFlow/ArchFlow source profiles and their actual
   integrations. Exercise native reconciliation and the disabled-by-default
   cleanup command under the target storage/credential/retention configuration.
   No process-local memory or user-filtered document list proves safe deletion.
   Native version replay is durable in Registry, but the browser retains its
   exact confirmation only until page reload/close. Root creation itself does
   not yet have idempotent recovery; complete that and reload-aware intake
   reconciliation before claiming recovery of the entire document journey.
   S3 cleanup additionally requires an approved immutable-version deletion
   contract and real backend acceptance; there is no configuration bypass.
4. Complete broad keyboard/focus/contrast/responsive/motion acceptance, document
   correction and review flows, and representative Czech family × format × source
   corpus/load acceptance. This record does not certify the entire application.
5. Resolve Gitea SSH authentication and verify current main before release. Run
   required CI/security and target-platform image builds; then coordinated
   deployment, source flow, backup/restore and operational acceptance on the
   exact immutable release SHA.

The [realization plan](../ARCHITECTURE/document-intake-hardening-plan.md) retains
the whole-product scope. A passing health response or a simulated authority
does not replace the shared acceptance gates.
