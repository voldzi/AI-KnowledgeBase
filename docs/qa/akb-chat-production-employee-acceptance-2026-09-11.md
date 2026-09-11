# AKB Chat Production Employee Acceptance — 2026-09-11

## Result

The production Chat transport, employee identity, STRATOS access projection,
Qdrant retrieval and exact-law resolver are operational. Grounded legal-answer
acceptance failed because the pilot corpus is incomplete and the retrieved PDF
chunks do not yet provide sufficient continuous evidence for the answer model.
The application correctly returned `no_answer` instead of inventing a legal
answer.

## Verified

- public AKB health and readiness returned HTTP 200;
- the MCP token carried `identity_audience=employees` and the exact AKB and
  STRATOS access-projection audiences;
- Access Center accepted the employee and returned an active projection;
- an external bootstrap administrator received no employee sources;
- the employee retrieved 50–64 authorized candidates from the production
  Qdrant/OpenSearch corpus;
- exact identifiers `563/1991 Sb.` and `500/2004 Sb.` restricted retrieval to
  the intended authorized document;
- citation-required evaluation treats an HTTP 200 `no_answer` as a failed
  grounded-answer test.

## Failed acceptance

- five broad legal and organizational questions: 0/5 grounded answers;
- four questions targeting indexed laws: 0/4 grounded answers;
- required citations: 0;
- the initial median Chat latency was 23.45 seconds;
- the failed GTE shadow route added repeated timeouts and lexical fallback.

The initial questions included the Labour Code `262/2006 Sb.`, which was not
present in the current pilot corpus. Metadata-only retrieval checks of indexed
laws showed many short chunks (roughly 99–740 characters); the requested term
could occur below the best-ranked fragments. The answer composer therefore
returned `LLM_DECLINED_INSUFFICIENT_CONTEXT` and the evidence gate returned
`EVIDENCE_GATE_UNSUPPORTED_CLAIMS`.

## Runtime remediation

The production RAG service used the new `akb_app_zone`, while the rollback GTE
reranker and its proxy configuration still referenced `akl_app_zone` and the
old `10.246.241.0/24` gateway. The rollback reranker was connected to the
current application network and verified healthy. Production RAG now points to
`http://gte-reranker:3000`.

Unpromoted RAG V2, adaptive retrieval, parent retrieval and reranker shadow
modes were returned to `off`. This removed known timeout/fallback work and
reduced the repeated exact-law Chat request from 39.87 seconds to 14.86
seconds. The evidence gate remains enforced. Model and authorization settings
remain unchanged.

The repository-owned GTE and BGE rollback compose profiles now join
`akb_app_zone`; the GTE host proxy and documentation use the current
`10.246.246.0/24` application subnet.

## Remaining acceptance gates

1. Complete the approved official-law catalog, including `262/2006 Sb.`.
2. Reprocess the law PDFs with section/article-aware chunks that retain enough
   adjacent text to support complete legal claims.
3. Validate a production-capable reranker endpoint before enabling reranking.
4. Repeat the fixed employee question set with at least one authorized,
   re-openable citation per answer.
5. Record supported-claim rate, citation purity and p95 latency before pilot
   acceptance.

## Prepared remediation

The next release groups official Czech-law PDF items by their enclosing
section or article instead of closing a chunk for every Docling source locator
or page transition. Exact statute identifiers such as `218/2000 Sb.` and
`563/1991 Sb.` take the cited document-retrieval path before live STRATOS data
routing; threshold decisions such as a VZMR limit remain on the governed-rule
path. Existing indexed law versions must be reprocessed after deployment before
the fixed employee question set is repeated.
