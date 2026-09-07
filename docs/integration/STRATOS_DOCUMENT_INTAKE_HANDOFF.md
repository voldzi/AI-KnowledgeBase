# STRATOS handoff: AKB Document Intake V1

Aktualizace 7. 9. 2026: AKB přebírá lokální neměnný artefakt
`@voldzi/stratos-ui` 0.5.3 z předávacího commitu STRATOS `6170bbc`. Sdílený
Dialog obsluhuje Escape v capture fázi, takže jej dřívější hostitelský listener
nemůže spotřebovat před zavřením nejvyšší modalní vrstvy. Regresní scénář
zahrnuje zavření, odstranění dialogu z DOM, obnovení focusu, nové otevření,
celoobrazovkový režim a zavření přes Escape.

Aktualizace 7. 9. 2026: skutečný Budget & Contract průchod v izolované
`akb-stratos-test` sestavě prošel povinným TLP, organization i recipient-set
audience, ClamAV, nezávislým schválením, publikací/indexací, přesnou Chat
citací a odebráním přístupu ve stejné relaci. Přesný confirm replay používá
existující autoritativní Registry ingestion attempt. Aktivace verze se auditně
váže na potvrzeného lidského aktéra; profile-preserving změna assignmentů
nemění přijatou provenance a její změna selže uzavřeně. Aktivní access
projection 2.1.0 vyžaduje katalog `capabilities-1.12.1`; shadow 2.0.0 zůstává
na `capabilities-1.12.0`.

Aktualizace 6. 9. 2026: AKB implementovalo source preflight, společný binární příjem, confirm a status pro ProjectFlow/ArchFlow. Aktuální pokyn a kontrakty: [STRATOS source intake](../integration/STRATOS_SOURCE_DOCUMENT_INTAKE_V1.md). Následuje implementace autority/adaptérů na STRATOS a společná akceptace; příjem zůstává uzavřený. Starší položka „AKB musí dodat source OpenAPI“ je tímto nahrazena.

## Joint verification update — stratos-ui 0.5.1, 2026-09-06

STRATOS 2e15bba7 and the AKB/Chat changes now pass the original switcher and
concurrent-session scenarios in the shared Docker stack. See the
[current acceptance report](../qa/stratos-ui-051-acceptance-2026-09-06.md).
The package artifact and lockfile are committed together; both surfaces use
profile-owned cookies and a live authority monitor. Global logout was measured
with unchanged freshness; it is not immediate back-channel logout.

AKB accepts organization and explicit recipient_set Budget audiences while
preserving the financial source scope, exact policy hash, fresh actor/PDP,
central source registration and current profile validation. The joint local
acceptance now includes a real uploaded and indexed synthetic Budget document,
an exact citation and same-session revocation. The related contract is pinned
to capability catalog `capabilities-1.12.1`.

AKB has implemented the PF/ArchFlow source contract and runtime. STRATOS must
now implement the source authority and adapters from the linked source handoff.
STRATOS native/official central adapters exist; full positive intake and
Executive Center/history integration remain pending. Do not enable intake.

## Objective

Target decision, 2026-09-05: the product owner confirmed a clean, empty target
environment. Use one coordinated AKB/STRATOS contract with no historical-data
migration or compatibility upload aliases. This document separates implemented
AKB boundaries from client work and source profiles still requiring acceptance.

The product owner also requires explicit effective TLP on every admitted
document/version. There is no approved-without-TLP exception. This is a release
requirement. The current AKB working increment rejects missing effective TLP
across document admission and use; nullable shared schemas and display fallbacks
remain defensive readers. Joint acceptance is still pending. See
[ADR 0017](../adr/0017-mandatory-document-policy.md).

Budget, ProjectFlow, ArchFlow and other approved STRATOS applications
must use AKB as the only binary entry point for governed documents. A source
application remains the authority for its business action and local roles.
AKB remains the authority for document identity, binary integrity, malware
control, Information Policy, document lifecycle and ingestion.

