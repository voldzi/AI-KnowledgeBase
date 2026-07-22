# Director Copilot and RAG V2 Integration

Date: 2026-07-22

Status: verified on branch `codex/rag-v2-reranker-runtime`; not deployed and
all RAG V2 production modes remain opt-in.

## Integrated baselines

- accepted Director Copilot application release: `89d46f7c`;
- accepted Director Copilot RAG component: `ff045944`;
- accepted production evidence merge: `98309edf`;
- RAG V2 implementation before integration: `1fa47a36`;
- common ancestor: `c50851e3`.

The integration preserves fresh STRATOS projection reauthorization before
synthesis, the bounded three-chunk Director path, complete Information Policy
V2 citation projection, deterministic contract excerpts, disabled conversation
persistence and no generative LLM call for Director document findings.

## Additional integration controls

- Regular `/assistant/chat` generation now passes through the evidence gate
  when that layer is enabled.
- The deterministic Director extract is not sent to a model verifier because it
  contains only bounded text copied from already authorized chunks.
- Cross-encoder and ColBERT failures use lexical fallback only in `shadow`.
  In `enforce`, an unavailable model returns no candidates and therefore a
  governed no-answer.
- Retrieval warnings are retained in assistant responses.

## Verification

| Check | Result |
| --- | --- |
| web unit/contract tests | 311 passed |
| web TypeScript typecheck | passed |
| web production build | passed; 34 route groups generated |
| RAG retrieval service | 160 passed |
| ingestion service | 91 passed |
| Director release validator tests | 6 passed |
| Director production report gate | 10 cases passed; authorization leak rate 0 |
| RAG and ingestion Docker images | built |
| skeleton and OpenAPI freshness | passed |
| development and docker.home.cz Compose render | passed |
| diff and Python syntax checks | passed |

The validated production baseline remains p95 5258 ms from five positive
samples. It is a regression reference, not a statistically sufficient load
test. No V2 collection switch, backfill, shadow call or production environment
change was performed by this integration.

## Next promotion gate

Deploy the combined code with every V2 mode set to `off`, repeat the ten-case
Director acceptance and collect a larger latency sample. Only then start V2
dual-write/backfill and layer-by-layer shadow evaluation. Synchronous shadow
model calls must remain inside the total Copilot latency budget before any
production shadow activation.
