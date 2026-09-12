# C06 — STRATOS architecture document evidence

Status: implemented and accepted in the isolated local `akb-stratos-test`
environment on 2026-09-12. Production promotion is blocked until STRATOS
records fresh owner-reviewed Clean Pilot source evidence for its changed
production compose and access catalog; no production mutation was performed.
Scope authority is STRATOS document 69, data ownership authority is document
21, and document/security authority is document 30.

## Ownership boundary

STRATOS owns the relationship between a domain target and documentary
evidence. The target can be an architecture object, architecture relation,
contract coverage revision, or architecture baseline. AKB owns the document,
every immutable document version, source bytes, parsing, previews, extracted
text, chunks, embeddings, citations, version lifecycle, and the current access
decision.

STRATOS stores only exact AKB identifiers and a sanitized metadata snapshot.
It must never store source bytes, preview bodies, extracted text, chunks,
embeddings, prompts, answers, or a reusable AKB download credential. A link is
not an access grant. Every resolve, open, download, and export operation is
authorized again for the current person and exact version.

C05 contract coverage remains owned by Budget. AKB supplies its versioned
evidence and must not become authoritative for a contract, price, finance,
coverage membership, infrastructure membership, or baseline composition.

## Requirement mapping before implementation

| Requirement | Existing capability | Missing coordinated change | Acceptance test |
| --- | --- | --- | --- |
| Multiple links on object, relation, coverage, and baseline | AKB has immutable documents/versions; STRATOS legacy objects expose at most one AKB reference | Add a specialized append-only `ArchitectureDocumentLink` in STRATOS with an allowlisted target kind and stable link identity; retain legacy fields as compatibility data only | Two links can target one object; one version can support two targets; replay does not duplicate a link |
| Exact immutable coordinates | Registry versions have a compound document/version invariant and exact-version authorization | Make both IDs mandatory in the C06 resolver and STRATOS store; never infer latest | Creating a newer AKB version does not change a stored link or its open target |
| Purpose and validity | AKB version has validity; STRATOS owns domain purpose | Store an allowlisted purpose plus link validity in STRATOS; retain AKB validity separately | Invalid interval is rejected; link validity and source validity are both visible |
| Classification, TLP, policy lineage | AKB versions carry explicit TLP, policy binding/version/hash, governed resource and immutable profile hashes | Return one sanitized, exact-version evidence descriptor from AKB and persist its snapshot in STRATOS | Missing TLP, stale policy coordinates, wrong document/version pair, or changed lineage is rejected |
| Evidence invalidation | AKB has terminal `cancelled` version status and preserved audit history, but no explicit C06 invalidation operation | Add an explicit audited exact-version invalidation transition; map version lifecycle to `ACTIVE`, `HISTORICAL`, `PENDING`, or `INVALIDATED` evidence state | Invalidation marks current STRATOS support for review while historical link revision remains unchanged |
| Permission revocation | Registry can evaluate current root and exact-version policy | Use exact-version authorization in resolve, source-open, and source download; STRATOS re-resolves on each operation | Removing the grant denies the next open and export, including a download after a previously issued source-open token |
| Authorized exact viewer/BFF | AKB source-open and signed source content exist; STRATOS shared viewer exists | Bind source-open/download to exact-version authorization and add target-authorized STRATOS BFF routes | Allowed user opens exactly the stored version; forbidden user receives no source bytes |
| AKB outage | Existing STRATOS AKB workflow has bounded timeouts and retries only network/5xx failures | Normalize C06 resolve/open outage without changing the stored evidence revision | Outage returns an unavailable state; it does not delete the link or claim the evidence is invalid |
| Safe export | AKB has exact `rag.export` authorization and export obligations; STRATOS owns its structured graph manifest | Reauthorize every referenced version for export and export metadata/IDs only, with no content or download credential | Export contains exact IDs, purpose, validity, state, and policy coordinates; no source content, storage URI, token, prompt, answer, or chunk |
| Revoked link | STRATOS append-only federation store already uses immutable revisions | Add a terminal link revision instead of deleting or overwriting history | Revoked link cannot open/export and earlier revisions remain auditable |

## AKB contract

The additive Registry endpoint is:

```http
POST /api/v1/integrations/stratos/architecture-evidence/resolve
```

