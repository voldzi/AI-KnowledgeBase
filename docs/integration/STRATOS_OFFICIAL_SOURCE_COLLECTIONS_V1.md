# STRATOS official-source collections V1

Status: **AKB client implemented; STRATOS implementation and shared acceptance required.**
This document specifies a new integration contract. It does not assert that the
upstream endpoints, collection approvals or source records exist. The current
STRATOS exact information-resource PUT and policy GET do not provide the approved
collection projection or prepare operation described here. There is no legacy
fallback in AKB.

## API family and authentication

Configure `AKL_STRATOS_OFFICIAL_SOURCES_URL` on the AKB web service only after
joint verification, normally to
`https://<stratos-api>/api/v1/integrations/akb/official-sources`. The default is
empty and results in `503 PUBLIC_SOURCE_APPROVAL_UNAVAILABLE`. The compose web
service passes through the optional setting without enabling it.

Both operations use the current interactive actor's `Authorization: Bearer …`
and `X-Correlation-ID`. STRATOS must resolve current identity, membership,
application access and permission to manage official sources. Neither browser
roles nor a caller-supplied `active: true` prove permission or accountability.
Responses are JSON, `Cache-Control: private, no-store`; redirects are forbidden.
AKB bounds each response to 256 KiB and each request to 10 seconds. Responses are
closed shapes: unrecognized or missing fields fail closed.

| Operation | Purpose |
| --- | --- |
| `GET /collections` | Display only the actor's currently approved collection configurations supported by AKB. |
| `POST /sources/prepare` | Validate the exact proposed source under a selected collection revision and prepare/reuse its individual governed source resource. Never download its document bytes. |

`401` means expired authentication, `403` denial/revocation, `409` stale revision
or immutable source conflict, `422` missing/unverifiable source evidence, and
`429` throttling. Upstream `404`, `5xx`, network failure and malformed success
become AKB `503`; none are interpreted as approval or an empty approved catalog.
A legitimate empty catalog is `200` with `collections: []`.

## Collection projection

The exact GET response is:

```json
{
  "schemaVersion": "stratos-official-source-collections-1",
  "collections": [{
    "collectionId": "cz-statistics",
    "revision": "collection-revision-example",
    "displayName": "Official statistical references",
    "authorityDisplayName": "Approved issuing authority",
    "ownerDisplayName": "Current responsible owner",
    "gestorDisplayName": "Current knowledge stewardship unit",
    "reviewRuleLabel": "Annual review and source changes",
    "profile": { "id": "akb.official-public-reference", "revision": "1" },
    "tlp": "TLP:CLEAR"
  }]
}
```

Names/revision above illustrate the wire shape and are not seeded approvals.
At most 100 unique entries; `collectionId` must identify an AKB discovery
collection. IDs/revisions are trimmed nonempty strings at most 160 characters;
display labels are at most 300 characters. No `active`, owner ID, arbitrary
policy or raw JSON is entered by the user. The UI shows publisher, owner,
gestor, review rule and explicit TLP, then sends only collection selection and
source candidate coordinates. The local host/format catalog is a technical
allowlist, never the authoritative list of approved collections.

STRATOS stores and approves the underlying collection configuration: revision,
source/canonical URL boundaries, applicable document profile and document
types, issuing authority and its authorship evidence, current active owner and
gestor, full information policy, lifecycle/review/retention rules and the
mechanism for obtaining required source evidence. The GET projection exposes
names for selection; the full authoritative metadata is prepared per source.

## Exact source preparation

The POST request is closed and contains all these fields:

```json
{
  "schemaVersion": "stratos-official-source-prepare-1",
  "collectionId": "cz-statistics",
  "expectedCollectionRevision": "collection-revision-example",
  "sourceUrl": "https://csu.gov.cz/katalog-produktu",
  "canonicalUrl": "https://csu.gov.cz/katalog-produktu",
  "title": "Statistical product catalog",
  "effectiveFrom": null,
  "effectiveTo": null
}
```

STRATOS must check the current collection revision, exact URLs and current
accountability and evidence. The title is a proposal, not authority proof.
Effective dates are likewise proposals; legal-date evidence must be resolved
by STRATOS. The source cannot become legally effective because it was fetched
today or because its title or URL appears official.

The exact response has these fields and no others:

| Field | Exact value/contract |
| --- | --- |
| `schemaVersion` | `stratos-official-source-preparation-1` |
| `collectionId`, `collectionRevision` | Exact requested ID and expected revision, after a fresh approval check. |
| `sourceUrl`, `canonicalUrl`, `title` | Exact approved request values; a correction requires a new request. |
| `documentType` | Exact AKB discovery collection type, allowed by the profile. |
| `documentProfile` | Complete `DocumentProfileInput` from the shared [profile inputs](../../contracts/akb/document-profiles/v1/inputs.schema.json): profile, authorship, provenance and accountability. |
| `documentVersionProfile` | Complete version **draft** `{lifecycle, domain_evidence}`; no invented root revision. Same strict fields/rules as `DocumentVersionProfileInput`, with `expected_root_metadata_revision` omitted until Registry allocates/reads it. |
| `informationPolicy` | Complete explicit `stratos-information-policy-2` policy: handling `PUBLIC`, `TLP:CLEAR`, audience scope `organization` in `org_stratos`. |

