# Director Copilot V2 AKB implementation

Status: production active; V1 retired in AKB

Wire contract: `director-copilot-2`, revision `2.0.3`

## Pinned upstream

- STRATOS: `663e71820b93c5801a27f393eae63a24ba118745`
- request SHA-256: `c4faf33dfecc59bba1e7ef28cd2bd315183ffb6583c9a6b4da4dae4e3829bdd5`
- response SHA-256: `22caad5e8dacfd9d3e0451f64c638e91c4d0deb649e091cf1e16fb12e8da51dd`
- manifest SHA-256: `713d8b7d8a3a1b7873d244d4a244c3d08b1f43d0692669656100ba1454ff99a6`
- error SHA-256: `99949d198294a947366cf099b2af7023979f538fadab8bbec48fffce8e9bdeab`
- OpenAPI SHA-256: `9c94e2f75953511d17b178085ac57cf34594dd9f3cb2ed56799093611e8fb373`
- manifest bundle SHA-256: `a13c8b1e9724c7547bbf6cc7936c8f06c9bbea587beab230a754ac67e69e7716`

The production build verifies these hashes and byte identity of runtime schema
copies. The immutable `2.0.3` bundle still contains the retired AIIP manifest;
AKB preserves those bytes for contract verification but excludes that manifest
from the active runtime catalog.

## AKB behavior

1. Load the active Budget, ProjectFlow and ArchFlow source manifests and reject
   unknown revision, tool, metric, fact, relationship, link or reason code.
2. Resolve a bounded conversation state containing source, metric, year or
   interval, granularity and entity filters.
3. Derive requested scopes only from the fresh STRATOS access projection.
4. Obtain a separate service token for every source audience and pass the
   independent current actor bearer.
   The same service client obtains another route-bound token with scope
   `director-copilot-akl-api` and the single audience `akl-api` for the
   mandatory metadata-only Registry audit. A source token, default token or
   interactive user token must not be reused for this audit.
5. Traverse at most five cursor pages and 500 authorized items per tool for
   list and detail queries. For a count, traverse every cursor page up to the
   same 500-item safety bound; AKB returns a count only when the unique loaded
   items equal the source-owned `candidate_count`, the final cursor is empty,
   the final page is complete, and every intermediate page is a warning-free
   pagination partial. Cursor-only partial status is not propagated to the
   aggregate. Any candidate-count drift, duplicate canonical identity,
   source-version or period drift, material warning, incomplete final page or
   unfinished sequence remains fail-closed. A rejected count sequence is also
   recorded as failed evidence; it cannot appear as evidence-passed merely
   because no source items were rendered.
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

For a partial organization aggregate, the chat labels the source as an
**authorized part of the organization** and states directly beside the result
that it is not complete for the entire organization. A recognized Budget
reason is rendered in user language: for example, missing approved plans mean
that the affected authorized branches are excluded and are never replaced by
zero. Technical reason codes remain in the API and audit metadata. AKB never
presents a partial aggregate as an organization-wide total.

The central access projection may identify the Budget application as either
`budget` or the STRATOS catalog id `budget-contract`. AKB maps only this closed
alias to the Budget domain. Unknown application ids remain unauthorized.

ArchFlow is the single source for organizational needs and submitted ideas.
AI-related needs and ideas are recognized only in the ArchFlow context; AKB
does not retain a historical AIIP query route or replay old AIIP history.

## Runtime control

`AKL_DIRECTOR_COPILOT_ENABLED=true` enables the only live-data runtime path:
V2. Setting it to `false` does not restore V1; it produces a bounded
fail-closed result for recognized live-data requests.

Activation requires these four route-bound service scopes:

- `director-copilot-akl-api` -> exactly `akl-api`;
- `director-copilot-budget-api` -> exactly `budget-api`;
- `director-copilot-projectflow-api` -> exactly `projectflow-api`;
- `director-copilot-archflow-api` -> exactly `archflow-api`.

The client must not receive a default or multi-audience token.
Registry must additionally list `svc-akb-director-copilot` as an exact trusted
service client and grant it only the `audit` route family.

Every new chat thread is persisted before its first question and starts with
an empty query state. An explicit organization, organization-unit, portfolio
or item turn clears incompatible project filters. Budget item questions use
the closed `item` granularity and `budget_item` grouping. The query state also
records whether the user requested a summary, list, count or ranking. This
requested shape is independent from the authorization scope: an organization
grant bounds which items may be returned but does not turn an item question
into an organization aggregate. AKB rejects a response whose entity type does
not match the requested shape. Comparative wording
such as highest or lowest is evaluated only over a complete authorized result
with comparable currencies; incomplete results are not presented as an
absolute maximum or minimum. Follow-up grouping by portfolio inherits the
financial metric and fiscal year without inheriting a project restriction.
Failures record a bounded `failure_reason_code`; a recognized live-data
request is never replaced by document RAG.

Budget action questions such as "kolik akcí je v plánu" and "jaká je největší
akce" use item granularity with `group_by: ["procurement_action"]`. The
response must contain non-aggregate `stratos:procurement-action:` entities
with `procurement_action.display_name` and
`procurement_action.planned_amount`; an organization aggregate is rejected.
This preserves the authorization and Information Policy filtering performed by
Budget while allowing AKB to count or rank only the complete returned set.
Contract hash or manifest-shape drift is exposed as the safe reason code
`DIRECTOR_COPILOT_V2_MANIFEST_DRIFT`. Transport and availability failures remain
`DIRECTOR_COPILOT_V2_MANIFEST_UNAVAILABLE`.

