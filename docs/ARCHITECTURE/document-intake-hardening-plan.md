# Document Intake, TLP and Product Quality Plan

Aktualizace 6. 9. 2026: AKB implementovalo source preflight, společný binární příjem, confirm a status pro ProjectFlow/ArchFlow. Aktuální pokyn a kontrakty: [STRATOS source intake](../integration/STRATOS_SOURCE_DOCUMENT_INTAKE_V1.md). Následuje implementace autority/adaptérů na STRATOS a společná akceptace; příjem zůstává uzavřený. Starší položka „AKB musí dodat source OpenAPI“ je tímto nahrazena.

Updated 2026-09-05 after the product owner authorized implementation. The target
environment is clean and empty. Use one contract and a coordinated AKB/STRATOS
release, without historical-data migration or compatibility upload aliases.

Product decision updated on 2026-09-05: TLP is mandatory for every admitted AKB
document and version. The previously proposed "approved without TLP" exception
is removed. A missing value is an invalid/incomplete state, never an approved
classification or an implicit TLP:CLEAR. This requirement applies to all entry
paths, including official public sources and automated STRATOS imports. Runtime
enforcement is implemented in the working tree; joint acceptance remains required. See [ADR 0017](../adr/0017-mandatory-document-policy.md).

## Current implementation increment

Update 2026-09-06: [0.5.1 shared-stack acceptance](../qa/stratos-ui-051-acceptance-2026-09-06.md)
closes the original Budget return and AKB/Chat cookie-collision findings for the
measured scenarios. AKB consumes the verified 0.5.1 artifact, both surfaces have
app switchers, and live authority failure unmounts protected content. Real PF
grant revocation and AKB/Chat membership revocation passed; Chat-initiated global
logout reached all BFFs with standard freshness. Observed AKB delay was about
292 seconds, not an instant logout guarantee. Read-only probes preserve BFF idle
expiry. Budget organization/recipient_set audiences now pass schema/authorization
regressions and are built locally, preserving the financial source scope and PDP.
AKB has implemented PF/ArchFlow source preflight, confirm and status with the
shared binary intake and delivered exact connector/authority OpenAPI. The next
dependency is STRATOS source authority/adapters, followed by complete positive
document → Chat → citation acceptance. The global intake gate stays closed.

Joint local acceptance now runs as the persistent Docker Desktop project
`akb-stratos-test`; see the [runbook](../deployment/local-acceptance-docker-desktop.md)
and [live verification](../qa/local-docker-acceptance-2026-09-05.md). The
[suite acceptance matrix](../qa/stratos-suite-acceptance-2026-09-05.md) assigns
overall verification to AKB/Codex and covers one-login navigation plus every
document connector and live information provider. This is not yet a passed
whole-product acceptance. The local
STRATOS checkout implements the Budget root/version replay correction and
Budget atomic admission/revalidation; the earlier central replay finding below
must now be closed by joint positive intake acceptance. The catalog readiness
gate still rejects admission because other required adapters are incomplete.
The Budget organization/recipient_set restriction was removed in the 0.5.1
acceptance increment; real positive intake is still pending.
Successful OIDC login, healthy containers and negative admission tests do not
close these remaining application requirements.

The working branch now implements mandatory TLP through Registry admission,
activation, ingestion, index writes and production retrieval. It also implements
append-only root metadata revisions and immutable version snapshots, one
versioned five-family profile catalog, required native/Budget/public-source
inputs, and profile-aware forms. The current central admission confirmation is
required; a stored snapshot does not authorize future use. The dedicated intake
readiness gate now performs a fresh nonce-bound central check of the exact
catalog, approved profile revisions and atomic registration/revalidation support.
It remains unavailable while that STRATOS contract is missing; enabling the
verified central implementation requires no hardcoded AKB readiness switch.

The new upload form distinguishes owner, author/issuer, gestor and uploader. It
collects lifecycle/domain evidence before signing an upload and binds that exact
proposal to confirmation. Responsibility changes use a current-revision check
and a fresh root confirmation; old version provenance stays unchanged. Draft
contracts and event records must not invent normative effectivity.