Use profile `akb.official-public-reference` revision `1` and source system
`AKB_OFFICIAL_SOURCE`. Imported provenance is required:

- `sourceRecordId = "official-source:" + sha256(UTF8(collectionId + "\n" + canonicalUrl))`,
  using the full 64 lowercase hexadecimal digits. `canonicalUrl` is serialized
  by the WHATWG URL algorithm; the request already carries that serialization.
- `sourceGovernedResourceId` identifies this **individual source document** in
  STRATOS. It must never stand for the collection. Repeated prepare of the same
  source is idempotent and returns its existing exact resource; another source
  cannot reuse that resource through a mismatched canonical URL or collection.
- The upstream resource stores the verified relationship to the approved
  collection/revision, canonical URL, issuer/authorship evidence, profile,
  information policy and current owner/gestor. Content versions are registered
  later against the verified immutable file hash, not against an invented
  preparation receipt.

The version draft uses all explicit lifecycle fields: `mode`, `effectiveFrom`,
`effectiveTo`, `recordedOn`, `reviewAt`, `reviewRuleId`, `retentionRuleId`.
Nonapplicable values are explicit nulls. `reviewAt` is mandatory for this
profile. Domain evidence contains exactly `family=official_public_reference`,
`authorityReference`, `canonicalSourceUrl`, `collectionId`, `sourceKind` and
`effectiveDateEvidenceReference`. The authority must be one of the root's
organization/external-authority authors. Regulations require a normative
lifecycle and verified effective-date evidence. Reference records may use a
documented record date instead. Preparation must be stable for an unchanged
source/version; recalculating dates on every request is not an idempotency key.

## Admission sequence and revocation

1. AKB validates local collection/source URL boundaries and legal-version dates.
2. Fresh `sources/prepare` resolves current central configuration. AKB validates
   the complete root profile, version draft, exact source identity and policy.
3. AKB creates the Registry root or locates the existing root. Registry's
   existing authoritative resource registration/admission must resolve the
   upstream **individual** source and verify its active collection relationship.
   Merely finding an existing source ID is insufficient.
4. Existing roots are freshly authorized/revalidated. AKB uses the returned
   current root, verifies its canonical hash/revision and compares exact profile,
   policy and collection/canonical coordinates with preparation. A mismatch
   returns `409 PUBLIC_SOURCE_ROOT_METADATA_CONFLICT`; an administrator must
   explicitly update the root with its expected current revision. No silent
   metadata replacement is permitted.
5. Only then AKB downloads the original. It binds the current root revision and
   complete version proposal into the signed intake token, validates the bytes,
   runs the configured scan and stores the immutable content.
6. Registry constructs the version source lineage from its stored root and
   verified file/receipt. Its final `documentAdmission` must confirm the exact
   historical root/current root/version snapshot and content hash before the
   version is activated or indexed.

`sources/prepare` is not a replacement for `documentAdmission`. A collection,
source, owner, gestor, membership or policy revoked after preparation must still
be denied by the later fresh Registry gates. Assignment projection fields in
AKB are references; they do not prove central active status. Original source
GETs carry no STRATOS bearer token. Discovery of the technical source catalog
remains a separate read-only operation and grants no import permission.

## Joint acceptance and activation

AKB tests cover the real client parser, sync flow and BFF denial using isolated
central/Registry fixtures. They do not establish STRATOS runtime readiness.
Before setting the endpoint in a live environment, verify together:

- Current permitted actor sees only its approved collections; missing contract
  produces an unavailable UI with import disabled. Empty approved list is clear.
- No document download occurs on stale revision, revoked actor/collection,
  changed root, malformed policy/TLP, unknown profile, missing issuer,
  incomplete owner/gestor/review or unverified legal dates.
- Exact new source prepare → root admission → bytes/clean scan → immutable
  version admission → publication → indexing → authorized citation succeeds.
- Another document's resource ID, a collection resource ID, wrong canonical URL
  or changed policy cannot be substituted at prepare, root admission or version
  activation; a revoked relationship between stages fails closed.
- Same source/hash/profile/lifecycle reuses the existing immutable version;
  changed immutable metadata creates a new version. Existing original bytes
  and historical root/version snapshots remain unchanged.
- Upstream timeout/restart and duplicate prepare are idempotent and recoverable;
  errors expose a correlation ID without bodies, tokens or confidential metadata.
