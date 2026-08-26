# AKB External Environment Installation And Deployment

## Document control

| Field | Value |
| --- | --- |
| Status | Draft installation procedure; clean-install evidence pending |
| Evidence baseline | AKB `6405261f9279031bb090a85930fad61397fafe47`, 2026-08-26 |
| Owner | AKB release owner |
| Approvers | Platform, security, database and integration owners |
| Classification | Internal |

## Installation gate

Before provisioning anything, select the deployment mode:

- **Integrated production** is the current supported production mode.
- **Local development** is supported for development and tests only.
- **Autonomous production AKB** is not currently supported. Stop and resolve
  the native identity/policy authority gap instead of enabling mock auth.

This document uses placeholders such as `<AKB_PUBLIC_FQDN>` and
`<POSTGRES_WRITER_ENDPOINT>`. The installer must replace them in a site-owned,
approved configuration outside Git. Do not copy current-site hosts, passwords
or tokens from example files.

## Prerequisites

### Required decisions

- approved public and private DNS names;
- trusted TLS/PKI chain and certificate renewal owner;
- VM/container platform sizing based on a representative pilot;
- backup, retention, RTO and RPO policy;
- immutable image registry and release operator;
- secret manager or protected host-file mechanism;
- Keycloak realm, browser clients, service clients, audiences and route grants;
- STRATOS Access/Policy and optional Director Copilot endpoint ownership;
- PostgreSQL writer endpoint, S3 bucket, Qdrant, OpenSearch, model gateway,
  malware scanner and OTLP endpoint;
- maintenance window and tested rollback path.

### Host requirements

- synchronized time and working forward/reverse DNS;
- supported Linux container host with Docker Compose v2 or an approved
  equivalent deployment adapter;
- sufficient local disk for images, temporary quarantine, ingestion work,
  renditions and release backups;
- private network reachability only to approved dependencies;
- operator access separated from application runtime identities;
- no public exposure of internal service or data-store ports.

The repository does not define a universal CPU, RAM or disk minimum. Capture
the pilot workload and sizing decision in the site evidence register.

## Immutable release inputs

Every production installation must bind all runtime services to one full Git
SHA and retain that identity in image labels and the deployment record.

Required release evidence:

1. source full SHA and trusted branch/ref;
2. successful trusted CI for that SHA;
3. affected-service plan and exact production Dockerfiles/build contexts;
4. content-addressed image IDs or immutable tags;
5. dependency and secret-file preflight without printing values;
6. Registry database backup and writable-primary verification;
7. migration head and rollback/forward-fix decision;
8. post-deploy health, readiness and narrow authorized smoke;
9. durable deployment record and rollback evidence.

**Current verified:** the AKB immutable release scripts enforce exact-SHA image
labels, database gates, release locking and a burned-SHA boundary. The detailed
current-site implementation is in
`docs/OPERATIONS/immutable-docker-home-release.md`.

**Open decision:** repository evidence currently does not prove SBOM generation
or cryptographic image-signature verification. A foreign site must either add
and enforce those controls or explicitly accept the supply-chain gap.

## Configuration inventory

Store values in a site-owned mode-`0600` environment/secrets mechanism. The
following groups are contract names, not recommended literal values.

| Area | Representative keys | Rule |
| --- | --- | --- |
| Release identity | `AKL_RELEASE_GIT_URL`, `AKL_RELEASE_TRUSTED_REF`, `AKL_IMAGE_TAG`, `AKL_SERVICE_VERSION` | Full immutable SHA; never a mutable default for production |
| Public routes | `AKL_WEB_PUBLIC_BASE_URL`, `AKL_CHAT_WEB_PUBLIC_BASE_URL`, `AKL_WEB_BASE_PATH` | Must match proxy, cookie path, OIDC redirects and origin checks exactly |
| OIDC | `AKL_OIDC_ISSUER`, `AKL_OIDC_AUDIENCE`, web/chat client IDs and scopes | Production uses OIDC; exact issuer/audience/client binding |
| Sessions | session secret, encryption-key file, store-secret file, TTLs | Separate random secrets outside Git; 90-day absolute, 30-day idle, 15-minute identity validation maximums |
| Access and policy | STRATOS auth-me, policy binding/decision and resource/publication URLs | Required in integrated production; unavailable means deny |
| PostgreSQL | Registry database URL and expected host/database/user | Point to approved writer gateway; verify runtime identity before migration |
| Object storage | `AKL_OBJECT_STORAGE_MODE`, S3 endpoint/bucket/region/path style, credential files | Production uses native S3; no FUSE mount as the primary adapter |
| Malware scanning | `STRATOS_CONTENT_SECURITY_*` | Required and fail closed; scanner is an internal dependency, not public API |
| Retrieval | Qdrant collection/dimensions, OpenSearch endpoints/index/CA/credentials | Embedding dimensions and index revision must match |
| Models | LLM provider/model map, caller identity, timeout/concurrency | Disable arbitrary pull/delete in production |
| Ingestion | extraction/rendition profiles, work root, authorization secret, service identity | Current production inline processing is a known reliability constraint |
| Director Copilot | enabled flag, token URL, service client, source base URLs, pinned manifest values | Optional; remains disabled until joint contract acceptance |
| Observability | OTLP endpoint/protocol/resource attributes/sampling | Sanitize URLs and never export protected payloads |
| Retention/rate limits | conversation/audit retention, upload/request limits, concurrency | Approve per site; do not weaken authorization or evidence gates for throughput |

