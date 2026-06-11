# Project Agent Guide

## Mission

This repository builds and operates AI KnowledgeBase / AKB, a local knowledge base for controlled documents, ingestion, embeddings, Qdrant-backed RAG retrieval, citations, audit events, and STRATOS workflows.

The product-facing name is **AKB**. Existing `AKL_*` environment variables, service ids, bucket names, and selected internal package names are technical compatibility prefixes unless a migration explicitly changes them.

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
- If MCP tools are not exposed as native tools in the current agent session, use the CLI fallback:
  - `"/Users/voldzi/Documents/Development/18 2026/chromadb/tools/chroma-dev.sh" search-all "<query>" --root . --limit 5`
  - then read only the selected files or ranges directly
- CLI fallback is still compliant retrieval-first behavior. Mention it once if relevant; do not repeat it as a blocker when retrieval succeeded.
- If the index may be stale after meaningful repository changes, use `reindex_repo` when MCP tools are available, otherwise run:
  - `"/Users/voldzi/Documents/Development/18 2026/chromadb/tools/chroma-dev.sh" reindex --root .`
- This repository ships a repo-local Chroma override in `.chroma-dev.yaml`. The standard `chroma-dev.sh ... --root .` command auto-loads it; do not pass a separate config unless you intentionally want a different indexing scope.
- If retrieval tools are unavailable, Chroma is down, or the index returns no useful hits, fall back to direct repository inspection and state that retrieval was unavailable or insufficient.
- Never print unredacted secrets, passwords, bearer tokens, session secrets, private keys, or full connection strings from env files or production commands. Prefer key names plus redacted values.

## Source of Truth

- Product and local workflow overview: `README.md`
- Flat standard documentation entry points: `docs/architecture.md`, `docs/api.md`, `docs/security.md`, `docs/operations.md`, `docs/observability.md`, `docs/runbook.md`
- Main documentation tree: `docs/`
- Repository-level OpenAPI contract: `openapi/openapi.json`
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
- The correct production host name is `docker.home.cz`.
- Do not manipulate VPN, VLAN, firewall, or network segmentation.
- On `docker.home.cz`, verify deployment state with non-destructive checks first: git HEAD, `docker compose ps`, service `/health`, public `/akb/api/health`, and a narrow assistant/source smoke before changing configuration.

## Application Skeleton Standards

This repository follows the central application standards maintained in the
chromadb tooling repository under `docs/standards/`. Binding summary:

- The mandatory file set must stay present: `README.md`, `AGENTS.md`, `CLAUDE.md`,
  `.env.example`, `docs/architecture.md`, `docs/api.md`, `docs/security.md`,
  `docs/operations.md`, `docs/observability.md`, `docs/runbook.md`, `docs/adr/`.
- JSON-first OpenAPI: `openapi/openapi.json` is the repository-level binding API
  contract. Never change API behavior without updating it. Service-local YAML
  files are retained during migration and must stay aligned through
  `scripts/generate_openapi_index.rb`.
- Existing AKB error responses currently use `trace_id`. Do not break that
  compatibility while planning the central `requestId` transition.
- Logging is structured and must include request/correlation ids where
  available. Do not log document bodies, prompts, answers, tokens, or secrets.
- Health (`/health`) and readiness (`/ready`) endpoints exist on backend
  services; the web bridge exposes `/api/health` and `/api/ready`.
- Never commit secrets; keep `.env.example` in sync with documented
  configuration.
- Do not create undocumented endpoints, delete documentation without
  replacement, or introduce incompatible structure without an ADR.
- `scripts/validate-skeleton.sh` must pass; CI runs it.

## Documentation Rules

- Keep active documentation current-state, operational, and directly useful for the current repository state.
- When behavior changes, update the corresponding documentation in the same change.
- Keep the flat standard documents current for repository-wide topics and keep detailed domain docs in the most specific existing folder under `docs/`.
- Use these documentation homes by default:
  - flat standard overview: `docs/architecture.md`, `docs/api.md`, `docs/security.md`, `docs/operations.md`, `docs/observability.md`, `docs/runbook.md`
  - architecture decisions: `docs/adr/`
  - architecture decisions and structure: `docs/ARCHITECTURE/`
  - deployment, environments, profiles, restore, backup: `docs/deployment/`
  - retrieval, ingestion, embeddings, citations: `docs/rag/`, `docs/ingestion/`, `docs/llm/`
  - security, authorization, auditability: `docs/security/`, `docs/governance/`
  - operations, status, release, code health: `docs/OPERATIONS/`, `docs/maintenance/`
  - APIs, contracts, UI, integration flows: `docs/api/`, `docs/CONTRACTS/`, `docs/ui/`, `docs/integration/`
  - test and product QA evidence: `docs/qa/`, `docs/evaluation/`
- Keep historical working notes, temporary analyses, and superseded implementation material out of the active top-level docs flow unless the repo already explicitly preserves them, for example `docs/CODEX_THREADS/`.
- For new documentation areas without an existing AKB-specific home, follow the app template taxonomy: `docs/explanation/`, `docs/how-to/`, `docs/reference/`, `docs/runbooks/`, `docs/tutorials/`, `docs/adr/`, and `docs/archive/`.

## Validation

- After code changes, run the smallest relevant verification first.
- For Chroma retrieval verification:
  - `"/Users/voldzi/Documents/Development/18 2026/chromadb/tools/chroma-dev.sh" search-all "<query>" --root . --limit 5`
- For skeleton/OpenAPI validation:
  - `bash scripts/validate-skeleton.sh`
  - `ruby scripts/generate_openapi_index.rb --check`
  - `python3 -m json.tool openapi/openapi.json >/dev/null`
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
