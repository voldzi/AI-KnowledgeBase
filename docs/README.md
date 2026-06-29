# AKL Documentation Index

This is the canonical entry point for repository documentation.

Use `README.md` in the repository root for local setup and runtime commands. Use this file to navigate the active documentation set under `docs/`.

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
   - `CONTRACTS/03_API_KONTRAKTY_OPENAPI.md`
   - `CONTRACTS/05_DATOVE_KONTRAKTY.md`
   - `CONTRACTS/06_SECURITY_AUTHZ_MODEL.md`
4. Operations and observability:
   - `operations.md`
   - `observability.md`
   - `runbook.md`
5. STRATOS shared integration:
   - `29_STRATOS_SHARED_LIBRARIES.md`
   - `integration/STRATOS_EXTERNAL_DOCUMENTS_API.md`
   - `integration/STRATOS_OKF_PROFILE.md`
   - `integration/STRATOS_IT_MANAGEMENT_PROFILE.md`
6. Current implementation status:
   - `maintenance/project-status.md`

## Active Documentation Homes

- Architecture:
  - `ARCHITECTURE/`
- Deployment and runtime profiles:
  - `deployment/`
- Retrieval, ingestion, embeddings, citations:
  - `rag/`
  - `ingestion/`
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
- QA and evaluation:
  - `qa/`
  - `evaluation/`

## Bootstrap And Codex Thread Material

Repository bootstrap material and Codex-thread planning documents are preserved separately from the active domain documentation flow:

- `CODEX_THREADS/README.md`
- `CODEX_THREADS/bootstrap/`

These files are still valid reference material, but they are not the main current-state navigation layer for day-to-day product, runtime, and operations work.
