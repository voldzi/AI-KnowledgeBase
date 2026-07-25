# STRATOS handoff: domain catalog and general Copilot data access

Status: AKB implementation ready for source-owner integration
Contract date: 2026-07-25
AKB transport contract: `director-copilot-1`
AKB planning contract: `director-copilot-query-plan-4`
Domain catalog: `stratos-domain-catalog-2026-07-25`

## Objective

AKB Chat must answer free-form questions over authorized live data across
Budget, ProjectFlow, ArchFlow and AIIP, optionally combined with governed AKB
documents. AKB is an orchestrator and evidence composer. It must not read
application databases, invent joins, duplicate source calculations or use a
prompt as authority.

Budget and ProjectFlow are connected. AKB now has closed contracts, planning,
authorization, evidence normalization, deterministic rendering, governed
history and audit support for ArchFlow and AIIP. These two tools remain
`contract_ready`, so production safely returns “source not connected” until
STRATOS publishes and verifies them.

## Shared transport

Each source exposes:

```text
POST /api/v1/integrations/akb/domain-tools/execute
```

AKB sends:

```text
Authorization: Bearer <svc-akb-director-copilot>
X-STRATOS-Actor-Authorization: Bearer <current-person>
X-AKB-Domain-Tool-Contract: director-copilot-1
Idempotency-Key: <stable tool_call_id>
X-Request-ID: <bounded id>
X-Correlation-ID: <bounded id>
Content-Type: application/json
Accept: application/json
```

The service and actor bearer must be different. The source validates the
service client, its exact audience and role, verifies the actor bearer, loads a
fresh STRATOS access projection, then applies its local PEP and Information
Policy. `requested_scopes` and filters only narrow the call; they are never
authorization claims.

Source responses are bounded to 100 items by contract and AKB currently asks
for 25. The configured AKB transport limit is 262144 bytes and timeout 8000 ms.
Do not return prompt text, raw database rows, binary content or unbounded
metadata.

## ArchFlow tool

```text
tool_id: archflow.need_portfolio_snapshot.v1
source_system: STRATOS_ARCHFLOW
entity_type: business_need
canonical_id: stratos:archflow-need:<stable-id>
context tag: archflow-need:<same-stable-id>
```

Capabilities:

```text
archflow:access
one or more of:
  archflow:read_own
  archflow:read_unit
  archflow:read_organization
```

Scope/capability binding:

| Explicit scope | Required read capability |
| --- | --- |
| `own:<subject>` | `archflow:read_own` |
| `organization_unit:<unit>` | `archflow:read_unit` or `archflow:read_organization` |
| `organization:org_stratos` | `archflow:read_organization` |
| `recipient_set:<id>` | `archflow:read_unit` or `archflow:read_organization` |

Closed facts:

```text
archflow.need.display_name              text, required
archflow.need.status                    text, required
archflow.need.readiness_score           number
archflow.need.impact_score              number
archflow.need.decision                  text
archflow.need.budget_handoff_status     text
relation.aiip_idea_canonical_id         text, canonical ID or null
relation.project_canonical_id           text, canonical ID or null
```

## AIIP tool

```text
tool_id: aiip.idea_portfolio_snapshot.v1
source_system: STRATOS_AIIP
entity_type: ai_idea
canonical_id: stratos:aiip-idea:<stable-id>
context tag: aiip-idea:<same-stable-id>
```

Capabilities:

```text
aiip:access
one or more of:
  aiip:read_own
  aiip:read_unit
  aiip:read_organization
```

Scope/capability binding:

| Explicit scope | Required read capability |
| --- | --- |
| `own:<subject>` | `aiip:read_own` |
| `organization_unit:<unit>` | `aiip:read_unit` |
| `organization:org_stratos` | `aiip:read_organization` |
| `recipient_set:<id>` | `aiip:read_organization` |

Closed facts:

```text
aiip.idea.display_name                  text, required
aiip.idea.status                        text, required
aiip.idea.value_score                   number
aiip.idea.risk_score                    number
aiip.idea.expected_benefit              text
aiip.idea.handoff_status                text
relation.archflow_need_canonical_id     text, canonical ID or null
```

## Canonical joins

AKB accepts only these relation strategies:

1. Budget and ProjectFlow join on the same
   `stratos:project:<stable-id>`.
