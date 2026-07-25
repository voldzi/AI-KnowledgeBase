# Director Copilot V2 production acceptance

Status: ready for execution after the AKB V2 release is deployed

Contract: `director-copilot-2`, revision `2.0.2`

## Purpose

This is the joint production acceptance run for the additive Director Copilot
V2 integration. It proves that AKB can safely combine live, authorized facts
from Budget, ProjectFlow, ArchFlow and AIIP. It does not replace the existing
Director Copilot V1 until every gate below passes.

The run must use an approved test account and explicitly marked integration
fixtures. Do not change a real user's grants, information policy or business
records to satisfy a test.

## Preconditions

Record these values in the execution evidence before testing:

- AKB release SHA and `/akb/api/health` version;
- STRATOS, Budget, ProjectFlow, ArchFlow and AIIP release SHAs;
- contract revision `2.0.2` and the six pinned contract hashes from
  `docs/integration/DIRECTOR_COPILOT_V2_IMPLEMENTATION.md`;
- a test account with an active organisation scope, the five required source
  capabilities and no privileged global role;
- one authorised project with Budget plan/forecast, ProjectFlow delivery data,
  a linked ArchFlow need, a linked AIIP idea and an independently authorised
  AKB document;
- separate fixtures for no-data, currency conflict, information-policy denial,
  an ambiguous project name and a ProjectFlow document that AKB must deny.

The deployment begins with:

```text
AKL_DIRECTOR_COPILOT_V2_MODE=shadow
```

V1 remains the user-visible response in this mode. V2 must still load the
closed source manifests, invoke its tools and leave metadata-only audit events.

### Service-token and manifest preflight

Before S1, STRATOS verifies the production OIDC registration of
`svc-akb-director-copilot`. The client must obtain four separate client
credentials tokens, each requested with exactly one of these scopes:

- `director-copilot-budget-api` for audience `budget-api`;
- `director-copilot-projectflow-api` for audience `projectflow-api`;
- `director-copilot-archflow-api` for audience `archflow-api`;
- `director-copilot-aiip-api` for audience `aiip-api`.

For every token, call the corresponding manifest endpoint with
`X-AKB-Domain-Tool-Contract: director-copilot-2`. The endpoint must return
HTTP 200 and the pinned manifest content. Record only the scope name,
audience, HTTP status, manifest revision/hash and correlation ID. Never record
the bearer token, client secret or response payload.

`invalid_scope`, a multi-audience token, a missing audience, HTTP 401/403, or
manifest drift is a hard preflight failure. Keep V2 in `shadow`, correct the
STRATOS OIDC/client-scope registration or source deployment, and rerun this
preflight before running S1-S10. Do not work around it by using a broader
scope, a global role, or a shared service token.

## Shadow acceptance

For each request, retain the AKB correlation identifier, source statuses,
source revisions, tool identifiers, authorized scope types, item counts and
latency. Do not retain prompts, answers, tokens or source payloads in the
evidence.

| ID | Request / setup | Expected result |
| --- | --- | --- |
| S1 | `Jaký má IT rozpočet na rok 2025?` | Uses `budget.organization_financial_summary.v1`; no AKB sum is substituted for the Budget aggregate. |
| S2 | `Ne jen pro tento projekt, ale celkově.` | Retains the year, clears the project filter and returns the organisation aggregate. |
| S3 | `Rozděl ho podle portfolií.` | Keeps the financial context and requests the supported portfolio granularity. |
| S4 | `Které projekty překračují plán?` | Returns only Budget-authorized projects, with source-owned plan/forecast/variance semantics. |
| S5 | `Které z nich mají současně zpožděný milník?` | Joins Budget and ProjectFlow only on byte-identical `stratos:project:<id>`; no name-based join. |
| S6 | `Jaké potřeby čekají na rozhodnutí?` | Uses `archflow.need_portfolio_overview.v1`; a no-data result remains distinct from a denial. |
| S7 | `Jaké AI podněty čekají na harmonizaci?` | Uses `aiip.idea_portfolio_overview.v1`. |
| S8 | Follow the returned idea to its need, then to its project. | Traverses only the declared typed relationship; unknown or untyped links are omitted. |
| S9 | Open a ProjectFlow document link returned with a project. | AKB performs independent document authorization. An unauthorized document is neither named nor linked. |
| S10 | Reopen the thread, then repeat a live-data question. | Persisted history triggers a fresh authorized source query; unchanged access remains visible. |

Shadow succeeds only when every source response validates against its pinned
manifest and every observed source status is `complete`, `partial`, `no_data`,
`not_authorized` or `unavailable` with a known reason code.

## Negative and resilience acceptance

Run these cases in the isolated STRATOS integration environment, never by
modifying the live organisation.

| ID | Setup | Expected result |
| --- | --- | --- |
| N1 | Remove `budget:read` after a first successful turn. | A subsequent Budget question fails closed; earlier stored facts are not replayed as current data. |
| N2 | Narrow the account's ProjectFlow scope. | Only remaining covered projects are returned. Empty scope never means all projects. |
| N3 | Revoke the direct project membership for a direct project scope. | ProjectFlow returns the explicit membership reason; AKB does not invent a broader denial. |
| N4 | Information Policy denies one project or document. | The prohibited item is absent even when organisation coverage exists. |
| N5 | Use an ambiguous project name. | AKB requests clarification; it must not choose a project by guessing. |
| N6 | Budget returns `BUDGET_APPROVED_PLAN_MISSING`. | Completed response with a clear missing-data warning; no invented zero amount. |
| N7 | Budget returns `BUDGET_CURRENCY_CONFLICT`. | Conflicting currencies are not summed and the source warning is preserved. |
| N8 | Make one source unavailable. | AKB returns a partial, accurately attributed answer. It does not fall back to document RAG for that source. |
| N9 | Change a manifest revision, hash, fact, link or reason code in the test fixture. | V2 rejects it fail-closed before rendering. |
| N10 | Send forged request-scope headers. | They have no effect; only the fresh STRATOS access projection and source authorization matter. |

## Controlled active pilot

Only after all shadow and negative cases pass, an operator may set
`AKL_DIRECTOR_COPILOT_V2_MODE=active` for a short monitored pilot. Record the
start/end time and the exact AKB release SHA. Repeat S1-S10 with the V2 answer
visible to the test account.

Promotion is accepted only when all of these are true:

- no authorization or Information Policy data leakage;
- no document-RAG fallback for a live-source request;
- all accepted source errors use known reason codes;
- every rendered link is safe and independently authorized where required;
- no prompts, answers, tokens or source payloads appear in logs or audit;
- latency is within the agreed operating threshold and no source is silently
  dropped;
- V1 remains available as the rollback path.

## Evidence and verdict

STRATOS records a single signed-off report containing release SHAs, contract
hashes, test IDs, pass/fail verdict, correlation identifiers, source/tool
metadata, authorization scope type, response status and latency. Redact all
tokens, prompts, answers, fixture payloads and personal data.

Any failed security, policy, contract or data-provenance case keeps V2 in
`shadow`. A failed availability case may be retried only after the source
owner records the remediation and a new release SHA. Promote to `active` only
with an explicit overall PASS verdict.
