# AKB Controlled Rules API for Budget - impact report

Date: 2026-08-01

## Decision

AKB adds a dedicated, fail-closed read contract for verified public-procurement
rules. Budget must not read the Registry database, call the gestor-facing
controlled-documentation projection, or reuse the document-upload identity.

The wire contract is `akb-controlled-rules-1` revision `1.0.0`. Its schema,
catalog, and fixtures are in `contracts/controlled-rules/v1`.

## Root cause closed by this change

The production Budget token was valid, but its `stratos-akb-service` client was
correctly limited to `stratos-budget-upload`. Calls to the existing generic
rules route therefore returned HTTP 403. Budget also had no bounded consumer
contract, no known no-data outcome, and no denial audit in the domain layer.

This change deliberately keeps the upload identity unchanged and introduces:

- client `svc-budget-controlled-rules`;
- role `service_budget_rules_read`;
- sole Registry route grant `controlled-rules-read`;
- endpoint
  `GET /api/v1/integrations/controlled-rules-read/rules`;
- closed response states `complete`, `complete_with_warning`, `no_data`, and
  `conflict`;
- `controlled_rules.read.returned` and `controlled_rules.read.denied` audit
  events without rule values, citations, document content, or tokens.

## Data integrity

Only rules satisfying every gate are returned:

1. the package is `valid` on the mandatory `valid_on` date;
2. each package source belongs to the caller organization and is `public` or
   `internal`;
3. extraction profile is `controlled_document_rules_v1` revision `3`;
4. the gestor accepted or edited the exact proposal;
5. the citation points to an exact package member version;
6. the normative key and category are registered in the closed catalog;
7. precedence is `authoritative` or `supplemental` and no integrity conflict
   exists.

The revision 3 extraction uses stable public-procurement keys rather than
generated hashes. It covers VZMR thresholds, direct purchase, market research,
marketplace, central evidence, publication, written-contract and amendment
limits, supplier counts, NEN, workflow, exceptions, required documentation,
and retention. Unknown candidates are skipped and disclosed as a bounded
extraction warning; they never become consumable rules automatically.

## Production data impact

No existing rule is silently promoted. Existing revision 1/2 extractions are
not eligible for the consumer endpoint. Current production packages must be
re-extracted with revision 3 and reviewed by the gestor. A package must then be
explicitly made `valid` before Budget can consume it.

Official law and implementing-regulation packages remain a separate governed
content operation. They must be created from authoritative immutable source
versions, reviewed, and activated. Until that is complete, AKB correctly
returns `no_data`; Budget must not substitute a local legal threshold.

## Verification completed

- Registry API: 211 passed, 1 declared skip.
- RAG Retrieval Service: 198 passed.
- Web: 397 passed.
- Web TypeScript check: passed.
- Web production build: passed.
- repository skeleton and generated OpenAPI checks: passed.
- local OpenAPI YAML and controlled-rules JSON parsing: passed.
- whitespace/error diff check: passed.

The declared Registry skip requires an isolated database fixture and is not a
failure of this contract. Test-suite deprecation warnings are pre-existing and
do not change runtime behavior.

## Joint activation gate

Before the AKB production release, STRATOS must create and verify the dedicated
OIDC identity with exactly one AKB audience and the required role. The secret
must remain outside Git and Compose. AKB production configuration must include
the exact client and sole route grant; otherwise Registry startup fails closed.

After AKB deployment, Budget must implement its schema-validating server-side
adapter and prove the positive, no-data, conflict, historical, expired-token,
wrong-audience, wrong-role, source-policy, timeout, and unknown-contract
scenarios. The old hard-coded procurement type list can remain only as a user
planning classification, never as a legal decision.

Production activation is complete only when current and historical queries
are traceable by the same correlation id in both applications and every used
rule retains its `source_version`, normative key, source package, and exact
citation.
