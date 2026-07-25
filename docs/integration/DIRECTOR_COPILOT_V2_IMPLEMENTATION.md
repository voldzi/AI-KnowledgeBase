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

## Modes

- `disabled`: V1 only; no V2 manifest or tool calls.
- `shadow`: V1 answer is returned; V2 evaluates after the response and writes
  a metadata-only audit.
- `active`: V2 answer is returned. V1 remains available for rollback.

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
