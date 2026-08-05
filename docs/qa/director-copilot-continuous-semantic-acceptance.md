# Director Copilot continuous semantic acceptance

Status: active repository gate.

## Purpose

This suite protects the everyday Czech chat experience without maintaining a
large allowlist of complete sentences. It composes questions from governed
sources, metrics, periods, operations, grouping and common Czech formulations.
The generated questions exercise the same deterministic planner used by the
application.

The suite is additive to the production S1-S10 and isolated N1-N10 acceptance
in `docs/qa/director-copilot-v2-production-acceptance.md`. It does not replace
live contract or authorization testing.

## Coverage

`apps/web/tests/director-copilot-continuous-acceptance.test.ts` evaluates at
least 300 generated live-data questions covering:

- Budget plan, actuals, forecast, commitments and variance;
- ProjectFlow project schedule and delay;
- ArchFlow need readiness and impact;
- fiscal years 2024, 2025 and 2026;
- summary, count, list and rank operations;
- grouping by portfolio, organization unit and schedule status;
- polite, direct and management-report wording;
- continuation of metric, period, operation and grouping;
- fail-closed behavior when a required capability is absent;
- deterministic routing of governed rules, documents and Registry reports;
- mandatory citation gates for governed-rule and document answers.

Focused integration tests additionally verify:

- source-owned completeness for count and ranking;
- rejection of incomplete counts and incompatible entity shapes;
- exact typed need-project-finance relationships;
- fresh authorization before synthesis and history replay;
- safe detail links and independently authorized document citations;
- visible scope, result shape, completeness and source timestamp.

## Quality gates

The generated suite fails when any question selects the wrong source, metric,
period, operation, grouping, intent or domain tool. Every planned node must
have a closed request, an active authorization decision and no planning error.
Deterministic planning p95 must remain below 50 ms in the test runtime.

Counts and absolute rankings may be rendered only from complete source-owned
candidate sets. Document and governed-rule answers require citations. A live
source failure must not be replaced by document RAG.

## Execution

Run the focused semantic and chat gates from `apps/web`:

```bash
pnpm exec node --conditions=react-server --import tsx --test \
  tests/director-copilot-continuous-acceptance.test.ts \
  tests/director-copilot-query-state.test.ts \
  tests/director-copilot-v2-chat.test.ts \
  tests/director-copilot-v2-orchestrator.test.ts \
  tests/chat-layout-css.test.ts
```

Then run the complete web test suite, typecheck and production build. A change
to the semantic catalog, planner, source contract, evidence gate, chat history
or responsive workbench is not complete until these checks pass.

## Extension rule

Add new domain concepts as catalog entries, metrics and generated dimensions.
Do not add thousands of copied full questions. A new source must also provide
a closed tool manifest, authorization projection, completeness semantics,
fixtures, citation or evidence requirements and negative tests before it can
enter this matrix.
