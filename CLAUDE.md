# Project Agent Guide

## Mission

This repository builds and operates AI KnowledgeBase / AKL, a local AI Knowledge Library for controlled documents, ingestion, embeddings, Qdrant-backed RAG retrieval, citations, audit events, and dual GUI workflows.

The goal in this repository is:

- retrieval-first development with the local Chroma tooling
- disciplined updates to code and documentation
- safe local-first work that can later move through GitHub into deployment workflows defined by this repository

## Working Style

- Prefer retrieval-first workflow over broad file scanning.
- Before reading many files, use the available Chroma MCP tools:
  - `search_code` for implementation lookup
  - `search_docs` for documentation lookup
  - `search_all` when the location is unclear
  - `get_file_context` only after selecting a relevant hit
- If the index may be stale after meaningful repository changes, use `reindex_repo` when MCP tools are available, otherwise run:
  - `"/Users/voldzi/Documents/Development/18 2026/chromadb/tools/chroma-dev.sh" reindex --root .`
- This repository ships a repo-local Chroma override in `.chroma-dev.yaml`. The standard `chroma-dev.sh ... --root .` command auto-loads it; do not pass a separate config unless you intentionally want a different indexing scope.
- If retrieval tools are unavailable, Chroma is down, or the index returns no useful hits, fall back to direct repository inspection and state that retrieval was unavailable or insufficient.

## Source of Truth

- Product and local workflow overview: `README.md`
- Main documentation tree: `docs/`
- Architecture: `docs/ARCHITECTURE/`
- Deployment and runtime profiles: `docs/deployment/`
- RAG and retrieval behavior: `docs/rag/`
- Security model: `docs/security/`
- Operations and maintenance: `docs/OPERATIONS/`, `docs/maintenance/`
- QA and evaluation: `docs/qa/`, `docs/evaluation/`
- APIs and contracts: `docs/api/`, `docs/CONTRACTS/`
- UIs and integration notes: `docs/ui/`, `docs/integration/`
- Main implementation trees: `apps/`, `services/`, `scripts/`, `tools/`, `tests/`
- `CLAUDE.md` and `AGENTS.md` must stay aligned unless a platform-specific difference is intentional.

## Environment

- Local development is the primary workflow.
- Use Docker Desktop so the full AKL stack is visible and inspectable there.
- Local runtime configuration starts from `.env.example`.
- Main local stack start command:
  - `docker compose --env-file .env -f infra/docker-compose/docker-compose.dev.yml --profile ai up -d --build`
- Local production-like stack:
  - `docker compose --env-file .env.local-prod -f infra/docker-compose/docker-compose.dev.yml -f infra/docker-compose/docker-compose.local-prod.yml up -d --build`
- Important local URLs are listed in `README.md`.
- Do not invent infrastructure behavior outside what is defined in `README.md` and `docs/deployment/`.

## Permissions

- `git push` is allowed when the change has been intentionally prepared and the task requires publishing or syncing the branch.
- `ssh docker.home.cz` is allowed when the task requires access to the production or remote environment on that host.
- Do not invent or substitute `docker-codex`; the correct host name is `docker.home.cz`.
- Do not manipulate VPN, VLAN, firewall, or network segmentation.

## Documentation Rules

- Keep active documentation current-state, operational, and directly useful for the current repository state.
- When behavior changes, update the corresponding documentation in the same change.
- Prefer placing documentation in the most specific existing domain folder under `docs/` instead of creating ad hoc files in the root.
- Use these documentation homes by default:
  - architecture decisions and structure: `docs/ARCHITECTURE/`
  - deployment, environments, profiles, restore, backup: `docs/deployment/`
  - retrieval, ingestion, embeddings, citations: `docs/rag/`, `docs/ingestion/`, `docs/llm/`
  - security, authorization, auditability: `docs/security/`, `docs/governance/`
  - operations, status, release, code health: `docs/OPERATIONS/`, `docs/maintenance/`
  - APIs, contracts, UI, integration flows: `docs/api/`, `docs/CONTRACTS/`, `docs/ui/`, `docs/integration/`
  - test and product QA evidence: `docs/qa/`, `docs/evaluation/`
- Keep historical working notes, temporary analyses, and superseded implementation material out of the active top-level docs flow unless the repo already explicitly preserves them, for example `docs/CODEX_THREADS/`.

## Validation

- After code changes, run the smallest relevant verification first.
- For Chroma retrieval verification:
  - `"/Users/voldzi/Documents/Development/18 2026/chromadb/tools/chroma-dev.sh" search-all "<query>" --root . --limit 5`
- For baseline repository smoke checks, prefer the commands already documented in `README.md`, including:
  - `python3 scripts/phase_02_llm_gateway_smoke.py`
  - `python3 scripts/phase_02_controlled_document_smoke.py`
  - `python3 scripts/registry_postgres_smoke.py`
  - `python3 scripts/phase_03_docs_import_smoke.py`
  - `python3 scripts/phase_03_document_viewer_smoke.py`
  - `python3 scripts/phase_03_local_production_smoke.py`
  - `python3 scripts/phase_04_employee_assistant_smoke.py`
- If a check cannot be run, say so explicitly.

## Change Discipline

- Do not silently change config semantics, retrieval contracts, or deployment assumptions.
- Do not invent production behavior beyond what this repository documents.
- Update docs when API, config, deployment, security, RAG, ingestion, or QA behavior changes.
- Prefer narrow, verifiable changes over broad rewrites.

## Compact Instructions

- Preserve the current task goal, touched files, commands already run, verification status, and whether retrieval was available or insufficient.
