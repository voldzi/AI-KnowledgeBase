# Director Copilot V2 AKB handoff closure

Date: 2026-07-27

Source:
`STRATOS/docs/53_DIRECTOR_COPILOT_V2_AKB_HANDOFF.md`

## Implemented in AKB

- fiscal year, metrics, granularity and entity filters survive a governed
  multi-turn conversation;
- Czech wording `překračují plán` resolves to the source-owned Budget plan and
  variance metrics;
- inflected delayed-milestone wording resolves to the delayed schedule filter;
- authorized result items populate a bounded continuation state with canonical
  IDs;
- only manifest-declared typed links may replace one entity filter with another;
- a direct ArchFlow need-to-project link produces the canonical ProjectFlow
  project filter;
- unsupported ProjectFlow `budget_scope_ids`, `need_ids` and `idea_ids` stop
  planning before any source call unless a prior typed result has already
  replaced them with a supported target;
- unrelated coexisting IDs never prove a relationship;
- history persists the continuation context but keeps the original query in
  the governed reauthorization envelope;
- live source failures remain distinct from authorization denial and never
  fall back to document RAG.

## Security properties

No capability, requested scope or relationship is accepted from the prompt.
Requested scopes still come only from the current STRATOS access projection.
Entity conversion is a semantic narrowing operation, not an authorization
grant; the target source independently enforces capability, scope and
Information Policy. Audit and history remain metadata-only.

## Automated acceptance

The focused suite covers:

1. the five-turn reference dialogue;
2. canonical project continuation from an authorized Budget result;
3. typed ArchFlow need-to-project conversion;
4. unresolved unsupported ProjectFlow filters with zero upstream calls;
5. unrelated need and project IDs with zero upstream calls;
6. independent AKB authorization of ProjectFlow document links;
7. access projection change before synthesis;
8. governed history reauthorization.

Verification completed on the final working state:

- web tests: 423 passed, 0 failed;
- TypeScript: passed;
- production Next.js build: passed;
- exact production `web` Docker image build: passed;
- exact production `chat-web` Docker image build: passed;
- pinned Director Copilot V2 contract check: passed;
- repository skeleton: passed;
- OpenAPI index and JSON validation: passed.

## Upstream closure blocker

STRATOS commit history currently contains a ProjectFlow runtime manifest that
advertises `PROJECTFLOW_ENTITY_FILTER_UNSUPPORTED`. The canonical
`director-copilot-2-manifests.json` for wire revision `2.0.2`, SHA-256
`b71c94819d3e014792bd329a1a78a73e1d138d627bb88db10a478a37b6a6a3c5`,
does not contain that reason code.

This is a closed-contract inconsistency. AKB intentionally retains exact
manifest comparison and unknown-reason rejection. Joint acceptance must wait
for STRATOS to publish one coherent additive contract revision with regenerated
manifest bundle, fixtures, OpenAPI/hash evidence and an updated handoff. No
local allow-list exception is permitted.