2. A project and AKB document join through an exact source-owned context tag.
3. AIIP and ArchFlow join through explicit relation facts using canonical IDs.
4. ArchFlow and ProjectFlow join through
   `relation.project_canonical_id`.

Names, labels, vector similarity and LLM output must not create a relation.
Source applications own the relation and its lifecycle. A missing relation is
reported as missing; AKB does not infer it.

## Information Policy and failures

Every item includes the effective Information Policy V2 binding ID, version,
hash, classification, audience and obligations. Scope or policy denial is
fail-closed and returns no items.

Recommended bounded HTTP error codes:

```text
ARCHFLOW_APPLICATION_ACCESS_INACTIVE
ARCHFLOW_ACCESS_CAPABILITY_MISSING
ARCHFLOW_READ_CAPABILITY_MISSING
ARCHFLOW_SCOPE_NOT_COVERED
ARCHFLOW_INFORMATION_POLICY_DENIED
ARCHFLOW_DOMAIN_TOOL_UNAVAILABLE

AIIP_APPLICATION_ACCESS_INACTIVE
AIIP_ACCESS_CAPABILITY_MISSING
AIIP_READ_CAPABILITY_MISSING
AIIP_SCOPE_NOT_COVERED
AIIP_INFORMATION_POLICY_DENIED
AIIP_DOMAIN_TOOL_UNAVAILABLE
```

Return `401/403` only for identity, capability, scope or policy rejection.
Return `503` for an unavailable access projection, source read model or
dependency. Do not describe an outage as missing user permission. A
`not_authorized` JSON response must contain no items and should include one
specific machine reason in `warnings`.

## Work required in STRATOS, ArchFlow and AIIP

1. Adopt the catalog and schemas from:
   - `contracts/stratos-domain-catalog/v1/`
   - `contracts/director-copilot/v1/`
2. Implement the two read-only tools without calling an LLM or AKB.
3. Preserve stable canonical IDs and explicit relation facts through the
   complete AIIP -> ArchFlow -> Budget -> ProjectFlow lifecycle.
4. Revalidate the actor immediately before reading source data.
5. Apply Information Policy per returned item and omit denied items.
6. Add positive, scope-denied, capability-denied, expired-grant,
   policy-denied, forged-header, unavailable-projection and tenant-isolation
   tests.
7. Publish byte-compatible positive fixtures equivalent to
   `archflow-complete.json` and `aiip-complete.json`.
8. Deploy both tools and provide their private service base URLs. Do not expose
   them to the browser or public ingress.
9. Provide source release SHAs, OpenAPI paths, health checks and p50/p95
   latency evidence.
10. Coordinate with AKB to set the two catalog statuses from `contract_ready`
    to `connected`, configure the private URLs and run the integrated gate.

## Integrated acceptance gate

The gate must cover at least:

- own, unit and organization reads for both applications;
- absence of broader data when only `own` or unit access is present;
- AIIP idea -> ArchFlow need trace using an explicit canonical relation;
- ArchFlow need -> ProjectFlow project trace using an explicit canonical
  relation;
- a complete AIIP -> ArchFlow -> Budget -> ProjectFlow question with each
  source independently authorized;
- a missing relation with no inferred substitute;
- denied Information Policy despite a broad organization scope;
- expired grant and changed access projection before answer synthesis;
- one unavailable source producing a visibly partial result, not a false
  authorization denial;
- no prompt, answer, token or domain content in logs;
- governed history remaining visible only while current projection and source
  policy still authorize every referenced item.

AKB's Czech routing dataset currently contains 24 multi-domain scenarios and
passes locally. STRATOS should add its source-level fixtures and end-to-end
cases rather than teaching the router full sentences.

## Embedding comparison infrastructure

The domain-tool integration is independent of document embeddings. For the
separate retrieval comparison, STRATOS should provision internal endpoints for:

```text
BAAI/bge-m3                       baseline, 1024 dimensions
Qwen/Qwen3-Embedding-0.6B         candidate, 1024 dimensions
Seznam/simcse-retromae-small-cs  candidate, 256 dimensions
```

Each model must use a separate Qdrant collection and service identity. AKB has
the offline profile set and promotion gates in
`services/evaluation-service/datasets/czech_embedding_shadow_profiles.json`.
Candidates must remain invisible to answers until a full immutable-corpus
backfill and common Czech retrieval evaluation pass. The Seznam model requires
CC BY 4.0 attribution.