The request contains one exact `document_id` + `document_version_id`, an
operation (`link`, `open`, `status`, or `export`), and a correlation ID. The
caller is the current person. AKB applies root and exact-version authorization;
`export` additionally uses the export capability/operation. A successful
response contains only:

- exact document and version IDs, title/type/version label and lifecycle state;
- document and link-safe validity dates;
- classification and explicit TLP;
- governed resource/source/parent coordinates;
- policy binding ID/version/hash and immutable root/version snapshot hashes;
- current obligations and the computed evidence state.

The response never contains a source URI, filename, object-storage coordinate,
document body, extracted text, chunk, embedding, answer, prompt, or download
credential.

Exact source content continues through:

```http
POST /api/stratos/documents/{document_id}/source-open?version_id={document_version_id}
GET  /api/documents/source/content?token=...
```

Both calls reauthorize the same current person against the same exact version.
The second call does not rely on the signed token as an access grant.

## STRATOS contract

STRATOS exposes target-scoped routes for listing, creating, revoking,
reconciling, opening, and exporting links. Every route first authorizes the
target in its owning domain, then uses the AKB C06 resolver for the current
person. The stored link revision contains the exact AKB descriptor returned at
creation. A later status check is a separate observation and never rewrites
that historical snapshot.

The append-only target kinds are:

- `ARCHITECTURE_OBJECT`
- `ARCHITECTURE_RELATION`
- `CONTRACT_COVERAGE`
- `ARCHITECTURE_BASELINE`

The initial STRATOS-owned purpose vocabulary is `EVIDENCE`, `CONTRACT`,
`ADDENDUM`, `MANUAL`, `RUNBOOK`, `AS_BUILT`, `BASELINE`, and
`DECISION_RECORD`. The binding STRATOS documents did not prescribe wire values,
so this additive vocabulary is recorded here and in the STRATOS database
constraint. Expanding either vocabulary is a coordinated contract change.

Implemented STRATOS routes are:

```http
GET  /api/v1/architecture-document-links?targetType=...&targetId=...&targetRevisionId=...
POST /api/v1/architecture-document-links
GET  /api/v1/architecture-document-links/{link_id}/status
POST /api/v1/architecture-document-links/{link_id}/revoke
POST /api/v1/architecture-document-links/{link_id}/source-open
POST /api/v1/architecture-document-links/{link_id}/export
```

Object and relation targets use their exact `updatedAt` revision. Contract
coverage and baseline targets are accepted only when their owning domain has
registered the corresponding active governed revision. C06 does not invent a
coverage or baseline revision in place of the C05/C07 owner.

## Compatibility and rollout

This delivery is additive. Existing document, source-intake, viewer, Budget,
ProjectFlow, and ArchFlow routes retain their request/response shapes. Legacy
single AKB fields on an architecture object are not silently migrated into a
verified C06 link because they lack the required purpose, TLP, validity, and
lineage snapshot.

The STRATOS store migration is additive and append-only. The C06 feature flag is
separate from connector/import flags. Disabling it stops new C06 reads/writes
without deleting links or changing AKB content. AKB rollback returns to the
previous application revision; the additive contract creates no AKB database
table and requires no destructive rollback.

## Local acceptance evidence

The isolated acceptance used real OIDC identities, central Access Center
profiles, the AKB Registry, S3-compatible object storage, and the STRATOS C06
store. It proved:

- creation, review, independent approval, and publication of an AKB PDF;
- an idempotent exact-version link and two distinct document versions linked
  to the same architecture object;
- authorized source-open returning the exact bytes of the historical version;
- metadata-only export with no source URI, content, credential, or download
  token;
- denial for an identity without a grant and immediate denial after removing
  the previously authorized person's AKB grant;
- rejection of a stale target revision;
- append-only link revocation and denial of the next open;
- explicit AKB version invalidation propagating as `INVALIDATED` without
  rewriting the stored STRATOS evidence revision;
- a real temporary AKB outage returning unavailable while preserving the link,
  followed by successful service recovery.

The local acceptance intentionally kept connector flags disabled. Production
must keep `ARCHFLOW_FEDERATION_ENABLED`, `ARCHFLOW_DOCUMENT_EVIDENCE_ENABLED`,
and `ARCHFLOW_CONNECTORS_ENABLED` false until the coordinated release evidence,
migration, health checks, and authenticated production smoke all pass.
