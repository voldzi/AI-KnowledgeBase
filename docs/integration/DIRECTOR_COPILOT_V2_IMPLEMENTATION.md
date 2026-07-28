# Director Copilot V2 AKB implementation

Status: production active; V1 retired in AKB

Wire contract: `director-copilot-2`, revision `2.0.3`

## Pinned upstream

- STRATOS: `663e71820b93c5801a27f393eae63a24ba118745`
- AIIP: `32ee68228a9ac29c945f4a876c67dbec878a86ad`
- request SHA-256: `c4faf33dfecc59bba1e7ef28cd2bd315183ffb6583c9a6b4da4dae4e3829bdd5`
- response SHA-256: `22caad5e8dacfd9d3e0451f64c638e91c4d0deb649e091cf1e16fb12e8da51dd`
- manifest SHA-256: `713d8b7d8a3a1b7873d244d4a244c3d08b1f43d0692669656100ba1454ff99a6`
- error SHA-256: `99949d198294a947366cf099b2af7023979f538fadab8bbec48fffce8e9bdeab`
- OpenAPI SHA-256: `9c94e2f75953511d17b178085ac57cf34594dd9f3cb2ed56799093611e8fb373`
- manifest bundle SHA-256: `3cf0248f1db9ee8742af25b546a209ce9bbe9c4938dc9c88240ae45f97245bf5`

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

## Runtime control

`AKL_DIRECTOR_COPILOT_ENABLED=true` enables the only live-data runtime path:
V2. Setting it to `false` does not restore V1; it produces a bounded
fail-closed result for recognized live-data requests.

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
restriction. Failures record a bounded `failure_reason_code`; a recognized
live-data request is never replaced by document RAG.

The continuation state exposed to the next turn contains canonical entity
identities derived from the authorized response. Governed history still keeps
the original query state inside its reauthorization envelope, so reopening a
thread replays the original authorized request while the visible conversation
continues with the derived entity context.

## Contract closure

STRATOS revision `2.0.3` closes the ProjectFlow manifest mismatch. The pinned
bundle now declares `PROJECTFLOW_ENTITY_FILTER_UNSUPPORTED`, and AKB accepts
that code only for the exact ProjectFlow manifest in this revision. Unknown
runtime revisions, hashes, tools, facts, links and reason codes continue to
fail closed. Acceptance is valid only for matching STRATOS, AIIP and AKB
revisions.

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

The accepted production state requires zero data leakage, zero document
fallback for live-data questions, accepted source/audit reason codes, stable
latency and a recorded release SHA for AKB plus every source application.