Native confirmation now reserves the verified upload session transactionally
and reuses the exact version and deterministic ingestion job after a lost reply.
Reference-aware expiration cleanup has durable signed manifests, complete
reference checks and permanent database fences. It is an explicit bounded
operator command, disabled by default; no object deletion has been enabled or
performed in the target environment. See [cleanup operations](../OPERATIONS/intake-object-cleanup.md).
Actual disposable MinIO testing found that its unversioned DeleteObject ignores
IfMatch. S3 apply is therefore unavailable before any Registry claim or storage
mutation; local apply and reference inspection remain supported. Finish and
verify an immutable-object-version deletion contract before enabling S3 cleanup.
Native root-creation idempotency and recovery after page reload also remain
separate unfinished parts of the full intake journey.

Other completed local boundaries include temporal publication selection;
mandatory current policy for Chat history/export and exact citation opening;
safe Markdown with no automatic external images; response-specific sources,
stop/retry behavior and a measured 60-message render window. This is bounded
rendering, not history API pagination or proof of production interaction latency.

The shared format catalog drives admission hints and parser choices. Native
Office extraction preserves sheet/row/slide references, bounds decompression and
processing, and retains review warnings. PNG/JPEG/WebP use the actual OCR stack;
mixed PDF preserves original physical pages. Unsupported legacy DOC/RTF and
GIF/SVG intake is explicitly unavailable rather than silently accepted.

Official-source collection selection now uses a proposed authoritative STRATOS
projection and fresh per-source preparation. The AKB client, unavailable UI,
strict validation and contract exist; STRATOS d035bdb6 now implements the
central native/official capability. Its joint positive acceptance is pending. ProjectFlow/ArchFlow source integration and central
Budget root/version replay still require coordinated acceptance.

These are local, uncommitted changes. The earlier
[validation record](../qa/document-intake-hardening-2026-09-05.md) describes its
own earlier checkpoint. Current evidence and remaining acceptance work are
recorded in [the profile/Chat checkpoint](../qa/document-policy-and-chat-2026-09-05.md)
and [measured Chat rendering](../qa/chat-history-performance-2026-09-05.md).

### Earlier STRATOS replay defect — implementation delivered, joint test pending

The earlier central Budget registration rejected root-document reconfirmation
when the same logical operation's idempotency key already belongs to its
document version. This affects preflight, intake reauthorization and confirm
after an earlier successful confirmation. The local canonical-file recovery
is implemented. STRATOS d035bdb6 contains the central fix; complete replay
now requires joint positive acceptance against it.

STRATOS must permit exact root/version replay while preserving active source,
parent, scope, actor, inherited policy and immutable content checks, and return
both authoritative confirmations required by its upload consumer. AKB must not
change the signed operation key or manufacture a fresh root confirmation.
See the [handoff](../integration/STRATOS_DOCUMENT_INTAKE_HANDOFF.md). Joint
release requires a real central regression, not only mocked HTTP success.

## Next increments and dependencies

The [document-model readiness assessment](document-model-readiness-2026-09-05.md)
defines the pre-intake foundation for all organizational document families:
versioned metadata/provenance, type-specific lifecycle, format capabilities and
exact citations. Existing type enums and upload allowlists do not establish
end-to-end product support.

| Priority | Work | Completion evidence |
| --- | --- | --- |
| P0 | Enforce the mandatory AKB document policy and accountable ownership across every admission, version and activation path. | Missing/null TLP, missing accountable gestor and unresolved policy conflicts cannot be admitted or activated through UI, API, collectors or STRATOS imports. No "approved without TLP" exception; approved inheritance is traceable and revalidated. |
| P0 | STRATOS fixes exact root/version replay and jointly validates the Budget contract. | Repeat the original operation and repeat through a new upload session after version registration; both return the same canonical version and current authoritative confirmations. Unrelated key collisions still fail. |
| P0 | Complete metadata/provenance snapshots and time semantics before broad admission. | Future-effective V2 preserves today's V1 until its start; historical answers select the correct source; author/issuer history survives root metadata and gestor changes. |
| P1 | One versioned document-profile catalog and one format-capability contract shared by UI/API/adapters. | Each admitted document family has the correct required fields, workflow and lifecycle; accepted formats have a working selected parser, explicit quality handling and exact source/citation mapping. |
| P1 | STRATOS clients adopt canonical upload and current credentials; ProjectFlow/ArchFlow get explicit approved source profiles. | One exact implementation/OpenAPI/client mapping and end-to-end success and denial results per application. |
| P1 | Governed classification proposal/change UI and complete TLP inheritance/conflict handling. | Every admitted document has approved effective TLP, classification and audience. Changes of TLP, audience or originator require the correct policy authority; an unresolved value blocks completion. |
| P1 | Durable session reconciliation and expiration cleanup of unreferenced uploads. | Lost replies and expired sessions recover; referenced originals survive cleanup; redundant expired objects are reclaimed. |
| P1 | Chat history/sharing and report-export authorization findings from the product audit. | Current access and exact source policy apply consistently to all history mutations, sharing and export. |
| P1 | Chat Markdown external-content boundary. | Generated/document content cannot trigger unapproved browser network requests. |
| P2 | Chat cancellation/streaming, transcript rendering, citation selection, history retry/pagination, viewer efficiency. | Measured interaction performance and long-conversation acceptance. |
| P2 | OCR/extraction quality and review editing; source freshness. | Expert-reviewed fixtures and visible, accurate quality states. |
| P2 | Accessibility, responsive layouts and reduced-motion-aware animations. | Authenticated visual and keyboard acceptance on representative desktop/mobile environments plus measured performance. |

