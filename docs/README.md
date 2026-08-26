# AKL Documentation Index

This is the canonical entry point for repository documentation.

Use `README.md` in the repository root for local setup and runtime commands. Use this file to navigate the active documentation set under `docs/`.

## External Installation And Operations Suite

For a deployment outside the current organization, start with
`reference/external-deployment-documentation-suite.md`. It records the verified
implementation baseline, separates integrated production from local development
and the currently unsupported autonomous production mode, and links the
role-based architecture, installation, operations, administration, user,
security, disaster-recovery and documentation-governance guides.

The suite uses placeholders for site-owned topology and secrets. Do not copy
current `*.home.cz` values or the `docker.home.cz` release layout as universal
installation defaults.

## Flat Standard Documents

The active AKB documentation follows the central application skeleton standard.
Start with these flat documents for repository-wide orientation:

| Standard topic | AKB file |
| --- | --- |
| Architecture | `architecture.md` |
| API | `api.md` |
| Security | `security.md` |
| Operations | `operations.md` |
| Observability | `observability.md` |
| Central OpenSearch operations | `OPERATIONS/central-opensearch.md` |
| Runbook | `runbook.md` |
| ADRs | `adr/` |
| Archive | `archive/` |

Detailed domain documents remain under the folders listed below and are linked
from the flat standard documents.

## Start Here

1. Product and local workflow:
   - `../README.md`
2. Architecture and service boundaries:
   - `architecture.md`
   - `ARCHITECTURE/01_ARCHITEKTURA_DISTRIBUOVANYCH_SLUZEB.md`
   - `ARCHITECTURE/02_SERVICE_BOUNDARIES.md`
3. API and security contracts:
   - `api.md`
   - `security.md`
   - `security/access-information-policy-v2.md`
   - `CONTRACTS/03_API_KONTRAKTY_OPENAPI.md`
   - `CONTRACTS/05_DATOVE_KONTRAKTY.md`
   - `CONTRACTS/06_SECURITY_AUTHZ_MODEL.md`
4. Operations and observability:
   - `operations.md`
   - `observability.md`
   - `runbook.md`
   - `OPERATIONS/immutable-docker-home-release.md`
   - `OPERATIONS/external-environment-runbook.md`
   - `OPERATIONS/disaster-recovery.md`
5. STRATOS shared integration:
   - `29_STRATOS_SHARED_LIBRARIES.md`
   - `ui/stratos-ui-adapter.md`
   - `qa/stratos-shell-qa.md`
   - `integration/STRATOS_EXTERNAL_DOCUMENTS_API.md`
   - `integration/STRATOS_OKF_PROFILE.md`
   - `integration/STRATOS_IT_MANAGEMENT_PROFILE.md`
6. Intelligence Workbench:
   - `intelligence/workbench.md`
   - `evaluation/retrieval-quality-lab.md`
7. Current implementation status:
   - `maintenance/project-status.md`
   - `qa/access-information-policy-v2-impact-report.md`
8. Director Copilot implementation and verification:
   - `qa/director-copilot-akb-foundation.md`
   - `integration/PROJECTFLOW_FREE_FORM_COPILOT_HANDOFF.md`
   - `integration/DIRECTOR_COPILOT_V2_IMPLEMENTATION.md`
   - `qa/projectflow-free-form-copilot.md`
9. External deployment and controlled documentation suite:
   - `reference/external-deployment-documentation-suite.md`
   - `deployment/external-environment-architecture.md`
   - `deployment/external-environment-installation.md`
   - `OPERATIONS/application-administration.md`
   - `ui/user-manual.md`
   - `security/standalone-and-stratos-integration.md`
   - `governance/documentation-lifecycle.md`

## Active Documentation Homes

- Architecture:
  - `ARCHITECTURE/`
- Deployment and runtime profiles:
  - `deployment/`
- Retrieval, ingestion, embeddings, citations:
  - `rag/`
  - `ingestion/`
  - `ingestion/official-public-sources.md`
  - `llm/`
- Security, authorization, governance:
  - `security/`
  - `governance/`
- Operations and maintenance:
  - `OPERATIONS/`
  - `maintenance/`
- APIs, contracts, UI, integration:
  - `api.md`
  - `api/README.md`
  - `CONTRACTS/`
  - `ui/`
  - `integration/README.md`
- Intelligence and analytical workbench:
  - `intelligence/`
- QA and evaluation:
  - `qa/`
  - `evaluation/`

## Bootstrap And Codex Thread Material

Repository bootstrap material and Codex-thread planning documents are preserved separately from the active domain documentation flow:

- `CODEX_THREADS/README.md`
- `CODEX_THREADS/bootstrap/`

These files are still valid reference material, but they are not the main current-state navigation layer for day-to-day product, runtime, and operations work.
