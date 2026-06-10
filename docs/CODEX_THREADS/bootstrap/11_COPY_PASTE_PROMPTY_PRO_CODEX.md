# Copy-paste prompty pro CODEX

Tento dokument obsahuje krátké startovací prompty pro jednotlivá vlákna. Detailní zadání je v `CODEX_THREADS/`.

---

## Platform / Infrastructure

```text
Otevři a dodržuj dokument CODEX_THREADS/01_CODEX_PLATFORM_INFRASTRUCTURE.md.
Nejdříve načti centrální zadání a kontrakty, potom vytvoř infrastrukturu služby podle Definition of Done.
```

## Identity & Document Registry API

```text
Otevři a dodržuj dokument CODEX_THREADS/02_CODEX_IDENTITY_DOCUMENT_REGISTRY_API.md.
Implementuj pouze Registry API, datový model, oprávnění a audit. Neimplementuj ingestion ani RAG.
```

## Ingestion Service

```text
Otevři a dodržuj dokument CODEX_THREADS/03_CODEX_INGESTION_SERVICE.md.
Implementuj pouze ingestion, parsing, OCR, chunking, embedding a indexaci podle kontraktů.
```

## RAG Retrieval Service

```text
Otevři a dodržuj dokument CODEX_THREADS/04_CODEX_RAG_RETRIEVAL_SERVICE.md.
Implementuj pouze retrieval, reranking, answer composer, citace a no-answer policy podle kontraktů.
```

## LLM Gateway Service

```text
Otevři a dodržuj dokument CODEX_THREADS/05_CODEX_LLM_GATEWAY_SERVICE.md.
Implementuj jednotné LLM API nad Ollama, vLLM/OpenAI-compatible a mock providerem.
```

## Web Frontend

```text
Otevři a dodržuj dokument CODEX_THREADS/06_CODEX_WEB_FRONTEND.md.
Implementuj Next.js frontend s mock API klienty a čistým oddělením produkčních klientů.
```

## Evaluation Service

```text
Otevři a dodržuj dokument CODEX_THREADS/07_CODEX_EVALUATION_SERVICE.md.
Implementuj službu pro měření kvality RAG odpovědí, citací a retrievalu.
```

## Governance / Compliance Service

```text
Otevři a dodržuj dokument CODEX_THREADS/08_CODEX_GOVERNANCE_COMPLIANCE_SERVICE.md.
Implementuj pokročilé governance funkce s citacemi, zdroji a mírou jistoty.
```
