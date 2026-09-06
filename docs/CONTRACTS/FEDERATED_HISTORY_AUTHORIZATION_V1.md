# Federated history authorization V1

Status: **proposed provider contract; not an active API**. Updated 2026-09-05.
The design decision is [ADR 0018](../adr/0018-federated-history-authority.md).
The JSON schema and examples in [federated-history-v1](federated-history-v1/)
are executable specification fixtures, not evidence of STRATOS implementation.

## Current behavior

Registry returns content-free refresh receipts for persisted federated answers
and materialized reports without verifiable source coordinates. The restriction
also covers dependent titles, user prompts, derived metadata and suggestions on
direct reads, lists, rename responses and share responses. Raw stored answers can
contain business information; this change neither deletes those records nor adds
application-level encryption. Fresh authorized Chat queries remain available.

Document-backed history uses current exact-version authority. PDF/XLSX export
checks every declared row citation, its version policy and current `rag.export`
permission. The current client-supplied cells and citation lists do not prove
complete provenance. Server-owned artifacts and a bound evidence manifest are
required before claiming that an export's contents have attested derivation.

## Target ownership and transport

Registry is the authority boundary for reopening stored content. It first checks
thread visibility for the current reader, then verifies every source dependency.
The reader may differ from the author. An author's cached access hash, a shared
thread, a successful historic query or rerunning a similar prompt is not proof
of current reader access.

Each STRATOS provider should expose the proposed operation
`POST /api/v1/integrations/akb/history/authorize`. The actual path, schema revision
and service audience must be pinned in the jointly accepted provider manifest
before activation. This proposal is deliberately absent from the active OpenAPI
index until the implementation exists.

Transport has two separately verified credentials:

- `Authorization: Bearer <service credential>` identifies an explicitly
  allowlisted AKB Registry integration with the exact provider audience.
- `X-STRATOS-Actor-Authorization: Bearer <current reader credential>` identifies
  the current person. Providers freshly verify that person and require its
  subject to match `actor_subject_id`. Forwarded `X-AKL-*` identity headers
  cannot establish authority. A service token cannot substitute for a person.

Request/correlation identifiers follow the existing integration transport.
Logs contain identifiers, decision status and timing, never tokens, prompts,
answers, report cells or source payloads. TLS and authenticated server transport
are required; the returned decision is not a reusable bearer credential.

## Provenance required before reopening

An authenticated server writer must bind the stored title, prompt, answer and
report artifact to a complete evidence manifest and content hash. Registry must
validate writer authority independently of browser-supplied metadata. The
existing person-authorized append operation is not by itself such an attestation.
The provider must seal or persist source references so a consumer cannot omit a
dependency or invent a source version. The concrete trusted writer/persistence
contract is an activation dependency alongside this read contract.

Each logical dependency has a unique `evidence_id`, provider, canonical resource,
governed resource, immutable `source_version`, and exact policy binding/version/
hash. Duplicate evidence IDs are rejected even if their JSON objects differ.
The provider name and `source_system` must agree. Policy evidence must include
explicit effective TLP, audience and obligations under the shared Information
Policy contract; incomplete policy cannot authorize a read and has no default
TLP. Request references are loaded from the stored trusted manifest, not supplied
by the browser requesting history.

An aggregate or empty result needs a provider-issued `query_snapshot` reference
covering the complete query scope, dataset watermark and filter/policy digest.
An empty list of citations cannot establish permission. A query snapshot must
itself have current governed authority and an immutable provider revision.
An export should identify a server-owned artifact whose content hash and complete
manifest are checked using the same boundary; browser report IDs or warnings
cannot enable an exception.

## Request and decision

[schema.json](federated-history-v1/schema.json) defines bounded JSON objects.
[request.json](federated-history-v1/request.json) is a record-source example.
There are 1–200 references per provider request. Overflow requires a coordinated
bounded batching design with all batches allowed before disclosure; it must not
truncate evidence. `tenant_id=org_stratos` is the explicit scope of this proposal.

The request binds purpose `assistant.history.read`, provider, current actor,
unique read ID, a fresh UUID nonce and the complete stored manifest hash. The
manifest hash binds all conversation dependencies, even when a provider receives
only its subset. The decision echoes these fields and adds the digest of this
exact provider request. For these schema values, digest encoding is compact UTF-8
JSON with recursively sorted object keys in UTF-16 order, unchanged array order
and JSON string escaping, then SHA-256 with the `sha256:` prefix. The fixture
test checks the example digest; future schema expansion must preserve or version
this canonical encoding.

| Decision | HTTP | Required result |
| --- | --- | --- |
| `ALLOW` | 200 | Every requested reference echoed exactly; complete current authority and enforceable obligations. |
| `DENY` | 403 | No authorized reference subset or source details. |
| `STALE` | 409 | Current actor may access the resource, but source version or policy coordinates changed; no replacement source data or current policy values. |
| `UNAVAILABLE` | 503 | Required current authority cannot be established; no cached allow. |

The provider checks current reader authority before revealing a stale state.
Missing resources and revoked access return a nondisclosing denial. A changed
source version or newly bound policy after history was written requires a new
query; the old answer must not be silently relabeled with the new policy hash.
Malformed requests use the provider's standard validation error response and
never produce an allow decision.

Examples: [allow](federated-history-v1/allow.json),
[deny](federated-history-v1/deny.json), [stale](federated-history-v1/stale.json),
[unavailable](federated-history-v1/unavailable.json). Example policy hashes,
resource IDs and timestamps are synthetic. `issued_at`/`expires_at` must be valid
for the current request and at most 30 seconds apart. Registry validates the
nonce, digest, actor, provider, manifest hash, reference equality and expiration
before disclosure. No decision or access projection is cached as an authorization
TTL for a later read. Unknown or unenforceable obligations fail closed.

Registry returns raw history only after every provider and document dependency
allows. Until a complete turn dependency graph exists, any denied, stale,
unavailable or malformed dependency redacts the whole conversation response.
No partial answer, prompt, title, suggestion or artifact may survive by being in
a different message. A refresh receipt contains no source detail and grants no
authority. The same guard must cover list/detail, PATCH/PUT responses and exports.

## Joint acceptance and activation

AKB and each STRATOS provider must demonstrate the following with their real
transport and current policy service, in addition to fixture validation:

1. The author and a different authorized shared reader can reopen unchanged
   content. A thread share alone never grants source access.
2. Revocation, policy changes, new source versions and removed resources prevent
   old content disclosure through detail, list, rename, share and export routes.
3. Provider/PDP outage, malformed policy, missing explicit TLP and missing or
   expired person authority fail closed without a cached allow.
4. Wrong audience, service/person substitution, forwarded identity headers and
   mismatched actor/provider/nonce/digest/manifest/expiration are rejected.
5. Missing references, duplicate evidence IDs, partial allow sets, unknown
   obligations and source-free aggregate reports cannot authorize content.
6. A forged browser marker, altered report cell or omitted dependency fails
   stored content-hash and trusted provenance verification.
7. Provider decisions and Registry responses disclose no denied source payload;
   ordinary logs contain no content or credential material.

Enable full reopening only when provider endpoints, the trusted persistence
contract, the Registry verifier and these joint tests ship together. Existing
unattested rows remain refresh receipts. There is no legacy fallback or automatic
upgrade from browser-supplied citations to trusted provenance.
