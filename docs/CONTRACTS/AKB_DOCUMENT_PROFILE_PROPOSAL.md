# AKB document profile and atomic admission contract

Status, 2026-09-05: the AKB implementation requires explicit document profiles,
persists append-only root revisions and immutable content snapshots, and verifies
fresh central admission decisions at use boundaries. The corresponding STRATOS
extensions below are **required coordinated changes, not existing verified
production capabilities**. Unsupported, missing, stale or conflicting central
confirmation fails closed. Neither the local catalog nor a passing infrastructure
health check enables document intake by itself.

The product uses the existing Document / DocumentVersion / DocumentFile
identities. Information Policy V2 retains its established central `policy_hash`.
Every admitted document additionally requires an explicit effective TLP from the
five supported values; nullable shared-policy parsing is only defensive error
handling, never an approved document mode. There is no administrator, service,
public-source, imported-document or legacy exemption.

## Catalog and producer input

The single source of structural rules and CS/EN form metadata is
[`catalog.json`](../../contracts/akb/document-profiles/v1/catalog.json), revision
`1`. `scripts/sync_document_profile_catalog.py` produces exact Registry and web
copies and checks parity. Structural validity does not establish that STRATOS
has approved an active profile revision, accountable identity or evidence.

| Profile ID, revision 1 | Family and required evidence | Lifecycle |
| --- | --- | --- |
| `akb.knowledge-note` | Subject and creation date; explicit authorship and provenance. | Record or open-ended normative interval; review date required. |
| `akb.controlled-document` | Issuer reference, applicability and effective-date evidence. | Fixed or open-ended normative interval; review date and exact-version independent approval required. |
| `akb.meeting-project-record` | Event date, record reference, optional project reference. | Record; review date optional. |
| `akb.contract` | Contract reference, parties, execution status and supporting execution evidence. | Signed/effective: normative interval. Draft/terminated: record. Review date required. |
| `akb.official-public-reference` | Authority, HTTPS canonical source URL, approved collection, source kind and applicable effective-date evidence. | Regulation: normative interval with evidence. Other references may be records. Review date required; explicit PUBLIC and TLP:CLEAR. |

The catalog lists exact document types, allowed attachments, field types,
required/nullable fields, options, review and retention rule references. The
selected profile resolves a shared type such as `attachment`; a filename does
not determine governance. File-format/parser capabilities are a separate
[catalog](DOCUMENT_FORMAT_CAPABILITIES_V1.md).

The binding producer schema is
[`inputs.schema.json`](../../contracts/akb/document-profiles/v1/inputs.schema.json).
Unknown fields are rejected. Producers submit business inputs, not a purported
central proof or a caller-selected immutable content snapshot.

| Request boundary | Required input |
| --- | --- |
| Native `POST /api/v1/documents`, generic external upsert, dedicated Budget root upsert | `document_profile: {profile, authorship, provenance, accountability}`. Existing Information Policy, owner and assignment fields must agree with it. |
| Native version create, dedicated Budget version upsert | Nested `document_profile: {expected_root_metadata_revision, lifecycle, domain_evidence}`. The expected revision is the server-returned current root revision. |
| Document metadata PATCH | Complete root `document_profile` and `expected_root_metadata_revision` whenever metadata changes. Status-only actions use fresh admission; withdrawal remains available for remediation. |
| `PUT /api/v1/documents/{id}/assignments` | `assignments`, complete root `document_profile` and `expected_root_metadata_revision`. Owner/gestor transfers append a centrally admitted root revision with compare-and-swap. |
| Signed upload and canonical content PUT | Exact version profile input and current root coordinates travel in the authenticated preflight token. Current root and transport actor/service authority are rechecked before bytes. |

Root input contains nonempty `authorship[{kind,id,evidenceReference}]`, where
kind is `person`, `organization` or `external_authority`. Uploader, initiating
actor and registering service remain separate audit/lineage roles. They never
silently become the author, owner or gestor. Accountability contains
`ownerSubjectId` and `gestor{kind,id}`, with gestor kind `person` or
`organization_unit`. Primary owner and gestor assignments must match exactly;
controlled profiles additionally require a primary approver.

