# AKB Documentation Suite For External Environments

## Document control

| Field | Value |
| --- | --- |
| Status | Draft for owner and security approval |
| Evidence date | 2026-08-26 |
| AKB source baseline | `6405261f9279031bb090a85930fad61397fafe47` |
| Owner | AKB application owner |
| Required approvers | AKB product owner, platform owner, security owner, data owner |
| Classification | Internal |
| Proposed review interval | 90 days and after every architecture, identity, storage, or DR change |
| Supersedes | No single document; this is the role-based entry point over the existing detailed documentation |

This suite is the portable entry point for installing and operating AKB outside
the current organization. It does not replace detailed service contracts or the
site-specific production release runbook. Each material statement is classified
as one of:

- **Current verified**: supported by the inspected AKB source or configuration.
- **Approved target**: required by the supplied STRATOS integration guide, but
  still requires site-specific implementation or acceptance.
- **Open decision**: no approved value or verified implementation exists.

## Authoritative inputs

| Input | Evidence |
| --- | --- |
| AKB repository | Source baseline above, inspected in a clean worktree |
| Documentation task | STRATOS working-tree file `docs/62_AKB_DOCUMENTATION_SUITE_TASK.md`, SHA-256 `178f765ef6a66299058828674b6f2c532c27743af172f75ad7ce5d791f450c68` |
| Integration guide | STRATOS working-tree file `docs/60_STRATOS_AKB_INTEGRATION_AND_SECURITY_GUIDE.md`, SHA-256 `274a444e9b4259d8d1ad36c59d7a8a7a47d72d1d841af3388a4852df330c96bb` |
| Guide verification reference | STRATOS revision `1444f83021a7f33ffd776a87ae14b62f61071be1`, as declared by the guide |

The two STRATOS inputs were uncommitted working-tree documents when inspected.
Their hashes are recorded so a later review can detect drift. They are requirements
inputs, not proof that a corresponding STRATOS release is deployed.

## Supported modes

| Mode | Status | Meaning |
| --- | --- | --- |
| Local AKB development | **Current verified** | The development Compose profile can run local PostgreSQL, object storage, Keycloak, search, vectors, models, web and backend services with development configuration. It is not a production security profile. |
| AKB integrated with STRATOS | **Current verified** | This is the current production architecture. Keycloak provides identity, STRATOS provides the current access projection and Information Policy, and AKB owns documents, versions, ingestion, indexes, citations and document audit. |
| Autonomous production AKB | **Open decision** | Not currently supported as a safe production profile. Production code requires the STRATOS access projection and policy endpoints. A native identity, capability, scope and policy authority plus conformance tests must exist before this mode can be offered. |
| STRATOS without AKB | **Approved target owned by STRATOS** | STRATOS must fail fast for AKB-dependent document functions while preserving its own unrelated business operations. This repository can test the integration boundary but does not implement STRATOS behavior. |

Disabling callbacks, substituting static OIDC claims, or using mock authorization
does not convert the current implementation into production standalone AKB.

## Documentation map

| Audience | Entry point | Purpose |
| --- | --- | --- |
| Everyone | This document | Scope, evidence, mode matrix and known gaps |
| Infrastructure architect | [External environment architecture](../deployment/external-environment-architecture.md) | Components, networks, data, identity, API and dependency boundaries |
| Installer and release operator | [External environment installation](../deployment/external-environment-installation.md) | Clean install, configuration, upgrade, immutable deployment and rollback |
| Operations | [External environment runbook](../OPERATIONS/external-environment-runbook.md) | Health, readiness, incidents, maintenance and escalation |
| AKB administrators | [Application administration](../OPERATIONS/application-administration.md) | Access, content, workflow, service identities and audit |
| End users | [User manual](../ui/user-manual.md) | Role-based navigation, documents, chat, citations and common states |
| Security and integration owners | [Standalone and STRATOS integration security](../security/standalone-and-stratos-integration.md) | Trust boundaries, identities, policy, network flows and fail-closed behavior |
| Continuity and recovery | [Disaster recovery](../OPERATIONS/disaster-recovery.md) | Backup ownership, restore order, outage behavior and recovery tests |
| Documentation owners | [Documentation lifecycle](../governance/documentation-lifecycle.md) | Owners, approvals, publication, ACL tests, review and supersession |

Existing detailed documentation remains authoritative for its specific domain.
In particular, use `openapi/openapi.json`, `docs/security/access-information-policy-v2.md`,
`docs/OPERATIONS/immutable-docker-home-release.md`,
`docs/OPERATIONS/central-s3-object-storage.md`, and service-local README files.

## Evidence matrix

