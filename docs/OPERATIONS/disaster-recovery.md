# AKB Disaster Recovery And Continuity

## Document control

| Field | Value |
| --- | --- |
| Status | Draft; recovery design documented, production restore evidence pending |
| Evidence baseline | AKB `6405261f9279031bb090a85930fad61397fafe47`, 2026-08-26 |
| Owner | AKB continuity owner |
| Approvers | Business continuity, platform, database, security and data owners |
| Classification | Restricted operational documentation |

## Current evidence and open decisions

- **Current verified:** Registry/PostgreSQL and source object storage contain
  canonical AKB state; Qdrant, OpenSearch and renditions are derived.
- **Current verified:** immutable release tooling creates a Registry database
  backup before migration and validates the dump/toolchain.
- **Current verified:** repository local backup scripts cover the development
  Compose PostgreSQL, MinIO, Qdrant, evaluation and local Keycloak/config.
- **Not verified:** an active production-wide backup schedule, off-site copy,
  S3 versioning/snapshot policy or successful isolated production restore.
- **Open decision:** approved RTO and RPO for Registry, source objects,
  conversations/audit, indexes and optional live integrations.
- **Open decision:** offline distribution and custody of critical runbooks,
  certificates and recovery contacts.

No deployment may claim DR acceptance from the existence of backup scripts
alone.

## Recovery classes

| Class | Assets | Recovery expectation |
| --- | --- | --- |
| A - canonical | PostgreSQL Registry/session/workflow/audit data; immutable source objects; approved documentation; secret/PKI recovery material | Restore with integrity and lineage; data loss bounded by approved RPO |
| B - reproducible derived | Qdrant, OpenSearch, Office renditions, generated reports/caches | Rebuild from class A under exact model/index/rendition revisions |
| C - external authority | Keycloak, STRATOS Access/Policy, DNS/NTP/PKI, model service, central monitoring | Restored by owning platform; AKB remains fail closed until available |
| D - business source | Budget, ProjectFlow, ArchFlow | Restored by source owners; AKB does not synthesize missing live data |

## Backup policy that must be approved per site

Record for each asset:

- owner and backup operator;
- frequency, retention and RPO;
- encryption and key custody;
- local, off-host and offline/immutable copy;
- checksum and inventory format;
- restore tool/image version;
- access logging and deletion approval;
- last successful backup and last isolated restore;
- dependency on another platform's backup.

### PostgreSQL

Use consistent logical/physical backup procedures owned by the database team.
The immutable release requires a custom-format Registry dump and validates its
contents before migration. A release backup is not automatically the complete
long-term DR policy.

### Object storage

Back up the current S3 bucket including object metadata, versioning where
enabled and an inventory sufficient to reconcile Registry URI, size and
SHA-256. Current production targets SeaweedFS S3; the local `infra/backup`
MinIO mirror is not a production SeaweedFS backup procedure.

### Qdrant and OpenSearch

Snapshots may reduce RTO, but both remain derived. Preserve collection/index
revision, embedding model/dimensions, mapping, alias, counts and policy fields.
If compatibility is uncertain, rebuild instead of copying raw storage.

### Secrets and PKI

Use an approved encrypted recovery mechanism outside Git and ordinary
application backups. Test access under dual control. A backup without the
required decryption/issuer keys is not a restorable service; an unrestricted
copy of those keys is itself a critical incident.

### Documentation and evidence

Keep an encrypted offline bundle with this DR guide, target topology, contacts,
DNS/PKI procedures, secret-recovery method, restore commands, last known good
release/image IDs, checksums and last restore report. Test that authorized
operators can read it without AKB, STRATOS, Git hosting or central SSO.

## Recovery order

The standard dependency order is:

1. incident command, evidence preservation and recovery authorization;
2. DNS, NTP, PKI, secret access and private network controls;
3. Keycloak identity;
4. STRATOS Access/Information Policy in integrated mode;
5. PostgreSQL/Registry canonical data and server-side sessions (sessions may be
   globally revoked by decision);
6. S3 immutable source objects and Registry-to-object reconciliation;
7. LLM/embedding provider, Qdrant, OpenSearch and Ingestion rebuild;
8. RAG, Governance, Evaluation, web/chat and public gateway;
9. authorized document/source/citation and controlled-rule smokes;
10. optional Director Copilot source integrations;
11. backlog reconciliation, monitoring and formal return to service.

Do not open web/chat merely because processes started. Required dependencies
must pass readiness and authorization acceptance.

## Isolated restore rehearsal

Prerequisites:

