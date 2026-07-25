# Czech embedding shadow comparison

## Purpose

AKB keeps `BAAI/bge-m3` at 1024 dimensions as the production baseline and
prepares two isolated candidates:

- `Qwen/Qwen3-Embedding-0.6B`, multilingual, 1024 dimensions;
- `Seznam/simcse-retromae-small-cs`, Czech specialist, 256 dimensions.

The profile set is versioned in
`services/evaluation-service/datasets/czech_embedding_shadow_profiles.json`.
This change does not download a model, create a production endpoint, reindex
the corpus or affect answers.

## Isolation rules

Each profile has a separate Qdrant collection. Dimensions from different
models must never share a collection. Candidate query vectors are evaluated
only against the collection indexed by the same candidate model. Candidate
outputs do not enter generation, citations, authorization decisions or the
user-visible ranking.

The Seznam model is distributed under CC BY 4.0 and therefore requires
attribution in operational and product documentation if promoted.

## Execution order

1. STRATOS provisions separately authenticated internal embedding endpoints.
2. AKB verifies model identity, dimensions and a bounded embedding smoke.
3. Ingestion backfills the same immutable authorized corpus into each shadow
   collection without changing `document_chunks_v2`.
4. Evaluation runs the same Czech retrieval and no-answer cases against all
   profiles and records recall, nDCG, citation traceability, false-answer rate,
   latency and resource use.
5. A candidate may be proposed for promotion only when every gate in the
   profile set passes and the attribution, backup and rollback plan is
   approved.

Run the offline manifest check with:

```bash
python3 scripts/check_embedding_shadow_profiles.py
```
