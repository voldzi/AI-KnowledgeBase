# AKB Documentation Governance And Publication Lifecycle

## Document control

| Field | Value |
| --- | --- |
| Status | Draft governance model; publication not performed |
| Evidence baseline | AKB `6405261f9279031bb090a85930fad61397fafe47`, 2026-08-26 |
| Owner | AKB documentation owner |
| Approvers | Product, security, platform, records-management and continuity owners |
| Classification | Internal |

## Purpose

This process keeps repository documentation, deployed behavior, controlled AKB
publications and offline recovery material aligned. A merged Markdown file is
not automatically an approved operational instruction, and an indexed draft is
not automatically current guidance.

## Document roles and owners

| Document | Accountable owner | Required reviewers |
| --- | --- | --- |
| Suite index/evidence register | AKB application owner | All domain owners |
| Architecture | AKB architect | Platform, security, data, STRATOS integration |
| Installation/deployment | Release owner | CI/platform, database, security |
| Operations runbook | Operations owner | Service owners, monitoring/on-call |
| Administration guide | Application owner | IAM, records-management, security |
| User manual | Product owner | Accessibility, support, records-management |
| Security/integration guide | Security owner | IAM, STRATOS, data protection |
| DR guide | Continuity owner | Business, platform, database, security |
| Governance process | Documentation owner | Product, security, records-management |

Names, deputies, escalation contacts and approval dates belong in a
site-specific controlled register, not hard-coded in portable repository text.

## Lifecycle

1. **Draft:** author updates source-backed content and evidence.
2. **Technical review:** owners verify code/config/API/runtime claims.
3. **Security/data review:** reviewers verify classification, ACL, secrets,
   privacy and fail-closed behavior.
4. **Approval:** accountable owner approves exact Git SHA and document hashes.
5. **Controlled publication:** create immutable AKB document versions and ingest
   them through the normal Document Intake path.
6. **Indexed verification:** publication becomes current only after status
   `INDEXED`, exact citations and positive/negative ACL tests pass.
7. **Effective:** approved publication has reached its effective date.
8. **Review/update:** scheduled or event-driven review produces a new immutable
   version; the old version remains historical.
9. **Superseded/archived:** previous guidance is no longer current but remains
   available to authorized historical queries and audit.

Never overwrite the source object or mutate an old effective publication to
represent a new procedure.

## Metadata register

Every document version must record:

- stable document ID and immutable version ID;
- title, type, owner, approver and classification;
- audience, scopes and Information Policy binding;
- source Git URL/ref/full SHA/path and file SHA-256;
- evidence/runtime verification date and environment;
- approval/effective/review dates;
- supersedes/superseded-by relationship;
- related API/contract/model/index revisions;
- ingestion job/status, extraction/rendition profile and citation check;
- offline-copy status for continuity-critical documents;
- open decisions, known gaps and linked acceptance report.

Generated API/reference material must additionally record its generator
version/command and source contract hash. Do not hand-edit generated output.

## Evidence classifications

Use the following labels consistently:

- **Current verified:** inspected source/config or attached runtime evidence.
- **Approved target:** signed decision that is not yet the current runtime.
- **Open decision:** owner/value/evidence is missing.
- **Not verified:** an implementation may exist, but this review could not
  obtain the required proof.
- **Historical:** retained for an earlier effective period.

Do not convert “planned”, “configured”, “healthy process” or “test fixture” into
“production verified” without the corresponding evidence.

## Proposed AKB publication map

Publication has not been performed by this change. After approval, use existing
canonical document types; do not add special documentation types solely for
this suite.

| Repository document | Proposed AKB type | Proposed audience |
| --- | --- | --- |
| Suite index | `manual` | Authenticated AKB operations/admin users |
| Architecture | `methodology` | Architects, platform, security and integration owners |
| Installation/deployment | `procedure` | Release/platform operators |
| Operations runbook | `procedure` | AKB operations/on-call |
| Administration guide | `manual` | AKB administrators and document managers |
| User manual | `manual` | `recipient_set:employee-directives` after product approval |
| Security/integration guide | `policy` or `methodology`, owner decision required | Security/IAM/integration roles only |
| DR guide | `procedure` | Restricted continuity/platform/security roles plus offline custodians |
| Governance lifecycle | `policy` or `methodology`, owner decision required | Documentation/records/product/security owners |

