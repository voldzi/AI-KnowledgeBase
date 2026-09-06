# ADR 0021: Signed expiry and permanent intake reference fences

Status: accepted and implemented in AKB; operational activation is explicit.

## Context

Quarantine and promoted uploads can outlive an abandoned session. A storage
listing or file modification time does not prove signed expiry. A reference
check followed by deletion can race a delayed version commit, and a user-filtered
document list cannot prove that a private or historical reference is absent.

## Decision

Persist a minimal HMAC-signed manifest before intake bytes, in durable local
quarantine metadata and the configured object store. Bind exact canonical source
URI, session, size/hash and signed expiry; retain verification keys across rotation.
Keep the manifest after cleanup for replay and late-arriving identical content.

Provide a dedicated service-only Registry dry-run/claim API. Query every content
owner, regardless of user visibility or lifecycle status. Claim an expired,
unreferenced URI under a database row lock, commit a permanent tombstone, then
allow an operator tool to perform exact conditional storage removal. All ORM,
bulk and raw-SQL reference writers share the fence through sorted transaction
locks and database triggers. PostgreSQL requires READ COMMITTED; no process-local
lock stands in for transaction serialization.

The clean target stores one ASCII, unescaped `s3://bucket/key` representation and
one physical configured bucket. New ambiguous content URIs are rejected, and
pre-existing ambiguity or legacy bucket aliases stop cleanup. No immutable
reference is silently normalized or rewritten. All five owner expressions have
lookup indexes and noncanonical-reference partial indexes.

## Consequences

Migration 0029 and its runtime must be promoted together. Tombstones cannot be
removed by ordinary writes or Alembic downgrade; recovery is roll-forward.
Old objects without valid signed manifests remain untouched. Actual MinIO QA
proved that the available release ignores `DeleteObject IfMatch`. S3 apply is
therefore disabled before any Registry claim or storage mutation for every
backend, with no enabling flag. Only local apply is available. A future approved
immutable-version deletion and retention contract requires implementation and
backend verification. Explicit batches and scheduling
belong to the operator. No new production grant or deletion is enabled by default.

The implementation, exact service grant, key rotation, operator command and
verification are documented in [Intake object cleanup](../OPERATIONS/intake-object-cleanup.md).