- approved restore point and clean isolated target;
- no route to production writers, buckets, IdP administration or source tools;
- exact restore tool/image versions and secret-recovery authorization;
- expected inventory/checksums and acceptance owner.

Procedure:

1. Restore PostgreSQL without changing production.
2. Restore/copy the S3 recovery set into an isolated bucket.
3. Verify document/version/object counts, sizes and SHA-256 samples/inventory.
4. Start Registry and verify schema, identity and immutable lineage.
5. Restore snapshots or rebuild Qdrant/OpenSearch from authorized versions.
6. Recreate renditions under the recorded rendition engine revision if needed.
7. Start the remaining services with isolated identity/policy fixtures that
   preserve production semantics but cannot access production data.
8. Test current and historical document access, attachment lineage, citations,
   controlled rules, denied access and audit continuity.
9. Record duration by phase, achieved RPO, failures, operator, checksums,
   release/image IDs and cleanup evidence.
10. Destroy only the isolated rehearsal resources after approval; retain the
    signed report.

Expected: canonical data is complete and derived indexes can be proven against
it. A successful `/health` alone is not a restore test.

## Scenario playbooks

### Loss or corruption of Registry database

1. Stop application writers and preserve evidence.
2. Identify the last verified backup and transaction boundary.
3. Restore to an isolated database and run integrity/migration checks.
4. Compare object inventory, current-version pointers, workflow and audit.
5. Promote only through the database owner's controlled failover procedure.
6. Reauthorize/reconcile derived indexes and invalidate sessions if integrity
   cannot be guaranteed.

Prohibited: schema auto-create, deleting migration history, attaching an old
database to newer incompatible code or writing directly to replicas.

### Loss or corruption of source objects

1. Block uploads/downloads for affected keys; do not serve an unverified cache.
2. Restore objects into a recovery bucket and verify exact size/SHA-256 against
   Registry.
3. Reconnect through approved configuration and run authorized preview,
   download and ingestion checks.
4. Preserve missing/corrupt records as incidents; never rewrite immutable
   version history to hide loss.

### Loss of Qdrant/OpenSearch

Restore compatible snapshots or create new revisioned stores. Reindex from
Registry-authorized immutable sources, validate counts/metadata/citations and
switch aliases only after positive and negative ACL tests. During rebuild,
chat/search reports explicit degradation.

### Compromised credential, session key or certificate

1. Revoke/rotate the affected identity or certificate and isolate the caller.
2. Preserve metadata-level audit without copying secret values.
3. Reissue only minimum credentials to verified workloads.
4. Invalidate/decrypt-fail sessions as required; require fresh login.
5. Verify old credential/certificate rejection and all route/audience limits.
6. Reconcile actions made during the suspected interval.

### Keycloak or STRATOS Access/Policy outage

Protected operations remain denied after validation expires. Local logout
continues. Do not issue emergency broad roles. A separately approved
break-glass process must be temporary, scoped, audited, have an explicit expiry
and require post-recovery reconciliation. No such general-purpose AKB
break-glass mode is established by this document.

### Git/registry/CI unavailable

Continue serving the last verified immutable release if healthy. Do not build
or deploy from an untrusted checkout. Recovery material must include the last
known good source SHA, image IDs and deployment record. Resume changes only
after source/image provenance is restored.

### STRATOS business source unavailable

Document functions may continue when their own identity/policy dependencies
are ready. Live Budget/ProjectFlow/ArchFlow answers remain explicitly
unavailable and are never replaced by document RAG.

## Return-to-service gates

- approved incident/recovery decision;
- canonical database and object integrity verified;
- exact release/image identity recorded;
- health and dependency readiness pass;
- current identity/access/policy pass and denied cases remain denied;
- ingestion/index revisions and counts reconcile;
- exact source citations open only for authorized users;
- controlled current/historical/no-data/conflict tests pass;
- monitoring, backup and audit are active;
- backlog and break-glass activity reconciled;
- achieved RTO/RPO documented against approved objectives.

## Required evidence still missing

Before external go-live, attach:

1. approved RTO/RPO and retention matrix;
2. production backup schedule and encrypted/off-site inventory;
3. successful isolated restore report;
4. S3 recovery/versioning procedure for the selected provider;
5. secret/PKI recovery test;
6. derived-index rebuild timing and validation;
7. offline runbook access test;
8. named continuity and dependency owners.

## Related procedures

- `docs/OPERATIONS/backup-restore.md`
- `docs/OPERATIONS/immutable-docker-home-release.md`
- `docs/OPERATIONS/central-s3-object-storage.md`
- `docs/OPERATIONS/central-opensearch.md`
- `docs/deployment/external-environment-installation.md`
