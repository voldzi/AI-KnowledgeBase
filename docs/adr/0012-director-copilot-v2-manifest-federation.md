# ADR 0012: Director Copilot V2 uses pinned dynamic manifests

Status: Accepted

Date: 2026-07-25

## Context

Director Copilot must query Budget, ProjectFlow and ArchFlow without
duplicating their changing metric and relationship catalogs in AKB. The
consumer must still reject incompatible source changes.

## Decision

AKB pins `director-copilot-2` revision `2.0.4` and its six SHA-256 values.
At runtime it loads each source manifest, validates the closed schema and
requires semantic equality with the pinned bundle. Each source receives one
route-bound service bearer with exactly one audience plus a separate current
actor bearer.

V2 has `disabled`, `shadow` and `active` modes. Active mode uses deterministic
source facts and does not fall back to document RAG. Cross-source joins require
a byte-identical canonical ID or a typed manifest relationship. Document links
are independently authorized by Registry.

## Consequences

Source contract drift blocks V2 before execution. AKB does not own source
calculations, role semantics or Information Policy decisions, but it owns
orchestration, bounded dialogue state, reauthorization, deterministic
presentation and metadata-only audit.