| Area or statement | State | Evidence | Owner | Last verification | Gap or decision |
| --- | --- | --- | --- | --- | --- |
| Registry is the metadata, version, workflow and authorization authority | Current verified | `services/registry-api`, `docs/architecture.md` | AKB | 2026-08-26 | None identified |
| Source binaries use a native S3 adapter in production | Current verified | `apps/web/src/lib/storage/object-storage.ts`, `services/ingestion-service/app/object_storage.py` | AKB/platform | 2026-08-26 | Target site must supply S3-compatible storage, TLS and least-privilege credentials |
| Current site uses central SeaweedFS S3 | Current verified for configuration | `infra/docker-compose/docker-home.env.example`, `docs/OPERATIONS/central-s3-object-storage.md` | Current platform | 2026-08-26 | Runtime reachability was not verified in this documentation run |
| Uploads are scanned before promotion | Current verified | `apps/web/src/lib/upload/content-security.ts`, Document Intake contract | AKB/security | 2026-08-26 | Target site must supply an internal `clamd` endpoint or an approved equivalent adapter |
| PostgreSQL holds canonical registry and session state | Current verified | Registry models/migrations and production Compose | AKB/database owner | 2026-08-26 | Backup schedule and restore evidence are site-owned |
| Qdrant and OpenSearch are derived indexes | Current verified | Ingestion and RAG configuration; architecture docs | AKB/search owner | 2026-08-26 | Rebuild procedure must be rehearsed per target site |
| Browser tokens are replaced by an opaque server-side session | Current verified | session implementation and ADR 0014 | AKB/security | 2026-08-26 | Target secret storage and rotation process required |
| Production access is based on fresh STRATOS projection and policy | Current verified | web/Registry production configuration and security tests | STRATOS + AKB | 2026-08-26 | Autonomous policy authority does not yet exist |
| Director Copilot uses read-only, audience-bound domain tools | Current verified in code | Director Copilot V2 implementation and pinned manifests | AKB + source apps | 2026-08-26 | Every target deployment needs joint contract and negative acceptance |
| Ingestion has a durable external queue and DLQ | Open decision | Production configuration currently requires inline processing with a file-backed job store | AKB/platform | 2026-08-26 | Implement a durable worker/queue before claiming HA ingestion |
| Current production release SHA and container state | Not verified | `docker.home.cz` DNS was unavailable and public health endpoints returned HTTP 502 during this run | Current platform | 2026-08-26 | Re-run runtime inventory from the target network before approval |
| Production backup schedule is active | Not verified | No scheduler or backup repository evidence was available in the inspected source | Platform/data owner | 2026-08-26 | Record schedule, retention, encryption and off-site copy |
| Production restore has passed in isolation | Not verified | No signed restore report was found | Platform/data owner | 2026-08-26 | Mandatory before external go-live |
| RTO and RPO are approved | Open decision | No approved values found | Business + platform owner | 2026-08-26 | Define per data class before capacity and DR approval |
| Images have SBOM and cryptographic signature verification | Open decision | Exact-SHA labels and provenance checks exist; no SBOM/signature gate was found | Release/security owner | 2026-08-26 | Add supply-chain policy or explicitly accept the gap |
| Production autonomous AKB is supported | Open decision | Production Registry/web/RAG require STRATOS identity and policy services | AKB product/security | 2026-08-26 | Implement and test a native authority before advertising this mode |
| Critical runbooks are available offline | Open decision | Repository copies exist; no controlled offline bundle evidence was found | Continuity owner | 2026-08-26 | Create, encrypt, distribute and test an offline bundle |

## Required decisions before a foreign installation

1. Select integrated production or postpone the deployment. Autonomous
   production AKB is not an installation checkbox today.
2. Approve VM or cluster sizing from a measured pilot; this repository does not
   define a universal CPU/RAM minimum.
3. Approve private DNS names, gateway, certificates, VLANs and firewall flows.
4. Name owners for Keycloak, STRATOS Access/Policy, PostgreSQL, S3, Qdrant,
   OpenSearch, models, antivirus, monitoring, backup and incident response.
5. Approve RTO, RPO, retention, classification and data-residency requirements.
6. Approve the secret manager and rotation process. Secret values never belong
   in Git, Compose, examples, logs or this documentation.
7. Decide whether web and chat use one public gateway or separate FQDNs while
   retaining separate OIDC clients and server-side sessions.
8. Approve an immutable image registry and whether SBOM/signature enforcement
   is required before go-live.

## Acceptance and publication status

This documentation change prepares repository documentation only. It does not:

- modify production, STRATOS, Keycloak, DNS, firewall or secrets;
- prove a clean installation or restore in an isolated target environment;
- publish these files as controlled AKB documents;
- approve ACLs, owners, review dates, RTO, RPO or target infrastructure.

Publication as controlled AKB content starts only after owner/security approval,
immutable versioning, ingestion status `INDEXED`, citation verification and the
positive/negative ACL tests defined in the documentation lifecycle guide.