Native root input has provenance `sourceSystem=AKB`, `sourceRecordId=null` and
`sourceGovernedResourceId=null`; Registry allocates the final document ID before
registration and uses that ID as the immutable source record. Imported roots
require the actual source system, stable source record and exact central source
resource. They must not be relabelled as native AKB to pass validation.

## Current root and immutable version

The central machine-readable contract is
[`contract.schema.json`](../../contracts/stratos/document-admission/v1/contract.schema.json).
All objects reject unknown fields. Golden examples use the catalog profile IDs
with clearly artificial identities/evidence; they are conformance data, not
production approval.

| Object | Exact contents |
| --- | --- |
| Root snapshot | `schemaVersion=stratos-document-root-1`, `organizationId`, `documentId`, `metadataRevision`, `profile{id,revision}`, `documentType`, `authorship`, `provenance{sourceSystem,sourceRecordId,sourceGovernedResourceId}`, `accountability`. |
| Version snapshot | `schemaVersion=stratos-document-version-1`, `organizationId`, `documentId`, `documentVersionId`, `rootMetadataRevision`, `rootSnapshotHash`, `sourceLineage`, `lifecycle`, `domainEvidence`. |
| Source lineage | `sourceSystem`, `sourceRecordId`, `sourceVersion`, nullable `sourceGovernedResourceId`, `contentSha256`, `contentUri`, `intakeReceiptId`, UTC `capturedAt`. |
| Lifecycle | `mode`, explicitly nullable `effectiveFrom`, `effectiveTo`, `recordedOn`, `reviewAt`, and required `reviewRuleId`, `retentionRuleId`. |

Registry derives source lineage from the verified clean file, exact original
URI/hash, signed intake receipt and scan timestamp. A native version's
`sourceVersion` is its allocated document-version ID. For external sources,
including Budget, the content-source version is the exact verified prefixed
SHA-256; Budget additionally binds it to the authenticated envelope file hash.
The central governed version's own `sourceVersion` still names the immutable AKB
version ID. These two coordinates have distinct meanings. Copying an older
version's content lineage into a new upload is invalid.

Migration `0027_document_profiles` adds append-only root revisions and immutable
version snapshots with explicit Document/Version/File foreign keys and hashes.
Database triggers prevent UPDATE/DELETE of snapshots. Root metadata changes use
compare-and-swap against the current root revision; stored historical snapshots
and approvals are never rewritten. Native receipt replay additionally uses a
durable unique document/session identity (migration `0028_native_intake_identity`)
and requires the exact original actor, receipt, file, policy, root and version
input. A matching retry returns the same version; changed evidence conflicts.

Document responses expose `current_root_metadata_revision`,
`current_root_snapshot_hash`, and `document_profile` (current root snapshot).
Version responses expose `root_metadata_revision`, `root_snapshot_hash`,
`version_snapshot_hash`, `document_profile` (historical root) and
`document_profile_snapshot` (immutable version). Defensive nullable response
fields represent incomplete/unadmitted state; they confer no permission.

An owner/gestor transfer changes `currentRootSnapshot` and current accountability.
An existing version retains its historical `rootSnapshot`. Fresh revalidation
must validate the **current** accountable owner/gestor and the historical source
proof together. It must not require the former gestor to remain an active
employee forever, nor silently replace the historical owner behind a citation.
New registrations require current and historical roots to be identical.

Record `recordedOn` means creation/recording of the evidence. A meeting's
`eventDate` is independent: minutes can be written later. Record versions have
null normative valid-from/to; temporal retrieval uses their recording date to
avoid future exposure. Capture/scan time never invents effectivity. Signed or
effective contracts require normative dates; drafts remain draft even when
ingested for review and cannot enter current authoritative RAG. Terminated
contracts require execution evidence and may be published as historical records,
without claiming present normative effectivity. Review dates and retention-rule
references are explicit; no legal retention duration is inferred.