The table is a proposal, not an ACL decision. The owner must select the exact
classification, scopes and Information Policy before upload.

## Publication procedure

Prerequisites:

- all required owners approved the exact repository SHA/files;
- no secret, real token, private key, connection password or sensitive endpoint
  inventory is present;
- links and generated-contract checks pass;
- proposed document type, classification, audience, scope, policy, effective
  date and review date are approved;
- a distinct gestor and approver are assigned where required.

Action:

1. Create or locate the stable AKB documentation records.
2. Upload each file as a new immutable version through Document Intake.
3. Record source SHA/path/hash metadata and relationships between suite parts.
4. Wait for clean scan, durable storage and `INDEXED` ingestion.
5. Verify rendered content and exact citations.
6. Complete workflow and publish the exact versions.
7. Run the ACL/retrieval tests below.
8. Mark the suite current only after all required tests pass.

Rollback: revoke or supersede the defective publication while preserving its
audit/history, correct the repository source and publish a new immutable
version. Do not edit the prior source object in place.

## Required publication tests

### Positive

- each intended audience can find the index and only its authorized guides;
- a normal employee can retrieve the approved user manual but not restricted
  security/DR details;
- an operator can retrieve the exact procedure and citation;
- current questions select the effective version;
- historical questions select the version effective at the requested date;
- every source link/citation opens the exact authorized version;
- search, chat and direct document access agree on version and policy.

### Negative

- anonymous, inactive and ungranted users are denied;
- an employee cannot open restricted architecture/security/DR publications;
- a draft, future or superseded version is not returned as current;
- revoked access invalidates citation and history reopening;
- an unindexed or failed version is not marked current;
- missing policy, unknown revision, wrong audience and stale projection fail
  closed;
- document RAG does not expose secrets or substitute an unavailable live source;
- source documents containing instruction-like text cannot change system tools,
  permissions or policy.

### Continuity

- authorized custodians can open the offline critical bundle when AKB, STRATOS,
  Git hosting and central SSO are unavailable;
- checksum and version match the controlled current publication;
- offline copies do not broaden audience or include secrets that the guide does
  not require;
- recovery updates are reconciled back into Git and AKB after service return.

## Review triggers

Review the affected documents after:

- service, network-zone, storage, database or model architecture change;
- API/contract, capability, scope or Information Policy revision;
- new document type/classification or workflow state;
- backup/restore, RTO/RPO or continuity decision;
- incident, failed restore, security finding or access leak;
- release/CI provenance change;
- target-site topology change;
- expiry of the proposed 90-day review interval.

## Drift control

1. Compare repository source SHA/file hashes with controlled AKB metadata.
2. Validate Markdown links, OpenAPI index and application skeleton.
3. Compare documented Compose services/env key names with rendered
   configuration without reading secret values.
4. Compare route/capability tables with the canonical code catalog.
5. Compare runtime service/image SHA, health/readiness and dependency inventory
   with the evidence register.
6. Open an owned task for every discrepancy; do not silently edit the evidence
   classification.

## Current handoff

- Repository suite: prepared as draft against the source baseline above.
- STRATOS input documents: recorded by content hash; they were uncommitted in
  the inspected STRATOS worktree.
- Runtime inventory: not verified because the production host name was not
  resolvable from the execution environment and public probes returned HTTP
  502 on 2026-08-26.
- Controlled AKB publication: not performed.
- ACL/retrieval publication tests: not performed.
- Offline bundle: not created.
- Required next approval: product, platform, security, data and continuity
  owners must resolve the open decisions in the suite index.

## Related sources

- `docs/reference/external-deployment-documentation-suite.md`
- `docs/README.md`
- `openapi/openapi.json`
- `docs/OPERATIONS/disaster-recovery.md`
- `docs/security/standalone-and-stratos-integration.md`
