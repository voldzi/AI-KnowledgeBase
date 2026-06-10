# Plán spuštění CODEX vláken

Odkaz na centrální zadání: `00_CENTRALNI_ZADANI_AKL_PLATFORM.md`

---

## 1. Základní strategie

Nespouštět všechna vlákna současně.

Doporučený paralelní běh:

```text
3–4 CODEX vlákna současně
```

Každé vlákno je služba nebo velký odpovědnostní celek.

---

## 2. Vlna 1 — základ platformy

Spustit současně:

1. `CODEX_THREADS/01_CODEX_PLATFORM_INFRASTRUCTURE.md`
2. `CODEX_THREADS/02_CODEX_IDENTITY_DOCUMENT_REGISTRY_API.md`
3. `CODEX_THREADS/05_CODEX_LLM_GATEWAY_SERVICE.md`
4. `CODEX_THREADS/06_CODEX_WEB_FRONTEND.md`

Cíl:

- vytvořit infrastrukturu,
- vytvořit registry API,
- vytvořit LLM abstraction,
- vytvořit frontend skeleton,
- sjednotit kontrakty.

---

## 3. Vlna 2 — dokumentové zpracování a RAG

Spustit po základním ukotvení kontraktů:

1. `CODEX_THREADS/03_CODEX_INGESTION_SERVICE.md`
2. `CODEX_THREADS/04_CODEX_RAG_RETRIEVAL_SERVICE.md`

Cíl:

- zpracování dokumentů,
- chunking,
- embedding,
- Qdrant indexace,
- retrieval,
- odpovědi s citacemi.

---

## 4. Vlna 3 — kvalita a governance

Spustit až po základním RAG toku:

1. `CODEX_THREADS/07_CODEX_EVALUATION_SERVICE.md`
2. `CODEX_THREADS/08_CODEX_GOVERNANCE_COMPLIANCE_SERVICE.md`

Cíl:

- měřit kvalitu RAG,
- detekovat rozpory,
- porovnávat verze,
- kontrolovat soulad dokumentů,
- generovat KB články.

---

## 5. Doporučené merge pořadí

```text
1. Platform / Infrastructure
2. Registry API
3. LLM Gateway
4. Web Frontend skeleton
5. Ingestion Service
6. RAG Retrieval Service
7. Evaluation Service
8. Governance Service
```

---

## 6. Integrační milníky

### Milník A — platform skeleton

- všechny služby mají healthcheck,
- Docker Compose běží,
- frontend ukáže status služeb.

### Milník B — document registry

- lze vytvořit dokument,
- lze vytvořit verzi,
- lze uložit metadata,
- funguje audit.

### Milník C — ingestion

- lze spustit ingestion job,
- vzniknou chunky,
- vznikne ingestion report.

### Milník D — RAG

- dotaz vrátí citovanou odpověď,
- při nedostatku zdrojů vrátí no-answer,
- retrieval respektuje oprávnění.

### Milník E — governance

- lze porovnat dvě verze,
- lze spustit eval dataset,
- lze detekovat potenciální konflikt.

---

## 7. Doporučení pro řízení CODEX

Po každé vlně:

- udělat integrační merge,
- spustit testy,
- aktualizovat kontrakty,
- odstranit duplicitní implementace,
- sjednotit názvosloví,
- vyřešit breaking changes.

---

## 8. Praktická poznámka

Pokud máš omezený počet souběžných CODEX úloh, začni pouze těmito třemi:

1. Platform / Infrastructure
2. Registry API
3. LLM Gateway

Frontend může začít s mocky, ale není blokující pro backendový základ.