## Required STRATOS atomic registration

These existing central operations require extension:

- `PUT /api/v1/information/resources/{applicationId}/{resourceType}/{resourceId}`
- `PUT /api/v1/integrations/budget/akb/resources/{resourceType}/{resourceId}`

They gain the exact `documentAdmission` request and authenticated confirmation
below. The existing Budget closed field allowlist must expressly accept it.
AKB's current client uses the fixed AKB service credential and records the real
initiating actor separately. No transport bearer or caller `active:true` field
proves that an arbitrary owner/gestor is active.

In one authoritative decision STRATOS must validate the exact active resource
and parent, effective policy and scope, approved active profile revision,
authorized source evidence, lifecycle/domain evidence, current owner identity
and membership, and current gestor identity or organizational unit. Bind all of
that to the complete snapshot hashes and exact resource coordinates. Historical
authorship is source evidence; an external issuer need not be an internal active
employee. A detached identity lookup followed by an unrelated registration does
not provide this atomic guarantee.

For official sources, `sourceGovernedResourceId` names the **specific source
document**, not the whole collection. STRATOS must resolve that source to its
active approved collection/revision, canonical URL, issuer, permitted profile,
effective policy and current accountability. Existence of the source ID alone is
insufficient. The prepare flow uses `sourceRecordId = "official-source:" +
SHA256(UTF8(collectionId + "\n" + canonicalURL))`, where canonicalURL is serialized
by the agreed URL contract. Collection prepare output is input evidence; it is
not the final admission proof. See the coordinated
[official collection contract](../integration/STRATOS_OFFICIAL_SOURCE_COLLECTIONS_V1.md).

## Request, hashes and confirmation

`akb-document-snapshot-json-1` hashes UTF-8 JSON with lexically sorted keys,
compact separators, explicit nulls, preserved array order and no Unicode
normalization. Values contain no floating-point numbers. Dates use ISO calendar
dates, timestamps UTC instants. The result is `sha256:` plus lowercase SHA-256.
Existing `policyHash` canonicalization is unchanged. Cross-language examples:
[root](../../contracts/stratos/document-admission/v1/example-root.json),
[version](../../contracts/stratos/document-admission/v1/example-version.json),
[hashes](../../contracts/stratos/document-admission/v1/example-hashes.json).

`documentAdmission` request fields:
`schemaVersion=stratos-document-admission-request-1`, `operation=register` or
`revalidate`, fresh 32-hex `requestNonce`, `correlationId`, `rootSnapshot`,
`currentRootSnapshot`, `versionSnapshot` (explicit null for root-only),
`rootSnapshotHash`, `currentRootSnapshotHash`, `snapshotHash` (version hash when
present). Existing resource, policy and scope coordinates remain outside it.

The authenticated central resource response must contain `id`, `isActive=true`,
`confirmedBySubjectId=service:akb`, and `documentAdmission` with:

- `schemaVersion=stratos-document-admission-confirmation-1`, `operation`,
  `decision=ALLOW`, `admissionId`, positive `revision`, `organizationId`,
  `application=AKB`, `resourceType`, `resourceId`, `sourceVersion`,
  `governedResourceId`;
- exact `policyBindingId`, `policyVersion`, `policyHash`, `scopeHash`,
  `snapshotHash`, `rootSnapshotHash`, historical `profile` and `accountability`;
- exact `currentRootSnapshotHash`, `currentMetadataRevision`,
  `currentRootGovernedResourceId`, `currentProfile`, `currentAccountability`;
- echoed `requestNonce`, `correlationId`, `confirmedBySubjectId=service:akb`,
  UTC `checkedAt` and `expiresAt`.

Version resource type preserves its existing contract spelling:
`document_version` for generic registration, `document-version` for Budget.
The response must echo the exact requested spelling; neither is a fallback.
`scopeHash` uses the snapshot JSON algorithm over the exact effective scope.
Confirmation must be no older than 30 seconds, no more than 5 seconds ahead,
unexpired and have a lifetime at most 60 seconds. These bounds do not permit
cross-request permission caching. Stored confirmations never grant future use.