No application should operate its own final document store or independently
declare a file clean. A local temporary attachment may exist only until AKB
returns a confirmed immutable document/version reference.

## Common flow

Each integration must perform the following sequence:

1. authorize the initiating action in the source application;
2. call its approved AKB preflight operation with the current actor and exact
   source resource lineage;
3. use the returned `upload_url`, which must be under
   `/api/document-intake/v1/sessions/{sessionId}/content`;
4. upload the exact signed MIME type, size and SHA-256;
5. receive `upload_receipt` only after AKB quarantine, file-signature checks
   and the configured ClamAV decision;
6. return the opaque token and receipt to the integration-specific confirm
   operation;
7. store only the returned AKB document ID, version ID and permitted deep
   links in the source application;
8. use AKB lifecycle/status operations for reconciliation and idempotent retry.

The receipt is opaque. Applications must not decode it, log it, persist it as a
business record or use it as an authorization token.

Budget binary PUT now requires the exact service `Authorization` header and,
for interactive mode, `X-STRATOS-Actor-Authorization` with the current person
bearer. The server must perform this transfer; do not expose the service bearer
to the browser. Preflight returns `required_authentication` with
`transport=server_to_server`, `service_bearer=true`, and `actor_bearer` matching
the signed mode. The descriptor contains no credentials. Historical batch mode
must omit the actor header and match its complete approved source lineage.

The upload token, source coordinates and the current identity/policy decision
are checked before reading the body. An expired/denied credential or changed
policy must cause an explicit failure; do not retry through an old URL.

## Identity and authorization

Do not add a portfolio-wide upload role to source-application users.

- A human is authorized by the source application's current capability and
  scope for the business object.
- The integration uses its exact allowlisted service identity and audience.
- Where the contract requires actor binding, the current person token is
  separate from the service token.
- Requested scopes can narrow an operation only.
- Prompt text, metadata, forwarded headers and a source application's local
  administrator role cannot create AKB authorization.
- Registry continues to require the applicable AKB capability, such as
  `akb:upload` or `akb:manage_document`, through the approved projection or
  delegated integration contract.

Document accountability has explicit responsibilities independent of authorship
and the initiating uploader:

| Responsibility | Required | Purpose |
| --- | --- | --- |
| Owner | Yes, an active internal person | Accountable organizational ownership, preserved as a current root metadata revision. |
| Gestor | Yes | Business correctness, metadata, classification proposal and lifecycle. |
| Approver | Conditional | Independent publication, classification, exception or domain-gate decision. |

One person may be owner and gestor when the approved policy allows it. Controlled
document publication requires an independent approver; other families follow
their explicitly approved profile and domain gates.
Applications may keep richer operational roles for finance, projects, needs or
ideas, but must not copy those roles into AKB document assignments.

## Application mapping

| Application | Local authority before intake | AKB integration behavior |
| --- | --- | --- |
| Budget | User may perform the relevant contract, budget or evidence action in the covered scope. | Use the Budget upload bridge for current and historical batches; preserve tenant, project, contract and batch lineage. |
| ProjectFlow | User may attach or publish project evidence for the covered project/portfolio. | Use the dedicated source-upload bridge for project/task/status_report with exact project lineage; store only AKB references after confirm. |
| ArchFlow | User may attach evidence to a need, assessment or handoff. | Use the dedicated source-upload bridge for a canonical need and current actor; other entity kinds require an explicit contract extension. |
| SecurityPreflight | User or service may create approved assessment evidence. | Use a dedicated exact source namespace and classification ceiling; findings do not grant document access. |
| AKB web | Current projection contains the required upload/manage capability. | Interactive upload uses the controlled-document preflight and the same canonical binary endpoint. |
| Official source collector | Manager approved the source collection and URL allowlist. | Downloaded bytes pass through the same intake core; a public origin does not bypass scanning. |

Implementation status: Budget, ProjectFlow and ArchFlow have explicit AKB
endpoints, exact service profiles and completed joint local intake acceptance.
SecurityPreflight remains a target profile without an implemented upload
endpoint. Never send its documents under a Budget source identity. Live Chat
federation remains a separate integration boundary.

