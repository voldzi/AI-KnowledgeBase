# ADR 0016: One Document Intake Contract for the Clean Environment

## Status

Accepted on 2026-09-05. Supersedes the compatibility-adapter and migration
rollout parts of ADR 0010 for the clean target environment requested by the
product owner.

## Decision

AKB and the supported STRATOS clients use one canonical binary endpoint:
`PUT /api/document-intake/v1/sessions/{sessionId}/content`. The previous
controlled-document and Budget binary aliases are removed. A denied or missing
canonical route must never cause a client to try an older endpoint.

Origin-specific preflight and confirmation operations remain part of the
current contract because Budget, interactive AKB and approved collectors have
different authority. They are not fallback protocols. ProjectFlow and ArchFlow
require explicit implemented source profiles and a shared acceptance result;
the existing Budget service identity must not be reused to impersonate them.

The signed session is necessary but insufficient to authorize an HTTP upload.
Before reading the body, AKB checks the current person or exact service,
signed actor identity and policy coordinates. Budget requests carry the
service bearer and, in interactive mode, a separate current actor bearer.
Registry revalidates stored Budget lineage and its current central inherited
policy. Official source collection uses its authorized internal intake core,
not a transferable HTTP upload token.

A replay preserves the original immutable file and its original scan
attestation. A newly uploaded copy must pass its own checks; it must not replace
the existing file's evidence. Repeated confirmation uses the verified canonical
file returned by Registry. Redundant uploads are retained through the retry
window; safe expiration and reference-aware cleanup require a separate durable
lifecycle, not deletion during confirmation.

## Rollout

There is no historical-data import, rescan phase or dual-protocol window for the
clean target. Update AKB, clients, OpenAPI and documentation together. Enable
user intake only after the coordinated release passes the cross-application
acceptance suite. Current production image, CI, authorization, readiness and
recovery gates still apply. This decision does not authorize deletion of
unrelated data, audit records or source history.

Immutable content/version identifiers remain necessary for citations, TLP and
integrity. Their existence is independent of supporting old API versions.

## References

- [Document Intake contract](../integration/AKB_DOCUMENT_INTAKE_V1.md)
- [STRATOS handoff](../integration/STRATOS_DOCUMENT_INTAKE_HANDOFF.md)
- [Implementation plan](../ARCHITECTURE/document-intake-hardening-plan.md)
