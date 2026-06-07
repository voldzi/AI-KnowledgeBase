# Code Health Baseline

This baseline keeps the repository focused on the current AKL runtime contract.

## Runtime Contracts

- Use current `AKL_*` environment variables only.
- Do not add compatibility aliases for removed env names.
- Production database runtime is PostgreSQL. SQLite is allowed only for fast isolated tests and local migration smoke checks.
- Web runs through Docker on `http://localhost:3002` in the standard local profile.
- Host-side `npm run dev` is only for focused UI debugging after stopping the Docker web service.

## Repository Hygiene

- Generated import reports belong under `reports/` and are ignored.
- Build outputs, caches, local databases, virtual environments, and object/vector storage stay outside Git.
- Historical integration reports may remain as decision records, but active README, deployment, and service docs must describe the current contract.

## Validation

- Frontend typecheck uses `strict`, `noUnusedLocals`, and `noUnusedParameters`.
- Registry schema changes must pass the PostgreSQL smoke script: `python scripts/registry_postgres_smoke.py`.
- RAG and LLM config tests must cover current `AKL_*` names directly.
- Removed API aliases should have regression tests that assert the old payload shape is rejected.
