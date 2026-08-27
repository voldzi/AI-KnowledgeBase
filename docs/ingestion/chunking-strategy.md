# Chunking Strategy

Ingestion Service implementuje `legal_structured` logické chunkování pro řízené dokumenty.

## Cíl

Každý chunk musí být citovatelný a musí nést metadata potřebná pro pozdější RAG retrieval:

- dokument a verze,
- stránka,
- sekční cesta,
- článek a odstavec, pokud je parser rozpozná,
- znakový rozsah,
- klasifikace,
- platnost,
- access scope,
- hash textu.

## Vstup

Chunker pracuje nad `ParserResult.blocks`. Každý blok obsahuje:

- text,
- `page_number`,
- `section_path`,
- `section_title`,
- `article_number`,
- `paragraph_number`,
- `char_start`,
- `char_end`,
- typ bloku.

TXT parser rozpoznává `Čl. N`, `Article N`, `Odst. N` a jednoduché číslované
nadpisy. MD používá strukturální CommonMark parser; rozpoznává i samostatné
nadpisy článků a odstavců bez `#`. DOCX zachovává pořadí obsahu a hierarchii
stylových nadpisů. PDF používá stejný výsledný blokový model.
`page_number` je u MD a DOCX bez renderované mapy `null`; nesmí se dopočítat
z pořadí chunku. MD rozsahy odpovídají původnímu textu, DOCX rozsahy
odpovídají extrahovanému textu (`offset_basis=extracted_text`).

## Pravidla

- Chunk se flushne při změně `section_path`.
- Chunk se flushne při překročení `AKL_INGESTION_CHUNK_TARGET_CHARS`.
- Blok větší než `AKL_INGESTION_MAX_CHUNK_CHARS` se rozdělí s překryvem `AKL_INGESTION_CHUNK_OVERLAP_CHARS`.
- Výjimkou jsou tabulky s rozpoznanou hlavičkou: dělí se pouze mezi řádky,
  s opakováním hlavičky a bez duplicitního překryvu řádků. Rozsah pokračování
  odkazuje na jeho původní řádky, samostatná metadata na původní hlavičku.
  Pokud se hlavička s jediným řádkem nevejde do maxima, zpracování skončí
  `TABLE_ROW_EXCEEDS_CHUNK_LIMIT`; hodnoty se potichu nekrátí ani nepřesouvají.
- `chunk_id` je deterministický hash z `document_version_id`, indexu chunku a `text_hash`.
- `text_hash` je `sha256` normalizovaného textu.
- Qdrant point id je UUID odvozené z `chunk_id`; kontraktové `chunk_id` zůstává v payloadu.

## Výstup

Výstupní payload odpovídá `DocumentChunk` kontraktu:

```json
{
  "chunk_id": "chunk_...",
  "document_id": "doc_123",
  "document_version_id": "ver_456",
  "text": "Text chunku.",
  "normalized_text": "text chunku.",
  "page_number": 7,
  "section_path": ["Čl. 4", "Odst. 2"],
  "section_title": "Schvalování výjimek",
  "article_number": "4",
  "paragraph_number": "2",
  "char_start": 1200,
  "char_end": 2450,
  "text_hash": "sha256:...",
  "classification": "internal",
  "valid_from": "2026-07-01",
  "valid_to": null,
  "access_scope": ["role:reader"],
  "metadata": {
    "parser": "plain_text",
    "parser_profile": "controlled_document",
    "chunking_strategy": "legal_structured"
  }
}
```

## Limity

Výchozí limity:

- target chunk size: 1400 znaků,
- overlap: 160 znaků,
- max chunk size: 3000 znaků,
- max chunks per job: 5000.

Pokud chunk count překročí limit, job skončí jako `failed` s kódem `CHUNK_LIMIT_EXCEEDED`.