The TLP UI requires an explicit proposal for creation and displays current
authoritative rules for reading and subsequent versions. Automatic content
classification and the full policy-change editor remain separate work.
The broad UI audit also requires authenticated browser access and actual
performance measurements before it can be closed.

## Ordered AKB implementation packages

This is the executable sequence for AKB, incorporating the complete document
model, mandatory TLP and the original whole-product/Chat audit. The earlier
intake increment remains local and uncommitted; the table below defines the full acceptance scope. Implemented local portions
do not close unfinished package-level acceptance. Each package must deliver implementation, matching
contracts/documentation and focused evidence before its completion is recorded.

| Order | AKB work package | Completion evidence | STRATOS dependency |
| --- | --- | --- | --- |
| AKB-01 | Finalize the document-admission profile, metadata snapshot model and versioned catalog boundaries. Preserve Document/Version/File and the existing central policy hash semantics. Separate document kind, file capabilities and source profile. | Reviewable schema/ADR/OpenAPI proposal, required-field matrix for every initial document family, explicit owner/issuer/uploader meanings and agreed cross-system fields. | Agree the central binding, identity lookup, inherited policy and new exchanged fields. AKB-internal modeling and fixtures can proceed immediately. |
| AKB-02 | Turn the reproduced future-publication case into a permanent regression and correct temporal selection/succession. Preserve the current source until the successor takes effect; separate capture time from verified legal effectivity. | Current, future, overlapping and non-overlapping versions; open end dates, historical queries, cancellation and date boundaries select the correct source without a gap. | No change to STRATOS required for the isolated Registry temporal correction. |
| AKB-03 | Implement the mandatory effective TLP and accountable ownership invariant in one authoritative document-admission policy, then use it at all write/intake/activation boundaries. Align collectors and UI with it. | Omitted/null/unknown TLP, inactive/missing gestor and unresolved source policy cannot pass UI, direct API, service import, public-source admission, version creation or retrieval activation. Approved inheritance and all valid TLP labels pass within their exact audience. | Approved source policies, verified active identities and contract alignment before enabling integrated intake. No global redefinition of nullable shared V2 resources. |
| AKB-04 | Add typed, versioned provenance/metadata snapshots and initial document/workflow profiles: knowledge note, controlled document/manual, meeting/project record, contract/addendum and verified public regulation. Implement review dates, responsibility transfer and explicit retention semantics. | Required fields and permitted transitions come from the same profile in UI/API. Changes preserve historical authorship and approved metadata; a simple note has a proportionate workflow; review overdue is distinct from invalid content. | Agree externally supplied profile fields and authoritative business-object references; local lifecycle implementation can proceed independently. |
| AKB-05 | Unify file capabilities and available adapters; close mixed-PDF/image OCR gaps, tabular completeness and source locator/rendition mapping. Bound decompression, processing time and memory. | Every advertised format has a real supported admission/extraction/preview/citation path or a clearly bounded declared capability. Representative and difficult files prove coverage, limitations and safe rejection; review-required output follows an explicit activation rule. | None for AKB parser/locator work; source clients consume the agreed capabilities when their integration contract is finalized. |
| AKB-06 | Finish durable intake reconciliation, reference-aware cleanup and source synchronization. Complete Budget recovery against real central confirmation, then implement the approved additional source profiles. | Lost replies, repeated confirm, fresh/expired sessions, source changes and retry after outage converge on the same canonical reference. Cleanup preserves referenced content; each enabled source has positive/negative end-to-end evidence. | Central root/version replay fix, updated server-side credentials and the actual ProjectFlow/ArchFlow source contracts. This blocks integrated completion, not unrelated AKB work. |
| AKB-07 | Close Chat security and correctness findings: equivalent current authorization after history mutations/sharing, protected prompt/title/derived content, export policy propagation and external Markdown content. Correct response-specific citation selection. | Revocation and policy changes cannot be bypassed via rename, pin, sharing, history, export or citation opening. An answer cannot cause unapproved external browser fetches; authorized exports and the selected answer's sources work. | Source authorization contracts remain authoritative; common rendering/export and Registry fixes can proceed locally. |
| AKB-08 | Complete Chat interaction and document UX: cancellation and safe incremental response presentation, bounded transcript work, real history retry/pagination, efficient viewer requests, extraction corrections and truthful processing/freshness states. Apply shared accessible dialogs and reduced-motion-aware animations. | Actual typing/scrolling/render/network measurements for long conversations and large documents; stop/retry preserve consistent state. Desktop/mobile, keyboard, focus, contrast and reduced-motion checks pass. Motion remains responsive and conveys useful state. | Shared STRATOS UI changes only where defects belong to that package; AKB must not fork a second incompatible design system. |
| AKB-09 | Execute the clean-environment release acceptance and operational handoff. Reconcile current remote main, finish required CI/security checks, build exact release images and perform the coordinated promotion. | Recorded document-family × format × source acceptance; quality and performance evidence on a defined corpus/load; backup/restore, indexing recovery, monitoring, ownership/review escalation and exact deployed SHA checks. | Compatible STRATOS release and joint acceptance. No intake enablement while central dependencies or mandatory safety gates remain unresolved. |