The [document-model assessment](../ARCHITECTURE/document-model-readiness-2026-09-05.md)
also requires agreed versioned document profiles and truthful format capabilities
before broad admission. Author/issuer, importing subject and active internal
gestor are separate facts. Event dates, review dates, contractual/legal
effectivity and capture time are not interchangeable. Source clients must
provide the agreed metadata and preserve exact version provenance. The working
implementation now requires the closed root `document_profile` and version
`document_profile` inputs described below; it does not introduce a profile
catalog API or claim deployment/central approval.

## Required document-profile cutover

The binding input shapes are in
[`inputs.schema.json`](../../contracts/akb/document-profiles/v1/inputs.schema.json)
and the five local profile definitions in
[`catalog.json`](../../contracts/akb/document-profiles/v1/catalog.json). STRATOS
must explicitly approve the catalog revision and implement current atomic
admission authority. Existing payloads without profiles fail closed; there is
no compatibility alias or default authorship/gestor.

Budget preflight requires root `document_profile` (`profile`, `authorship`,
`provenance`, `accountability`) plus `document_version_profile` containing
`lifecycle` and `domain_evidence`. Budget contracts use profile `akb.contract`,
revision `1`; source record/resource and contractReference must match the
exact Budget envelope. The initiating person is `actor_subject_id`, matching
the envelope actor; `owner_actor_id` is rejected. The actual root owner is
`accountability.ownerSubjectId` and may differ from that person.

The web bridge obtains `metadataRevision` from the freshly confirmed Registry
root snapshot, verifies its hash and current revision, and returns/signs the
complete version proposal as `document_profile`, adding
`expected_root_metadata_revision`. Confirm returns that exact object unchanged.
Both binary PUT and confirm freshly authorize its current root before file
reads. On root/provenance/responsibility or policy change, prepare a new
session; do not patch the signed proposal or guess the current revision.