Use `.env.example` for development semantics and
`infra/docker-compose/docker-home.env.example` only as a current-site reference.
Neither file is a ready-to-use foreign production configuration.

## Clean installation sequence

### 1. Prepare external authorities

1. Create the PostgreSQL database and least-privilege owner/runtime identities.
2. Create the S3 bucket and separate least-privilege AKB credentials.
3. Prepare Qdrant and OpenSearch collections/index aliases with approved TLS
   and reader/writer identities.
4. Prepare the internal malware scanner and validate `INSTREAM` limits.
5. Prepare the model/embedding gateway and pin model revisions.
6. Prepare the central OTLP endpoint and sanitized processing rules.
7. Configure Keycloak browser clients and service clients. Browser, ingestion,
   RAG, LLM, governance and Director Copilot identities must remain separate.
8. Configure STRATOS access projection, Information Policy and resource
   registration callbacks for the AKB application.

Expected result: each dependency is reachable only from the intended AKB
boundary and exposes no secret in command output.

Rollback: remove only newly created empty resources and identities according to
the site change record. Do not delete shared services or pre-existing data.

### 2. Prepare host and release directory

1. Create operator-owned release, state, backup and secret directories with
   restrictive permissions.
2. Install the target-site CA chain into the host and required images.
3. Load the exact release images and any content-addressed database tool image.
4. Render the production Compose configuration with a non-secret validation
   process. Reject unresolved variables, mutable image fallbacks, host-port
   exposure of internal services and writable secret mounts.
5. Record disk free space, image IDs and the target full SHA.

### 3. Initialize canonical stores

1. Run Registry migrations from the exact target Registry image against the
   verified writer database. Do not enable auto-create schema in production.
2. Verify the migration head and empty-database constraints.
3. Verify S3 `put/head/read/hash/list/delete` with a disposable test object.
4. Initialize Qdrant/OpenSearch through supported application procedures; do
   not copy indexes from an unrelated environment.
5. Verify that no source document is considered indexed before Registry and
   both enabled indexers confirm the matching immutable version.

### 4. Start in dependency order

Recommended order:

1. DNS, NTP, PKI, secret delivery and network policy;
2. Keycloak and STRATOS Access/Policy;
3. PostgreSQL, S3, Qdrant, OpenSearch, malware scanner and model gateway;
4. Registry API;
5. LLM Gateway;
6. Ingestion and RAG;
7. Governance and Evaluation;
8. platform status, web/chat and public gateway.

Do not use process liveness as go-live proof. Require service health plus
dependency-aware readiness.

### 5. Bootstrap administration

The first administrative user is provisioned through the approved central
identity/access process. Do not insert a local admin row or add a broad static
OIDC role as a shortcut. Verify that the current projection grants only the
approved AKB administration capability and scope, then confirm the server-side
route guard and Registry action authorization.

### 6. Acceptance

At minimum verify:

- exact deployed SHA and image identity for every affected service;
- public health and dependency-aware readiness;
- OIDC login, silent SSO, logout and server-side session revocation;
- positive and denied document read for two different classifications/scopes;
- clean upload, malware rejection and scanner-outage fail-closed behavior;
- ingestion to `INDEXED`, hybrid retrieval and exact source citation;
- historical version/citation authorization;
- service client wrong audience/role/client/route denials;
- Access/Policy outage denial;
- object storage, Registry, Qdrant, OpenSearch and model outage behavior;
- backup creation and isolated restore rehearsal;
- monitoring targets and redaction checks;
- Director Copilot positive and negative contract suite when enabled.

No foreign clean installation has been executed as part of this documentation
change. Go-live remains blocked until the target site attaches evidence for the
above checks.

## Upgrade procedure

1. Compare candidate SHA with the current verified production SHA and compute
   affected services.
2. Run focused tests, then exact production image builds for every affected
   service.
3. Run all required CI/security/contract gates on the final candidate once.
4. Capture Registry backup and pre-migration identity checks.
5. Deploy the exact candidate through the durable immutable orchestrator.
6. Verify current release marker, containers, health/readiness and narrow
   authorized workflows.
7. Rebuild derived indexes only when their contract/revision requires it.

If an immutable release SHA is burned after a failed deployment boundary,
prepare a reviewed descendant. Never reuse the failed SHA or mutate its images.

## Rollback and forward fix

- Before a database migration boundary, restore the exact verified predecessor
  only through the immutable release procedure.
- After an incompatible migration, prefer a reviewed forward fix. Do not run an
  ad-hoc downgrade or point old code at a new schema.
- Object-storage mode rollback changes configuration only after verifying that
  the legacy source remains complete; immutable publication URIs are not
  rewritten.
- Never delete documents, buckets, Qdrant collections, OpenSearch aliases,
  volumes, audit rows or backups as a rollback shortcut.
- Record the decision, current/target SHA, correlation IDs and resulting state.

## Related procedures

- `docs/maintenance/release-process.md`
- `docs/OPERATIONS/immutable-docker-home-release.md`
- `docs/OPERATIONS/central-s3-object-storage.md`
- `docs/OPERATIONS/central-opensearch.md`
- `docs/security/standalone-and-stratos-integration.md`
- `docs/OPERATIONS/disaster-recovery.md`
