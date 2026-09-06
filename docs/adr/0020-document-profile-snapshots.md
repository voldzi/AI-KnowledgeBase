# ADR 0020: Mandatory document profiles and immutable accountability snapshots

Date: 2026-09-05

Status: accepted for AKB implementation; coordinated STRATOS admission support
and deployment enablement remain external acceptance gates.

## Context

TLP controls sharing but does not prove authorship, current accountability,
authorized source provenance or meaningful lifecycle evidence. A mutable owner
field can also rewrite the apparent context of an existing citation or approval.
The product requires complete profiles from initial intake, including services,
public sources and administrative workflows, without legacy exceptions.

## Decision

Use one versioned five-family catalog for generic UI metadata and structural
backend validation. Keep its exact copies synchronized and require central
approval of the exact catalog/profile revisions before enablement. Preserve the
existing Information Policy V2 hash and mandatory explicit document TLP.

Require complete root profile input on document creation and metadata/assignment
revision, and complete nested lifecycle/domain input on content-version creation.
Allocate native document/version identities server-side. Derive immutable content
lineage only from the verified clean intake file and authenticated source flow.

Persist append-only root revisions and immutable version snapshots with separate
canonical hashes and database-enforced relations to document, version, root
revision and source file. Update the current root by compare-and-swap. Ownership
transfers change current accountability while preserving historical snapshots.
Review approval is bound to exact policy and profile hashes. Controlled profiles
require independent version-bound approval, including when no review task exists.

Extend central registration atomically and require a separate fresh read-only
admission decision for existing resources. Confirm both historical root/source
and current accountable root in one nonce-bound response. Verify fixed service,
exact policy/scope/source/profile/hash and short freshness. Unsupported STRATOS
support fails closed; there is no local active-identity assertion, feature-flag
bypass, identity lookup/write gap, policy GET fallback or stored-proof grant.

Keep record dates distinct from normative effectivity. Draft contracts can be
processed for review but stay outside authoritative RAG. Historical terminated
records do not claim present effectivity. Do not fabricate expiry or retention
periods. A dynamic central capability/catalog probe governs intake readiness;
general process/database health is separate.

## Consequences

Producers must send explicit author, source, owner, gestor and profile-specific
evidence. New integrations that lack this contract are rejected instead of
silently accepted. Central outage/revocation blocks admission and source use;
withdrawal remains possible. Root and version history cannot be rewritten by an
owner transfer, retry, raw SQL update or ORM mutation.

The implementation requires migrations and coordinated STRATOS contracts.
Fresh remote decisions add latency; connection pooling and safe request-local
reuse may improve it while preserving exact authority and revocation semantics.
Passing local tests does not establish external deployment readiness.

The binding details, schemas and acceptance gates are in the
[document profile contract](../CONTRACTS/AKB_DOCUMENT_PROFILE_PROPOSAL.md).
