# AKB External Environment Operations Runbook

## Document control

| Field | Value |
| --- | --- |
| Status | Draft; operational acceptance pending per target site |
| Evidence baseline | AKB `6405261f9279031bb090a85930fad61397fafe47`, 2026-08-26 |
| Owner | AKB operations owner |
| Approvers | Platform, security, database and service owners |
| Classification | Internal |

This runbook is a portable operating model. Site-specific commands, host names,
alert destinations and on-call contacts belong in an approved local appendix.
The current `docker.home.cz` immutable release runbook is evidence for the
existing site, not a universal host layout.

## Operating principles

1. Check non-destructively before changing anything.
2. Health is process liveness; readiness proves the service can safely serve
   its contract.
3. Identity, policy, source completeness and evidence failures stay fail closed.
4. Canonical data is restored before derived indexes.
5. Deploy only an already verified immutable SHA.
6. Never expose secrets, document content, prompts or answers in an incident
   ticket, command transcript or monitoring label.
7. Every state-changing action records operator, time, release, reason,
   expected outcome, rollback boundary and correlation ID where available.

## Daily control

| Check | Expected result | Escalate when |
| --- | --- | --- |
| Public `/akb/api/health` | HTTP 200, process healthy | Non-200 for more than the alert grace period |
| Public `/akb/api/ready` | HTTP 200 and required dependencies ready | Any required dependency is degraded/not ready |
| Registry health/readiness | Database reachable, schema current, writer identity expected | DB identity mismatch, migration drift, pool exhaustion |
| Web/chat health | Correct release and session store reachable | login loop, wrong origin, stale identity or callback failure |
| Ingestion | Queue/work store writable; no growing failed/stuck set | jobs remain running beyond profile timeout or storage is unavailable |
| Qdrant/OpenSearch | Enabled indexes reachable with expected revision/count range | alias/collection missing, source-version drift, authorization fields absent |
| S3 | Bounded head/read probe succeeds | timeout, hash/size mismatch or credential denial |
| Malware scanner | Internal scan probe succeeds within limit | unavailable/timeout; uploads must remain blocked |
| LLM/embedding provider | Ready with pinned models/revisions | model missing, latency budget exceeded, output contract invalid |
| STRATOS Access/Policy | Projection and decision probes succeed | unavailable, stale or invalid response; protected operations must deny |
| Director Copilot manifests | Exact contract/revision/hash accepted | drift, wrong audience or missing route scope |
| OTLP/monitoring | Services visible; redaction rules active | trace gap, target down, sensitive attribute observed |
| Backup jobs | Last run successful within policy | missed run, checksum failure, retention/off-site failure |
| Capacity | Disk, DB, S3, index and queue below thresholds | site-defined warning/critical thresholds crossed |

Use correlation IDs to connect web, Registry, RAG, Ingestion, STRATOS and
source-tool events. Do not use document text or user prompts as correlation
labels.

## Start and stop

### Controlled start

Prerequisites:

- approved release and configuration are present;
- DNS, time, PKI, secrets and external data services are ready;
- no deployment or restore lock is active;
- database writer identity and schema are known.

Action:

1. Start canonical dependencies and Registry.
2. Confirm Registry health and schema before starting writers.
3. Start LLM Gateway, Ingestion and RAG.
4. Start Governance/Evaluation, platform status, web/chat and ingress.
5. Run public health/readiness and narrow authorized smokes.

Expected result: all services report the same release identity and required
dependencies are ready.

Rollback: stop newly started application services and preserve logs/state. Do
not delete data or switch to mock dependencies.

### Controlled stop

Prerequisites: approved maintenance window and confirmed backup/rollback point.

Action:

1. Stop accepting uploads and new long-running jobs.
2. Allow bounded in-flight work to finish or mark it recoverable.
3. Stop web/chat, governance/evaluation, RAG/ingestion/LLM, then Registry.
4. Stop stateful dependencies only when the owning platform procedure requires
   it.

Expected result: no active write is silently abandoned; the Registry attempt
state allows reconciliation after restart.

## Incident playbooks

### Login, SSO or session failure

Symptoms: redirect loop, callback error, origin forbidden, wrong user retained,
or immediate logout.

1. Verify public URL, base path, reverse-proxy headers and exact OIDC redirect.
2. Verify host time and issuer/JWKS reachability.
3. Check that the browser cookie is scoped to the intended AKB path/domain and
   that server-side session secrets are mounted.
4. Compare the current STRATOS user with the AKB session validation event.
5. Revoke only the affected local session if needed; do not inspect/decrypt
   tokens in logs.

Expected: an existing central SSO session can establish the correct AKB user
without a second password prompt; a user switch replaces the old AKB session.

Rollback/escalation: restore the previous exact web image/config if the release
introduced the issue; involve Keycloak only after proving the AKB callback and
origin settings are correct.

### STRATOS Access or Policy unavailable

1. Confirm the dependency and correlation ID from readiness/audit.
2. Stop repeated user retries if they create load.
3. Keep document reads, live tools and state-changing operations denied.
4. Preserve queued ingestion work without publishing it.
5. Restore Access/Policy, then revalidate authorization and reconcile callbacks.

Prohibited: static claim fallback, broad local role, cached allow decision or
document RAG as a replacement for unavailable live data.

### Object storage unavailable or inconsistent

