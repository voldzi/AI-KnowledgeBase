# ADR 0001: Application Skeleton Standard

Status: Accepted

## Context

AKB predates the central application skeleton standard and already has a rich
domain documentation tree under `docs/ARCHITECTURE/`, `docs/api/`,
`docs/security/`, `docs/OPERATIONS/`, `docs/deployment/`, `docs/rag/`,
`docs/ingestion/`, `docs/ui/`, and `docs/integration/`.

The central standard now requires a flat mandatory documentation set so all
application repositories can be navigated and validated consistently.

## Decision

AKB adopts the flat mandatory documents:

- `docs/architecture.md`
- `docs/api.md`
- `docs/security.md`
- `docs/operations.md`
- `docs/observability.md`
- `docs/runbook.md`

These files are the canonical orientation documents for agents and engineers.
They summarize the current state and link to the deeper domain documents
without deleting or renaming the existing AKB documentation tree.

`AGENTS.md` and `CLAUDE.md` carry the central Application Skeleton Standards
section and must stay aligned except for the Claude Compact Instructions.

## Consequences

- `scripts/validate-skeleton.sh` validates the flat mandatory file set.
- `docs/README.md` remains the navigation index and points to both the flat
  documents and detailed domain homes.
- Future changes that affect API, configuration, deployment, security,
  observability, operations, or STRATOS integration must update the matching
  flat document plus the detailed domain document where relevant.
