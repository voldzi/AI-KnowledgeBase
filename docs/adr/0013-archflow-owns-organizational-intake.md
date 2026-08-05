# ADR 0013: ArchFlow owns organizational intake

Status: Accepted

Date: 2026-08-05

## Context

AIIP is no longer operated as a STRATOS application. ArchFlow now owns the
intake and portfolio view of organizational needs and ideas. Director Copilot
must not become unavailable because the immutable `director-copilot-2` revision
`2.0.3` still contains a historical AIIP manifest.

## Decision

The active Director Copilot topology consists only of Budget, ProjectFlow and
ArchFlow. AKB requests service tokens, loads manifests, evaluates readiness and
executes tools only for those three applications. Terms formerly associated
with AI intake are supported as ArchFlow concepts. AKB does not retain an AIIP
query alias, endpoint or authorization path.

AKB keeps the exact `2.0.3` contract bundle unchanged so its published hashes
remain verifiable. The historical AIIP manifest is filtered out before the
active manifest catalog is built. Old AIIP history envelopes fail closed and
are not replayed.

## Consequences

An unavailable or removed AIIP endpoint cannot degrade AKB readiness or block
Budget, ProjectFlow and ArchFlow queries. No AIIP audience, route scope, base
URL or application-switcher link is configured. Independent legacy AIIP
document-ingestion contracts are outside this decision and may be retired in a
separate migration.
