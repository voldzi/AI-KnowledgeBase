# RAG Answer Policy

Tento dokument popisuje pravidla pro skladani odpovedi ve sluzbe RAG Retrieval Service.

## Zakladni pravidla

- Odpoved musi vychazet pouze z autorizovanych chunku.
- Kazda odpoved s obsahem musi vratit citace.
- Citace se berou z metadat `RetrievedChunk.citation`.
- Pokud nejsou zdroje dostatecne, sluzba vrati no-answer odpoved.
- Query text, prompt ani plna odpoved se neloguji do technickych logu.

## Prompting

Answer composer posila do LLM Gateway:

- system instrukci, ze odpoved smi pouzit pouze dodany kontext,
- uzivatelsky dotaz,
- seznam vybranych chunku s `chunk_id`, nazvem dokumentu, verzi, sekci a textem.

Do metadata LLM Gateway se posila pouze:

- `purpose`,
- `query_id`,
- pocet chunku,
- `used_chunk_ids`.

## Citace

Response `citations` obsahuje pro kazdy pouzity chunk:

- `document_id`
- `document_version_id`
- `document_title`
- `version_label`
- `section_path`
- `page_number`
- `chunk_id`

Sluzba nepouziva citace z LLM vystupu; citace sklada deterministicky ze schvaleneho kontextu.

## Confidence

Confidence se urcuje pred answer composition podle nejlepsiho rerank score:

- `high`: score >= `AKL_RAG_CONFIDENCE_HIGH_THRESHOLD`
- `medium`: score >= `AKL_RAG_CONFIDENCE_MEDIUM_THRESHOLD`
- `low`: score >= `AKL_RAG_NO_ANSWER_MIN_SCORE`
- `insufficient_source`: zdroje chybi nebo jsou pod prahem
- `conflicting_sources`: rezervovano pro budouci compare/compliance logiku

## Audit

Audit event obsahuje:

- `query_id`,
- confidence,
- `used_chunk_ids`,
- citovane `document_id`,
- warnings,
- SHA-256 hash odpovedi.

Plny text odpovedi se do auditu v teto iteraci neposila.
