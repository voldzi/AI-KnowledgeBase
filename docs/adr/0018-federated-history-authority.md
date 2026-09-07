# ADR 0018: Registry owns authority for reopening sourced Chat history

Status: accepted design; provider contract and reopening implementation pending

Date: 2026-09-05

## Decision

Registry must authorize every stored source dependency for the current reader
before returning any source-derived title, prompt, answer, report or suggestion.
The verifier belongs at the persistence boundary, so direct API calls and web
responses have the same protection. Sharing a thread does not delegate source
access, and an author's access hash does not authorize another reader.

For the clean target, STRATOS providers expose the proposed
[Federated History Authorization V1 contract](../CONTRACTS/FEDERATED_HISTORY_AUTHORIZATION_V1.md).
Registry sends its own allowlisted service credential and the separate current
reader credential. Providers check exact resource/version and current policy;
Registry never reruns an old prompt to infer permission from similar results.

Persisted provenance and export artifacts must originate from authenticated
server writers and bind their complete source manifest to a content hash.
Browser report IDs, warnings, supplied citations and forwarded identity headers
are not proof of complete provenance. Empty and aggregate results require an
authoritative query-snapshot dependency.

## Current boundary and activation

Document history uses current exact-version checks. Until complete provider
verification is implemented and jointly accepted, federated history and
unverifiable materialized reports return content-free refresh receipts, including
all dependent prompts and titles. Raw storage is retained; the receipt does not
grant access or claim that server-side storage is application-encrypted.
Fresh authorized queries remain usable.

There is no legacy or marker-based fallback that returns unverified content.
Activation requires the provider contract, authenticated persistence provenance,
Registry verifier and shared-reader revocation tests together. Provider changes
require a pinned manifest/contract revision and joint AKB/STRATOS acceptance.