AKB-01 starts the shared-contract work. While exchanged fields are being
finalized, AKB-02 and the independent tests/internal validators from AKB-03 can
proceed. Chat security fixes from AKB-07 need not wait for OCR improvements.
The product owner explicitly authorizes proposing and documenting required new
STRATOS interfaces. Implement AKB clients with strict unavailable responses until
the corresponding authority exists; do not fabricate upstream success. Local
work must not be presented as blocked merely because STRATOS has a separate
unfinished package.

The temporal correction and strict admission/profile foundation are implemented.
Preserve the prepared intake work and finish each package
only after its own evidence is complete. Current remote
freshness remains unverified because Gitea SSH authentication failed; the stored
baseline is consistent. Resolve that before a release PR, not by discarding the
local changes.

## Scope and acceptance rules

- All five initial document families are in scope; exact subtypes are approved
  profiles, not an unlimited promise to parse every possible file or infer all
  business semantics. A new technical adapter may require code; adding a normal
  organizational subtype should not require changes across unrelated services.
- Trace document identity, immutable content, profile revision and approved
  policy through every relevant step. Verify current authorization separately
  from historical provenance. Do not rewrite the central `policy_hash` to cover
  unrelated metadata or replace active authority with a stored snapshot.
- Retain original files and exact citations. Model content/version history
  independently of deprecated API versions; the clean environment removes
  compatibility work, not the need for traceability or database schema control.
- Define a reproducible corpus with ordinary and difficult Czech organizational
  documents, explicit expected fields/citations and a representative workload.
  Measure retrieval/extraction correctness, missing content, source freshness,
  UI interaction latency and job recovery. Record actual values and limits;
  neither passing unit tests nor an attractive animation proves product quality.
- Release acceptance includes happy paths and denial/recovery. Outstanding
  mandatory TLP, ownership, temporal, authorization or source-integrity failures
  block initial user intake; visual polish cannot substitute for those checks.

## Verification gates

Run focused route and service tests for reader denial, changed identity,
revocation, current policy mismatch, upstream outage, exact replay and scanner
failure. Run relevant web tests/type checking, Registry tests and API/skeleton
checks. Build the affected production images using the configured Dockerfiles,
contexts and web base-path profiles before release.

Cross-application acceptance must cover authorized upload, clean attestation,
immutable reference, completed ingestion and authorized source/citation opening,
plus tampering, malware, scanner outage, revoked actor/scope and TLP restrictions.
No component test or public health result substitutes for this suite.
