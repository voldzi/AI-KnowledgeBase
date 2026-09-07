# Architecture Decision Records

This directory contains AKB architecture decision records.

Rules:

- one ADR per decision,
- keep decisions short and current-state focused,
- supersede old decisions with a new ADR instead of rewriting history,
- add an ADR when a change affects architecture, API contracts, data handling,
  security boundaries, deployment, rollback, or STRATOS integration contracts.

Current identity decision: [0015: central SSO and optional managed identity](0015-central-sso-and-managed-identity.md).

Current intake decision: [0016: one document intake contract for the clean target](0016-single-document-intake-contract.md).

Sourced Chat history: [0018: Registry source authority](0018-federated-history-authority.md) (accepted design; provider verification and reopening pending).

Mandatory admission requirement: [0017: document policy with explicit TLP](0017-mandatory-document-policy.md) (TLP guards implemented locally; complete profile activation pending).

Format capabilities: [0019: one format catalog](0019-document-format-capabilities.md).

- [0020: Mandatory document profiles and immutable accountability snapshots](0020-document-profile-snapshots.md) — AKB implementation accepted; central admission enablement remains gated.

- [0021: Signed expiry and permanent intake reference fences](0021-intake-reference-fencing.md) — implemented; cleanup activation remains operator-controlled.

- [0022: Profile-owned AKB and Chat sessions](0022-profile-owned-browser-sessions.md).

- [0023: Immutable STRATOS UI release artifact](0023-immutable-stratos-ui-delivery.md).

- [0024: Source document intake](0024-source-document-intake.md) — ProjectFlow/ArchFlow source authority, exact service identities and shared document engine.

- [0025: AKB runtime root and high-throughput MacBook CI](0025-akb-runtime-root-and-macbook-ci.md) — staged clean cutover from `/srv/akl` to `/srv/akb` and a bounded fast local preflight.