1. Stop confirmation of new uploads; keep them quarantined/pending.
2. Verify endpoint, CA, credential-file readability, bucket and path style.
3. Compare Registry size/SHA-256 with S3 head/read for a bounded authorized
   object; never print its contents or key when the incident audience is broad.
4. Restore storage service or credential, then replay idempotent operations.

Rollback: use a verified legacy read path only during an approved migration
window. Never rewrite immutable URIs or confirm an object that was not stored.

### Malware scanner unavailable

Uploads and legacy rescans remain blocked/pending. Verify DNS/network and the
`clamd` timeout/limits. After recovery, retry a bounded safe fixture; do not
mark prior timeouts clean. A `FOUND` result remains quarantined and auditable.

### Ingestion backlog or stuck job

1. Inspect Registry attempt state and sanitized job metadata.
2. Check work-volume capacity, source readability, parser/OCR, rendition,
   embedding and both enabled indexers.
3. Retry only an idempotent job/version pair. Do not create a new document or
   change `current_version` to bypass the failure.
4. Reconcile completed index writes with Registry before setting `INDEXED`.

Current limitation: production uses inline processing with a file-backed job
store. There is no documented durable external queue or DLQ. Treat work-volume
loss or multi-worker scheduling as a P1 incident until that architecture is
replaced and accepted.

### Qdrant or OpenSearch unavailable

- Keep canonical document/version data available where policy allows.
- Mark RAG/Intelligence not ready or degraded according to the required index.
- Never answer from stale unauthorized chunks.
- Restore Qdrant/OpenSearch or rebuild from canonical authorized data using the
  recorded embedding/index revision.
- Compare document/version/chunk counts and policy metadata before reopening.

Do not copy an OpenSearch Lucene volume across incompatible releases.

### Model or embedding service unavailable

- Upload persistence may continue only up to the point that does not claim
  successful indexing.
- RAG returns an explicit unavailable/insufficient state.
- Controlled rules and deterministic live data may continue only if their own
  dependencies and evidence are complete.
- Do not substitute an unapproved model or silently change embedding dimension.

### Director Copilot source or manifest failure

1. Read the machine reason: transport, identity, policy, `no_data`, `partial`,
   cursor completeness, manifest drift or evidence failure.
2. Verify exact manifest revision/hash and single target audience.
3. Keep each source result separate; retry only within the documented budget.
4. Do not replace missing business data with documents.

Escalate source implementation errors to the owning Budget, ProjectFlow or
ArchFlow team with a sanitized request shape, contract revision, correlation ID
and expected/actual status. Do not send tokens or business payloads.

### Database unavailable or wrong writer

1. Stop Registry writers and deployment/migration activity.
2. Verify the configured gateway, `current_database()` and `current_user()`
   through the approved tool image.
3. Restore HA routing or database service under the database owner's procedure.
4. Re-run readiness and session/document smokes.

Never point directly at an arbitrary database node, enable schema auto-create,
run ad-hoc downgrade, or delete a migration row.

## Maintenance

### Release

Use the exact-SHA procedure in the installation guide and the site deployment
appendix. One failed immutable SHA is never reused. Verify same-SHA runtime,
health/readiness, authorization and rollback record.

### Index maintenance

Rebuild derived indexes from Registry-authorized immutable source versions.
Record collection/index revision, embedding model/dimensions, counts, failures
and release SHA. Keep the old alias/collection until the replacement passes
authorization and citation tests.

### Credential or certificate rotation

Rotate one boundary at a time with overlap only where the protocol supports it.
Session encryption key rotation may intentionally invalidate sessions that
cannot be decrypted. After rotation, verify negative use of the old credential
and ensure no secret entered logs, audit or deployment records.

### Retention

Apply approved retention separately to conversations, audit metadata,
evaluation artifacts, upload quarantine, rendition cache, release images and
backups. Immutable controlled-document history and required audit evidence are
not ordinary cache and must not be pruned by generic cleanup jobs.

## Monitoring and escalation record

A production site must provide dashboards/alerts for request latency and error
rate, dependency readiness, login/session failures, Registry DB, upload/scan,
ingestion backlog, Qdrant/OpenSearch, model latency, Director Copilot source
states, storage capacity, backup age and restore-test age.

Every escalation should contain:

- UTC and local time plus timezone;
- environment and exact release SHA;
- affected operation and safe machine reason;
- health/readiness state;
- anonymized correlation IDs;
- dependency owner and current mitigation;
- confirmation that no token, secret, prompt, answer or document content is
  attached.

## Prohibited shortcuts

- mock authentication or static roles in production;
- stale allow decisions during Access/Policy outage;
- direct browser access to internal services or stores;
- production builds on the target host as the first image verification;
- mutable image tags or reused burned SHA;
- ad-hoc database migration/downgrade;
- deleting volumes, objects, indexes, audit or backups to clear an error;
- marking unscanned, unstored or partially indexed content ready;
- document RAG fallback for missing live data;
- logging or copying protected payloads into incident systems.

## Related runbooks

- `docs/runbook.md`
- `docs/OPERATIONS/immutable-docker-home-release.md`
- `docs/OPERATIONS/central-s3-object-storage.md`
- `docs/OPERATIONS/central-opensearch.md`
- `docs/OPERATIONS/disaster-recovery.md`
