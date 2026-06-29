---
type: metric
title: Metriky služby Document AI
tenant_id: stratos
classification: internal
document_type: project_documentation
status: valid
owner: platform-operations
language: cs
external_system: STRATOS_AKB
external_ref: akb-document-ai-metrics
source_uri: s3://akl-documents/stratos/examples/metrics/document-ai-service-levels.pdf
tags: [akb, observability, metrics, rag]
---

# Metriky služby Document AI

Služba Document AI se sleduje přes metriky dostupnosti, latence, úspěšnosti
ingestion, chybovosti RAG dotazů, pokrytí citací a využití modelů.

## Doporučené metriky

- počet dokumentů podle typu, klasifikace a vlastníka,
- počet dokumentů ve stavech REGISTERED, INGESTING, INDEXED a FAILED,
- latence dotazu v employee chatu,
- podíl odpovědí s citací,
- počet odmítnutých dotazů kvůli oprávnění,
- dostupnost LLM gateway a embedding služby.

## Použití

Chat může z metadat připravit tabulky a přehledy bez přímého přístupu k
binárním dokumentům nebo interním storage službám.
