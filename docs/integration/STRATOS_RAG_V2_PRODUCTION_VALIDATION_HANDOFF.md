# STRATOS RAG V2 Production Validation Handoff

## Purpose

STRATOS must validate the Director Copilot against the AKB RAG V2 shadow
pipeline. This handoff authorizes testing only. It does not authorize STRATOS
to change AKB feature flags, retrieval contracts, infrastructure or source.

The first production run on 2026-07-23 failed correctly because of reranker
fallback, exact-document citation contamination, latency and incomplete
coverage of the mandatory gates. Repeat the same dataset after AKB reports the
remediation release hash. Do not replace failed cases or change their expected
evidence between runs.

AKB now owns the machine-enforced promotion contract:

- retrieval and answer dataset:
  `quality/datasets/professional_czech_knowledge_v2.json`;
- live authorization mutation contract:
  `quality/datasets/rag_v2_authorization_v1.json`;
- fail-closed evidence validator: `scripts/check_rag_v2_release.py`.

STRATOS must not reimplement metric thresholds. It must execute the ten access
projection mutations, attach non-sensitive outcomes and latency comparison to
the AKB evaluation report, then run the AKB validator.

Before the run, record the exact AKB version returned by
`https://stratos.zeleznalady.cz/akb/api/health`. Require `/api/ready` to report
all dependencies ready.

## Required scenarios

1. Repeat the accepted Director Copilot vertical suite: Budget, ProjectFlow and
   AKB documentary evidence, including reauthorization immediately before
   answer synthesis.
2. Repeat all ten established positive and negative scenarios. Require zero
   authorization leakage.
3. Ask the exact-document question: `Jaké jsou hlavní povinnosti a sankce ve
   smlouvě 120-2022-S? Odpovězte pouze z dokumentu a uveďte citace.`
4. Assert that every citation in the exact-document response belongs to the
   selected document and version. Any unrelated citation fails the run.
5. Exercise revoked access, expired access projection, incorrect audience,
   tenant isolation and a document outside the actor's allowed classification.
6. After each authorization mutation, verify that the next synthesis reflects
   the current projection and does not reuse a stale authorized result.
7. Collect at least 30 representative requests for latency comparison. Preserve
   the earlier accepted baseline of 5.258 seconds total p95 and 472 ms domain
   service p95 as comparison evidence.
8. Confirm that the reranker completes without lexical fallback for the exact
   contract request and every successful evaluation request. Record reranking
   latency separately.
9. Confirm that `120-2022-S` is routed as an exact-document request. A
   cross-document, temporal or generic semantic route is a failure.
10. Confirm that Czech Collection of Laws references such as `365/2000 Sb.`
    are routed as `exact` and report `exact_document_scope_applied=true` when
    one authorized document matches.

## Acceptance gates

- authorization leaks: `0`;
- exact-document citation purity: `100%`;
- recall at 50: at least `0.98`;
- recall at 8: at least `0.92`;
- nDCG at 8: at least `0.85`;
- supported-claim rate: at least `0.98`;
- false-answer rate: at most `0.02`;
- adaptive-router accuracy: at least `0.95`;
- p95 latency regression against the accepted baseline: at most `30%`;
- no `reranker_fallback` for successful acceptance requests.

Failure of any gate leaves AKB RAG V2 in shadow. Do not request promotion to
`enforce` and do not enable ColBERT.

An improved reranker and exact-document result do not waive an unmeasured
gate. Report such a run as remediation verified but promotion blocked.

## Evidence to return to AKB

Return one machine-readable report and one concise operator summary containing:

- exact STRATOS and AKB release hashes;
- scenario ID, outcome and actor role, without tokens or credentials;
- request and correlation IDs;
- target document and version IDs plus returned citation document IDs;
- warning and refusal codes;
- total, domain-tool, retrieval, reranking and synthesis latencies where
  available;
- confirmation that prompts, answers, document bodies and credentials were not
  written to logs;
- a separate list of every fallback, timeout, stale-authorization result or
  citation-purity failure.

Do not include bearer tokens, service credentials, prompts, generated answers
or document text in the evidence package.

Validate the returned package from the AKB repository root:

```bash
python3 scripts/check_rag_v2_release.py \
  quality/datasets/professional_czech_knowledge_v2.json \
  /path/to/evaluation-report.json \
  quality/datasets/rag_v2_authorization_v1.json \
  /path/to/authorization-report.json
```
