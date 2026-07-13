# ADR 0006: Central Governed Information Resources

- Status: Accepted
- Date: 2026-07-13

## Context

AKB already stored immutable Information Policy V2 snapshots and enforced
capability, scope, audience, TLP/PAP, RAG filtering, citation opening, and AI
obligations. It did not link each document/version to the central STRATOS
resource lineage. Service decisions also requested organization scope even for
unit- or project-scoped content, and report export trusted policy metadata
posted back by the browser.

## Decision

AKB registers every new policy-bearing document and immutable version as an
`AKB` `GovernedInformationResource`. It stores the returned id, source version,
parent, concrete scope, status, and timestamp. The scope must already exist;
upload never creates scopes. A child uses the parent scope or an active
registered descendant.

User calls use their verified bearer. External service calls use the dedicated
`AKB_POLICY_SERVICE_TOKEN`; STRATOS maps it to the fixed `service:akb`
identity and AKB namespace, then rechecks active identity, membership,
`akb:assign_policy`, and scope. The original envelope actor is retained only as
`metadata.auditActorSubjectId` and is never an authorization override. A
missing or invalid dedicated credential fails the request. AKB does not persist a new
`POLICY_PENDING` document state, so a contributor with `akb:upload` but without
`akb:assign_policy` cannot create readable or partially governed content; the
whole upload fails until an information steward performs the governed action.

Runtime document/RAG/export decisions send the stored concrete scope and the
registered binding/hash. RAG candidates also carry immutable version ids, and
export reauthorizes every cited source with `rag.export` before producing a
file. Metadata-only reports remain view-only because they do not yet have an
immutable cited snapshot that can be reauthorized at export time.

This decision did not expose anonymous content. ADR 0007 subsequently adds the
dedicated immutable representation and per-request central public decision;
organization audience and legacy `classification=public` remain authenticated.

## Consequences

- IT and Logistics content remains isolated without tenants.
- Deactivated scopes and archived versions fail immediately.
- Central lineage and audit can trace AKB derivatives to source resources.
- Existing rows migrate as `LEGACY_UNREGISTERED` and require an explicit
  backfill before a strict "registered-only" rollout gate is enabled.
- Separation of duties remains explicit: `akb:upload` is not treated as
  `akb:assign_policy`.
- No unsafe anonymous fallback exists; public delivery is available only via
  the stricter lifecycle in ADR 0007.