Direct Registry root/version producers use the same nested `document_profile`
input contracts. Content/source lineage and atomic admission proof come from
Registry's verified bytes, envelope and central authority, never client ALLOW.
Full Budget examples and field semantics are in the
[external-document contract](STRATOS_EXTERNAL_DOCUMENTS_API.md#povinné-profily-při-přípravě-a-potvrzení).
The existing central replay blocker below remains in force.

## Required client changes

For every existing application:

1. reject a preflight response whose `upload_url` is outside the configured AKB
   origin or canonical Document Intake path;
2. send the binary once with the exact required headers;
3. treat `FOUND`, scanner error, timeout and HTTP `5xx` as incomplete intake,
   never as a clean upload;
4. include the returned `upload_receipt` unchanged in confirm;
5. make confirm idempotent on the integration's canonical lineage and SHA-256;
6. distinguish `pending_scan`, blocked, unavailable and confirmed states in its
   local UI without exposing scanner internals;
7. delete any temporary local copy according to the application's approved
   retry policy after confirmation;
8. never expose the shared ClamAV host or port outside the server VLAN.

TLP must remain part of the full authoritative Information Policy. Every
admitted document/version requires an approved effective TLP value, accountable
internal gestor, classification, verified audience and type-appropriate
provenance/lifecycle metadata. A source may supply centrally approved inherited
rules with verifiable provenance; it must not guess a label from a filename or
silently default to TLP:CLEAR. If a source policy has missing/null TLP, resolve
it with the central authority before intake rather than sending an incomplete
document to AKB. Public laws and regulations require explicit approved
TLP:CLEAR from their trusted collection policy, not a missing label.

Display TLP, audience and relevant export/AI obligations before completion.
`tlp=null` is invalid for admission and activation; a defensive UI diagnostic
does not authorize its use. A disagreement
between the source policy and labels found inside the file needs an authorized
resolution before dissemination. Policy changes, audience expansion and changes
of originator require the central policy authority, not metadata-edit rights.

On an exact replay, Registry may return the original immutable version's URI
instead of the new session's URI. AKB verifies the canonical file and keeps its
original scan evidence. Clients store the returned canonical reference and do
not change `external_ref` to work around a failed confirmation. Redundant
session objects remain available during the retry window; durable expiration
and reference-aware cleanup are tracked separately from confirmation.

## Blocking central replay change

Local verification update, 2026-09-05: STRATOS checkout
`8911b3bcfd7b94edc305364984210c53ccc81d4c` contains the exact Budget replay fix,
atomic documentAdmission registration and Budget revalidation. Its focused
42 unit and 6 real PostgreSQL tests passed. The following describes the
original defect and required joint acceptance, not an assertion that the
local fix is absent. [Docker Desktop verification](../qa/local-docker-acceptance-2026-09-05.md)
now exercises the live readiness boundary. Native/official central capabilities
were subsequently delivered in d035bdb6; PF/ArchFlow intake remains incomplete, and Budget organization/recipient_set support has since been implemented in
AKB; the complete source flow remains subject to positive joint acceptance.

Implementation review on 2026-09-05 found that STRATOS
`registerBudgetAkbGovernedResource` rejects a root-document registration if a
document version already uses the submitted `integrationEnvelope.idempotencyKey`.
The normal retry preserves that key. As a result, the existing preflight,
intake reauthorization and confirm paths can be refused after the first version
was successfully registered. AKB's local file recovery alone does not fix this.

STRATOS must allow reconfirmation of the same root when the colliding version
belongs to that exact root and logical operation, with matching immutable
content, actor, scope, source lineage and current inherited policy. Preserve
denial for unrelated key collisions, inactive resources, changed content,
revoked actors and stale policy. The operation must return current authoritative
document and version confirmations accepted by the existing upload consumer.
An explicit verification contract returning both confirmations is an alternative
only after both sides agree and publish it.

Do not change the signed idempotency key, invent a second external reference,
weaken collision checks or fabricate a current confirmation from stored IDs.
Current AKB behavior fails closed when central reconfirmation is refused.
Joint acceptance must use real STRATOS registration, including preflight after
a completed version, repeated confirm, and recovery via a new upload session.
This dependency blocks coordinated release of the completed retry flow.

## Acceptance

The AKB/Codex task owns joint local acceptance across the suite. STRATOS owns
its connector/identity implementations and focused tests. Neither project's
isolated tests substitute for the [joint SSO and connector matrix](../qa/stratos-suite-acceptance-2026-09-05.md).
Required scope includes one credential entry followed by application-switcher
navigation, central logout/revocation, and each Budget/ProjectFlow/ArchFlow
source-to-AKB-to-Chat/citation flow. Treat live federated information providers
as separate acceptance paths from binary document admission. Keep catalog
readiness closed until the supported adapter matrix passes.

### Atomic admission, active accountability and approved collections

AKB now requires complete root/version profile inputs, stores append-only root
revisions and immutable version/file snapshots, and checks fresh admission at
use boundaries. Implement the exact central contract in
[AKB document profiles](../CONTRACTS/AKB_DOCUMENT_PROFILE_PROPOSAL.md), including
its machine-readable [schema](../../contracts/stratos/document-admission/v1/contract.schema.json).
This is a required STRATOS change, not a claim that its current deployment
already supports it.

Extend both existing generic and Budget resource registration PUTs with
`documentAdmission` and its nonce-bound authenticated confirmation. Atomically
validate the active exact resource/parent, policy/scope, approved profile,
source/domain/lifecycle evidence and current accountable owner/gestor. Historical
authorship and historical root ownership remain immutable; current owner/gestor
must be active and valid in the organization. An uploader, copied active flag,
Keycloak lookup or detached identity lookup followed by a write is insufficient.

Add these exact authenticated fixed-AKB-service operations:

- `POST /api/v1/information/resources/akb/{resourceType}/{resourceId}/document-admission/decisions`:
  revalidate an existing resource without registering/restoring it. Body contains
  `sourceVersion`, `governedResourceId`, `currentRootGovernedResourceId`,
  `policyBindingId`, `policyHash`, `scope`, `auditActorSubjectId` and full
  `documentAdmission` with `operation=revalidate`. Validate both historical root
  and current root hashes/accountability; echo the exact nonce/correlation and
  policy/source/profile coordinates with a fresh confirmation.
- `POST /api/v1/information/resources/akb/document-admission/readiness`:
  confirm the exact catalog hash/revision, ordered profile IDs/revisions and
  `atomicRegister` plus `freshRevalidate` capabilities for active `service:akb`.
  The [readiness schema](../../contracts/stratos/document-admission/v1/readiness.schema.json)
  defines exact nonce, correlation, timestamps and response fields. This probe
  creates no resource and does not grant access to any document.

There is no policy GET, stored-proof or registration fallback for a missing
fresh-decision endpoint. Unsupported, denied, stale or conflicting responses
block intake/use. General health is separate from specialized intake readiness.
No central `policy_hash` payload changes are permitted for these metadata fields.

The official-collection browser flow selects centrally approved collection
revisions and receives complete prepared root and version inputs before the
first source download. STRATOS must map the exact per-document source resource
to its active approved collection/revision, canonical URL, issuer, profile,
explicit PUBLIC/TLP:CLEAR policy and current accountability. The source governed
resource is not the collection resource. Prepare output and URL allowlisting
alone are not admission proof. Regulation effectivity requires source evidence;
scan/capture dates cannot substitute for it. See the
[official source collection contract](STRATOS_OFFICIAL_SOURCE_COLLECTIONS_V1.md).

These central extensions and the exact Budget root/version replay semantics
block initial intake enablement until real cross-system acceptance is recorded.

### Cross-application tests

Each application must provide positive and negative fixtures proving:

- clean upload, confirm, immutable reference and lifecycle reconciliation;
- idempotent replay without another Registry version;
- changed hash under the same immutable version fails;
- MIME, size, token, receipt, actor and source-lineage tampering fails;
- EICAR and scanner unavailability create no Registry version;
- revoked or out-of-scope actor fails before binary acceptance;
- missing/null/unknown TLP and missing accountable ownership fail on every
  supported source profile, including batch and public-source admission;
- approved policy inheritance remains traceable and agrees with the current
  central source; no caller-selected default can broaden access;
- logs contain no binary, extracted content, person token, upload token or
  receipt;
- the source application cannot read or publish a document solely because it
  initiated the upload.

## Coordinated rollout

1. Complete the central replay change and prepare AKB with `STRATOS_CONTENT_SECURITY_MODE=clamd`,
   `STRATOS_CONTENT_SECURITY_REQUIRED=true` and the approved shared scanner
   endpoint.
2. Build all participating clients against the same completed OpenAPI contract
   and explicit source profiles. Remove client fallback paths and outdated
   documentation examples.
3. Run the cross-application acceptance suite, including EICAR, revoked access,
   TLP and recovery after a lost response or a new upload session.
4. Release AKB and the participating STRATOS clients together. The old
   controlled-document and Budget binary aliases are removed; no compatibility
   window or historical rescan is required for this clean target.
5. Enable user intake only after the shared acceptance result is recorded for
   the exact release versions. Retain standard release and recovery gates.

Production enforcement must not be enabled application by application. A
partially enforced estate can accept a file that a later stage refuses to
ingest.


Contract execution and extraction are separate states. The `akb.contract`
profile uses `record` lifecycle for `draft` and `terminated` evidence; signed
or effective contracts require explicit normative effectivity. A draft original
can pass the existing authorized ingestion flow for review and confirm reports
`document_version_status: "draft"`; extraction does not publish it or permit
current RAG retrieval. A centrally confirmed terminated record can be historical
evidence, but is not proof that the contract is currently in force. Consumers
must retain the returned workflow status and lifecycle/execution evidence and
must not equate `INDEXED` with approval or legal effectivity.
