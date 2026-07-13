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

User calls use their verified bearer. External service calls use the STRATOS
runtime token with `actorSubjectId` from a validated integration envelope.
STRATOS reloads the actor and rechecks identity, membership,
`akb:assign_policy`, and scope; the runtime token is not an authorization
bypass. A missing delegated actor fails the request. AKB does not persist a new
`POLICY_PENDING` document state, so a contributor with `akb:upload` but without
`akb:assign_policy` cannot create readable or partially governed content; the
whole upload fails until an information steward performs the governed action.

Runtime document/RAG/export decisions send the stored concrete scope and the
registered binding/hash. RAG candidates also carry immutable version ids, and
export reauthorizes every cited source with `rag.export` before producing a
file. Metadata-only reports remain view-only because they do not yet have an
immutable cited snapshot that can be reauthorized at export time.

AKB does not expose anonymous content in this decision. True public delivery
requires a later dedicated immutable representation endpoint bound to central
`InformationPublication` and per-request public decisions. Organization
audience and `classification=public` remain authenticated.

## Consequences

- IT and Logistics content remains isolated without tenants.
- Deactivated scopes and archived versions fail immediately.
- Central lineage and audit can trace AKB derivatives to source resources.
- Existing rows migrate as `LEGACY_UNREGISTERED` and require an explicit
  backfill before a strict "registered-only" rollout gate is enabled.
- Separation of duties remains explicit: `akb:upload` is not treated as
  `akb:assign_policy`.
- No unsafe anonymous fallback exists while public content delivery is absent.