For a compositional question, all selected Budget, ProjectFlow and ArchFlow
nodes execute concurrently. Rendering may combine Budget and ProjectFlow only
through the same canonical `stratos:project:*` identity. A need can join a
project only through the manifest-declared `archflow.need.linked_project`
relationship. ProjectFlow document links are counted or cited only after an
independent AKB authorization check for the target document.

The continuation state exposed to the next turn contains canonical entity
identities only when the authorized response identifies exactly one candidate
or a complete comparable ranking yields one winner. Broad lists and partial
rankings do not populate entity filters. Governed history still keeps
the original query state inside its reauthorization envelope, so reopening a
thread replays the original authorized request while the visible conversation
continues with the derived entity context.

Every successful source result passes an evidence gate before synthesis. The
gate validates source version and timestamps, completeness counters, item and
fact provenance, relationship declarations and the requested entity shape.
Counts require source-owned complete `candidate_count`; ranking requires the
complete candidate set, a numeric declared metric and compatible currencies.
Failure produces a bounded `LIVE_DATA_EVIDENCE_*` reason, blocks document RAG
fallback and is included in the content-free audit metadata.

## Universal semantic planning

AKB does not maintain a list of complete user questions. The deterministic
planner composes each turn from independently versioned concepts:

- governed source application;
- source-owned metric;
- period or explicit interval;
- organization, unit, portfolio, project or item granularity;
- summary, list, count or rank operation;
- optional grouping and ordering independent from the selected metric;
- authorized entity filters;
- schedule state, ranking direction and document-evidence request;
- bounded context inherited from the previous authorized turn.

The semantic catalog stores domain concepts and approved aliases rather than
sentence templates. A conservative lexeme matcher recognizes Czech and English
inflection, while source ownership prevents a generic word such as `plan` or
`status` from activating an unrelated application. The same metric therefore
works with many sentence forms and can be combined independently with a year,
scope, ranking or grouping. Generated compositional tests and negative
conversation tests protect this behavior from expanding into broad,
unauditable keyword matching.

Routing does not require an LLM and cannot grant access. A recognized governed
data question is resolved through Director Copilot V2. Exact registry
inventory is handled by deterministic Registry tools. Document questions use
authorized OpenSearch/Qdrant retrieval and citations. The LLM is reserved for
grounded synthesis, final natural-language formulation or genuinely generative
conversation after the relevant authorization and evidence gates. A genuinely
ambiguous first-turn `plan` question asks whether the user means financial plan
or delivery schedule. A follow-up in a conversation with one active source
inherits that source instead of asking again. Unknown or unsupported concepts
must produce clarification, `no_data` or an explicit bounded failure; they
must not be converted into invented live facts.

Cross-source granularity is resolved per application. In one joined
need-project-finance question, ArchFlow returns needs, ProjectFlow returns
projects and Budget returns project-level financial facts. AKB does not force
one global entity shape on every source and never infers a relationship from
co-occurrence alone.

Every rendered live-source section identifies the authorized scope, requested
result shape, completeness status and source timestamp. Lists explicitly state
how many matching items are shown, rankings identify the complete candidate
set and counts are labelled complete or partial. Safe source-owned deep links
open the corresponding detail; technical canonical identifiers remain hidden.

The chat workbench keeps the transcript as the primary surface. Supporting
thread and source panels can be hidden and resized by pointer, touch or
keyboard on wide screens. At compact widths they become independently
closable drawers with backdrop and Escape handling; focus returns to the
control that opened the drawer.

The continuous semantic acceptance suite is documented in
`docs/qa/director-copilot-continuous-semantic-acceptance.md`. It generates
hundreds of Czech wording combinations from concepts, not copied sentence
allowlists, and verifies tool selection, operation, period, grouping,
authorization, evidence gates, citations, continuation and deterministic
planning latency.

General VZMR questions are resolved from the governed controlled-rule catalog,
not document similarity. They present authoritative statutory thresholds first
and then independently applicable supplemental internal procedures. An
explicit statutory-only or internal-only question stays narrow. Rules with the
same normative meaning remain subject to precedence and conflict gates.

## Contract closure

STRATOS revision `2.0.3` closes the ProjectFlow manifest mismatch. The pinned
bundle now declares `PROJECTFLOW_ENTITY_FILTER_UNSUPPORTED`, and AKB accepts
that code only for the exact ProjectFlow manifest in this revision. Unknown
runtime revisions, hashes, tools, facts, links and reason codes continue to
fail closed. Acceptance is valid only for matching STRATOS and AKB revisions.

## Joint acceptance

Run one uninterrupted conversation:

1. `Jaký má IT rozpočet na rok 2025?`
2. `Ne jen pro tento projekt, ale celkově.`
3. `Rozděl ho podle portfolií.`
4. `Které projekty překračují plán?`
5. `Které z nich mají současně zpožděný milník?`

Also verify needs and ideas without Budget handoff,
capability and scope revocation between turns, policy denial, currency
conflict, ambiguous entity, each source outage, history reopening, pagination
and an unauthorized ProjectFlow document link.

The accepted production state requires zero data leakage, zero document
fallback for live-data questions, accepted source/audit reason codes, stable
latency and a recorded release SHA for AKB plus every source application.