## Required fresh decision endpoint

New coordinated endpoint, **not an existing policy GET behavior**:

`POST /api/v1/information/resources/akb/{resourceType}/{resourceId}/document-admission/decisions`

The authenticated request uses the configured fixed AKB service credential,
`X-Correlation-ID` matching the nested `correlationId`, and this exact body:

```json
{
  "sourceVersion": "exact-governed-source-version",
  "governedResourceId": "exact-existing-resource-id",
  "currentRootGovernedResourceId": "exact-current-root-resource-id",
  "policyBindingId": "exact-policy-binding-id",
  "policyHash": "sha256:...",
  "scope": {"type": "organization", "id": "org_stratos"},
  "auditActorSubjectId": "actual-operation-actor",
  "documentAdmission": {"operation": "revalidate", "...": "full request defined above"}
}
```

The abbreviated nested object illustrates placement only; the JSON schema is
binding. STRATOS must authorize the exact fixed service for this decision route,
validate current active state and return the authenticated resource confirmation
above. This operation **does not register, restore or update** a resource. AKB
never substitutes a policy GET, stored confirmation or registration replay if
this decision endpoint is unsupported or denied.

AKB invokes fresh checks at document/content metadata reads, exact version use,
retrieval candidate filtering, ingestion authorization, review, publication,
package activation and source transfer gates. It preserves central PDP/TLP,
transport-person/service, exact-version, temporal and receipt checks in addition
to admission. Controlled publication requires completed independent approval
bound to the exact version/policy/root/version-snapshot hashes; a root status or
approver assignment alone cannot satisfy it. Withdrawal/revocation can still
remove access to incomplete data.

## Readiness and coordinated acceptance

The specialized `GET /api/v1/integrations/ingestion/readiness` checks database and
service access plus fresh central support for the exact catalog and admission
capabilities. Its upstream coordinated probe is authenticated
`POST /api/v1/information/resources/akb/document-admission/readiness`.
The binding [readiness schema](../../contracts/stratos/document-admission/v1/readiness.schema.json) defines the request and response. The probe carries a fresh nonce/correlation, `application=AKB`, catalog revision
and canonical hash, all requested profile IDs/revisions, and required
`atomicRegister` / `freshRevalidate` capabilities. It must return the same
coordinates, an active exact service, approved profiles, capabilities and a
fresh expiring ALLOW confirmation. It creates no document or resource.

Unsupported, denied, stale or mismatched support produces **503**
`document_profile_admission_unavailable` with blocked/unsupported details;
verified support returns intake `ready`. It is a prerequisite, not a grant for
an individual document. Every subsequent operation still obtains its exact
admission decision. General `/health` and `/ready` describe process/database
availability and cannot establish intake readiness.

Remaining cross-system enablement requires STRATOS implementing and approving
these contracts, canonical identities, source/collection mappings and all five
catalog profiles; exact-service/route deployment configuration; and positive
and negative E2E evidence through real scanner, ingestion and retrieval. The
local AKB implementation and fake transport conformance tests do not prove the
current external deployment supports admission. Budget root/version replay must
also respect central idempotency rules; an upstream collision remains a
fail-closed error, never a key rewrite or fabricated confirmation.

Acceptance must cover all families, owner distinct from uploader, revoked
current owner/gestor, metadata transfer preserving history, missing TLP/evidence,
future/record dates, incompatible profile revision, receipt/content mismatch,
concurrent metadata/version writes, exact retry and central outage/revocation
between preflight, transfer, approval and retrieval. PostgreSQL migrations and
snapshot/replay constraints are validated separately from SQLite unit tests.

See [ADR 0017](../adr/0017-mandatory-document-policy.md),
[ADR 0020](../adr/0020-document-profile-snapshots.md), the
[implementation plan](../ARCHITECTURE/document-intake-hardening-plan.md) and
[STRATOS handoff](../integration/STRATOS_DOCUMENT_INTAKE_HANDOFF.md).
