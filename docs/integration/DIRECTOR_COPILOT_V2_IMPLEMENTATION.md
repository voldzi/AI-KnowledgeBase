# Director Copilot V2 AKB implementation

Status: implemented behind `disabled|shadow|active`

Wire contract: `director-copilot-2`, revision `2.0.2`

## Pinned upstream

- STRATOS: `3190266e21c9f45b9733c62debb2763ee88b1eed`
- AIIP: `d6403cb1c5bbf87032683647e68e5f5a7d473752`
- request SHA-256: `c4faf33dfecc59bba1e7ef28cd2bd315183ffb6583c9a6b4da4dae4e3829bdd5`
- response SHA-256: `22caad5e8dacfd9d3e0451f64c638e91c4d0deb649e091cf1e16fb12e8da51dd`
- manifest SHA-256: `886d613659f7f65c2b4a739681e1fbaf2e577aaa3376ef1996b2af4f93704572`
- error SHA-256: `99949d198294a947366cf099b2af7023979f538fadab8bbec48fffce8e9bdeab`
- OpenAPI SHA-256: `b61e727a0ab9f5a7b37e01fa75fc055cf331a3849914f0db524bea1732219836`
- manifest bundle SHA-256: `b71c94819d3e014792bd329a1a78a73e1d138d627bb88db10a478a37b6a6a3c5`

The production build verifies these hashes and byte identity of runtime schema
copies.

## AKB behavior

1. Load all four source manifests and reject unknown revision, tool, metric,
   fact, relationship, link or reason code.
2. Resolve a bounded conversation state containing source, metric, year or
   interval, granularity and entity filters.
3. Derive requested scopes only from the fresh STRATOS access projection.
4. Obtain a separate service token for every source audience and pass the
   independent current actor bearer.
   The same service client obtains a fifth route-bound token with scope
   `director-copilot-akl-api` and the single audience `akl-api` for the
   mandatory metadata-only Registry audit. A source token, default token or
   interactive user token must not be reused for this audit.
5. Traverse at most five cursor pages and 500 authorized items per tool.
6. Distinguish `complete`, `partial`, `no_data`, `not_authorized` and
   `unavailable`.
7. Reauthorize the actor and exact scope before synthesis.
8. Correlate shared projects only by byte-identical `stratos:project:<id>`.
9. Authorize every `projectflow.project.document` target independently in AKB.
10. Render deterministic live facts. Never compute source-owned financial
    totals and never substitute document RAG for a live-source failure.
11. Persist only a bounded history envelope and re-run the authorized source
    query when history is reopened.
12. Audit tool IDs, schema/source versions, status, counts, latency, scope types
   and correlation identifiers without prompts, answers, tokens or source
   payloads.
13. Build the next-turn entity context only from authorized result items and
    relationships declared by the exact source manifest. A typed
    `archflow.need.linked_project` link replaces the need filter with its
    canonical project target for a ProjectFlow continuation. Coexisting IDs
    are never treated as proof of a relationship.
14. Never send non-empty `budget_scope_ids`, `need_ids` or `idea_ids` to
    ProjectFlow. If no typed path has resolved them to an organization unit,
    portfolio or project, planning stops locally with
    `DIRECTOR_COPILOT_V2_ENTITY_FILTER_RESOLUTION_REQUIRED`; the filter is not
    ignored and the request is not widened.

The central access projection may identify the Budget application as either
`budget` or the STRATOS catalog id `budget-contract`. AKB maps only this closed
alias to the Budget domain. Unknown application ids remain unauthorized.

On `docker.home.cz`, the AKB web containers define
`host.docker.internal:host-gateway`. This permits a source application that is
published only on the host, such as the separate AIIP Compose stack, to be
reached through a stable internal hostname rather than a Docker bridge IP.

## Modes

- `disabled`: V1 only; no V2 manifest or tool calls.
- `shadow`: V1 answer is returned; V2 evaluates after the response and writes
  a metadata-only audit.
- `active`: V2 answer is returned. V1 remains available for rollback.

Activation requires all five route-bound service scopes:

- `director-copilot-akl-api` -> exactly `akl-api`;
- `director-copilot-budget-api` -> exactly `budget-api`;
- `director-copilot-projectflow-api` -> exactly `projectflow-api`;
- `director-copilot-archflow-api` -> exactly `archflow-api`;
- `director-copilot-aiip-api` -> exactly `aiip-api`.

The client must not receive a default or multi-audience token.
Registry must additionally list `svc-akb-director-copilot` as an exact trusted
service client and grant it only the `audit` route family.

Every new chat thread is persisted before its first question and starts with
an empty query state. An explicit organization, organization-unit or portfolio
turn clears incompatible project filters. Follow-up grouping by portfolio
inherits the financial metric and fiscal year without inheriting a project
restriction. Shadow failures record a bounded `failure_reason_code`; a
recognized live-data request is never replaced by document RAG.

The continuation state exposed to the next turn contains canonical entity
identities derived from the authorized response. Governed history still keeps
the original query state inside its reauthorization envelope, so reopening a
thread replays the original authorized request while the visible conversation
continues with the derived entity context.

## Contract closure required upstream

The AKB pinned bundle remains byte-identical with the handoff SHA-256
`b71c94819d3e014792bd329a1a78a73e1d138d627bb88db10a478a37b6a6a3c5`.
At the time of the 2026-07-27 implementation, the STRATOS ProjectFlow runtime
manifest also advertises `PROJECTFLOW_ENTITY_FILTER_UNSUPPORTED`, but that
reason code is absent from the canonical bundle for revision `2.0.2`.

AKB must not add a local exception because unknown runtime reason codes and
manifest drift are fail-closed conditions. Before joint acceptance, STRATOS
must publish one coherent contract closure: preferably an additive revision
with regenerated manifest bundle, fixtures, hashes and handoff. AKB can then
pin that byte-identical revision in a separate contract-only update.

## Joint acceptance

Run one uninterrupted conversation:

1. `Jaký má IT rozpočet na rok 2025?`
2. `Ne jen pro tento projekt, ale celkově.`
3. `Rozděl ho podle portfolií.`
4. `Které projekty překračují plán?`
5. `Které z nich mají současně zpožděný milník?`

Also verify needs without Budget handoff, ideas without ArchFlow handoff,
capability and scope revocation between turns, policy denial, currency
conflict, ambiguous entity, each source outage, history reopening, pagination
and an unauthorized ProjectFlow document link.

Promotion to `active` requires zero data leakage, zero document fallback for
live-data questions, accepted source/audit reason codes, stable latency and a
recorded release SHA for AKB plus every source application.
