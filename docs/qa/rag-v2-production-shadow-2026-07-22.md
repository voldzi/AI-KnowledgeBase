# RAG V2 Production Shadow Evidence

## Scope

This record covers the first production shadow activation of the AKB RAG V2
pipeline on 22 July 2026. Shadow mode is evidence gathering, not approval to
replace the established ranking path.

## Deployed architecture

- AKB RAG uses the Qdrant V2 dense collection with 67,616 points and collection
  status `green`.
- The verified corpus digest is
  `d53d5c70a622f4ec7046b0088ea1bece96c012475495deaafc6fa6186749170c`.
- Adaptive retrieval, parent retrieval, evidence gate, V2 retrieval and the
  Qwen3 cross-encoder reranker run in `shadow` mode.
- ColBERT remains `off`.
- Qwen3-Reranker-0.6B runs natively on Apple Silicon through `llama-server`
  with Metal acceleration. Docker provides authenticated transport proxies;
  it does not host the Metal inference process.
- AKB uses three ordered internal proxy endpoints. Endpoint URLs and
  credentials are not emitted in logs.

## Measured evidence

- The native reranker scored 16 representative candidates in approximately
  0.86 seconds after warm-up. The former Docker-only Mac runtime took about
  15.25 seconds for the same class of request.
- The initial production document query completed but emitted
  `reranker_fallback reason=ConnectError`. The cause was the isolated AKB
  application network lacking a route to the Mac VPN address.
- A host-network proxy on `docker.home.cz` now exposes the three approved
  reranker targets to the isolated application network through its stable host
  gateway. Direct health from the RAG container succeeds.
- The initial query returned six citations, three of which referenced the
  requested document and three unrelated documents. This is a failed
  exact-document citation-purity criterion and prevents promotion from shadow
  to enforce mode until the corrected route is retested and the ranking quality
  suite passes.

## Safety and rollback

- Shadow failure preserves the established lexical ranking path.
- Set the individual RAG V2 modes and reranker mode to `off` to roll back
  behavior without deleting V1 or V2 index data.
- Do not enable reranker `enforce` or ColBERT based only on infrastructure
  health. Promotion requires the evaluation thresholds in
  `docs/evaluation/rag-v2-mode-comparison.md` and the STRATOS acceptance run.
- Logs may contain mode names, endpoint count, model identifiers, request IDs
  and latency. They must not contain endpoint credentials, prompts, answers or
  document content.

## Remaining acceptance

1. Repeat the exact-document query for `120-2022-S` and confirm no
   `reranker_fallback` event for its request ID.
2. Require 100 percent citation purity for the explicit document scope.
3. Run the Director Copilot integration suite from the STRATOS handoff.
4. Compare shadow and established rankings over the governed evaluation set.
5. Keep RAG V2 in shadow until all quality, authorization and latency gates
   pass.
