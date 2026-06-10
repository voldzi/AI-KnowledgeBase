# AKL Platform — centrální zadání projektu

**Projekt:** AKL — AI Knowledge Library
**Cíl:** lokální AI znalostní knihovna pro řízenou dokumentaci, směrnice, vyhlášky, metodiky a interní knowledge base.
**Datum návrhu:** 2026-06-05
**Architektonický princip:** distribuovaná platforma samostatně nasaditelných služeb s pevnými API kontrakty.

---

## 1. Proč tento projekt vzniká

Cílem není vytvořit obyčejného chatbota nad PDF. Cílem je vytvořit interní platformu, která umožní:

- evidovat řízené dokumenty,
- pracovat s verzemi a platností dokumentů,
- importovat a zpracovávat dokumenty,
- vytvářet strukturované chunky s citovatelnými metadaty,
- provádět RAG dotazování nad dokumenty,
- odpovídat pouze s dohledatelnými citacemi,
- respektovat role a oprávnění,
- udržovat auditní stopu dotazů, odpovědí a změn,
- provozovat vše lokálně nebo v izolovaném prostředí,
- nasadit jednotlivé služby na různých serverech.

---

## 2. Základní architektonické pravidlo

Každá hlavní část systému je samostatná služba.

Služby:

1. **Platform / Infrastructure**
2. **Identity & Document Registry API**
3. **Ingestion Service**
4. **RAG Retrieval Service**
5. **LLM Gateway Service**
6. **Web Frontend**
7. **Evaluation Service** — volitelně, ale doporučeno
8. **Governance / Compliance Service** — pokročilá fáze

Každá služba musí splňovat:

- samostatné spuštění,
- vlastní konfigurace přes environment variables,
- vlastní healthcheck,
- vlastní README,
- vlastní testy,
- jasné API rozhraní,
- žádné přímé importy interního kódu jiné služby,
- žádné přímé přístupy do databází jiných služeb bez výslovně schváleného kontraktu,
- schopnost běžet na jiném serveru.

---

## 3. Logický pohled na systém

```text
[Web Frontend]
      |
      | HTTPS / REST
      v
[Identity & Document Registry API]
      |
      | REST / Events
      v
[Ingestion Service] -----> [Object Storage / MinIO]
      |                             |
      |                             v
      |                     originální dokumenty
      |
      v
[Qdrant Vector DB]

[RAG Retrieval Service] ---> [Document Registry API]
        |                    [Qdrant]
        |                    [LLM Gateway Service]
        v
[LLM Gateway Service] ---> [Ollama / vLLM / OpenAI-compatible endpoint]

[Evaluation Service] ---> [RAG Retrieval Service]
                     ---> [Document Registry API]

[Governance Service] ---> [Document Registry API]
                     ---> [RAG Retrieval Service]
```

---

## 4. Cílový technologický směr

| Oblast | Doporučený směr |
|---|---|
| Backend služby | Python FastAPI |
| Frontend | Next.js / React |
| Metadata DB | PostgreSQL |
| Vector DB | Qdrant |
| Object storage | MinIO nebo lokální filesystem abstraction |
| LLM runtime pro lokální profil | Ollama |
| LLM runtime pro produkci | vLLM / OpenAI-compatible API |
| Auth | Keycloak / OIDC / JWT |
| Dokument parser | Docling, Apache Tika fallback, plain text fallback |
| OCR | Tesseract nebo jiný výměnný OCR provider |
| Observability | Prometheus, Grafana, Loki |
| Deployment | Docker Compose, později Kubernetes nebo VM deployment |
| API dokumentace | OpenAPI |
| Event kontrakty | AsyncAPI / JSON event schema |

---

## 5. Service-oriented rozpad

### 5.1 Platform / Infrastructure

Zajišťuje infrastrukturu a provozní základ:

- Docker Compose,
- reverse proxy,
- TLS termination,
- PostgreSQL,
- Qdrant,
- MinIO,
- Keycloak,
- Ollama / vLLM,
- monitoring,
- logování,
- backup/restore,
- lokální dev prostředí.

### 5.2 Identity & Document Registry API

Centrální backendová služba:

- uživatelé,
- role,
- oprávnění,
- dokumenty,
- verze dokumentů,
- metadata,
- stavy,
- platnost,
- klasifikace,
- audit,
- API pro frontend i ostatní služby.

### 5.3 Ingestion Service

Služba pro zpracování dokumentů:

- převzetí dokumentu,
- parsing,
- OCR,
- extrakce struktury,
- chunking,
- embedding,
- indexace do Qdrant,
- ingestion report,
- bulk import.

### 5.4 RAG Retrieval Service

AI vyhledávací a odpovědní služba:

- query analysis,
- hybrid retrieval,
- metadata filtering,
- permission-aware retrieval,
- reranking,
- answer composition,
- citace,
- confidence,
- no-answer policy,
- porovnávání dokumentů,
- kontrola souladu.

### 5.5 LLM Gateway Service

Abstrakční vrstva nad LLM:

- jednotné API pro chat completion,
- streaming,
- embeddings,
- model listing,
- routing na Ollama/vLLM/OpenAI-compatible backend,
- retry,
- timeout,
- bezpečné logování.

### 5.6 Web Frontend

Uživatelské rozhraní:

- dashboard,
- registr dokumentů,
- upload wizard,
- detail dokumentu,
- historie verzí,
- chat s citacemi,
- ingestion status,
- audit viewer,
- administrace.

### 5.7 Evaluation Service

Měření kvality RAG:

- testovací sady otázek,
- expected answer,
- expected citation,
- retrieval precision/recall,
- faithfulness,
- hallucination checks,
- HTML/JSON/CSV report.

### 5.8 Governance / Compliance Service

Pokročilé řízení dokumentace:

- porovnání verzí,
- detekce rozporů,
- kontrola návrhu dokumentu vůči platné dokumentaci,
- návrh KB článků,
- hlídání končící platnosti.

---

## 6. Sdílené kontrakty

Detailní kontrakty jsou v samostatných dokumentech:

- `CONTRACTS/03_API_KONTRAKTY_OPENAPI.md`
- `CONTRACTS/04_EVENT_KONTRAKTY_ASYNCAPI.md`
- `CONTRACTS/05_DATOVE_KONTRAKTY.md`
- `CONTRACTS/06_SECURITY_AUTHZ_MODEL.md`

Každé CODEX vlákno musí tyto dokumenty respektovat.

Pokud služba potřebuje změnit kontrakt:

1. změnu popíše v návrhu,
2. uvede dopad na ostatní služby,
3. upraví příslušný kontraktní dokument,
4. přidá migration poznámku,
5. neprovede breaking change bez explicitního záznamu v ADR.

---

## 7. Zásady pro RAG odpovědi

Normativní odpovědi musí být striktní.

Systém musí:

- odpovídat z citovaných zdrojů,
- uvádět dokument, verzi, sekci, článek/paragraf, stránku nebo chunk,
- rozlišit platný, archivní, draft a nahrazený dokument,
- oznámit konflikt mezi dokumenty,
- odmítnout odpověď, pokud není dostatečný zdroj,
- nikdy nepředstírat jistotu, pokud zdroj chybí.

Doporučená struktura odpovědi:

```json
{
  "answer": "Text odpovědi.",
  "confidence": "high|medium|low|insufficient_source",
  "citations": [],
  "warnings": [],
  "used_chunks": [],
  "missing_information": null
}
```

---

## 8. Bezpečnostní zásady

- Authentication přes OIDC/JWT.
- Authorization na úrovni dokumentu i akce.
- Retrieval musí filtrovat podle oprávnění uživatele.
- Každý dotaz a odpověď musí mít auditní událost.
- Do technických logů nesmí odtékat obsah citlivých dokumentů.
- Služby nesmí vystavovat interní administrativní endpointy mimo vnitřní síť.
- Secrets pouze přes environment variables nebo secrets manager.
- Vývojové mock režimy musí být jasně označené a nesmí se použít v produkční konfiguraci.

---

## 9. Doporučené repozitáře / adresáře

Je možné použít monorepo i více repozitářů. Pro CODEX je vhodné monorepo s jasnými službami:

```text
akl-platform/
├── apps/
│   └── web/
├── services/
│   ├── registry-api/
│   ├── ingestion-service/
│   ├── rag-retrieval-service/
│   ├── llm-gateway-service/
│   ├── evaluation-service/
│   └── governance-service/
├── contracts/
│   ├── openapi/
│   ├── asyncapi/
│   └── schemas/
├── infra/
│   ├── docker-compose/
│   ├── keycloak/
│   ├── monitoring/
│   └── reverse-proxy/
├── docs/
│   ├── architecture/
│   ├── security/
│   ├── deployment/
│   ├── operations/
│   └── decisions/
└── tests/
    ├── integration/
    └── fixtures/
```

Důležité: i v monorepu se služby vyvíjejí jako samostatně nasaditelné jednotky.

---

## 10. Základní Definition of Done

Každá služba je hotová pouze tehdy, pokud má:

- vlastní README,
- vlastní `.env.example`,
- healthcheck endpoint,
- testy,
- Dockerfile,
- OpenAPI nebo jasný kontrakt,
- dokumentovaný deployment,
- dokumentované limity,
- bezpečné logování,
- bez hardcoded secrets,
- kompatibilitu s integračními pravidly,
- aktualizovanou centrální dokumentaci, pokud mění kontrakt.

---

## 11. První doporučená vlna vývoje

Doporučený start ve 4 CODEX vláknech:

1. `01_CODEX_PLATFORM_INFRASTRUCTURE.md`
2. `02_CODEX_IDENTITY_DOCUMENT_REGISTRY_API.md`
3. `05_CODEX_LLM_GATEWAY_SERVICE.md`
4. `06_CODEX_WEB_FRONTEND.md`

Druhá vlna:

5. `03_CODEX_INGESTION_SERVICE.md`
6. `04_CODEX_RAG_RETRIEVAL_SERVICE.md`

Třetí vlna:

7. `07_CODEX_EVALUATION_SERVICE.md`
8. `08_CODEX_GOVERNANCE_COMPLIANCE_SERVICE.md`

---

## 12. Základní integrační pravidlo pro CODEX

Každé CODEX vlákno musí na začátku práce přečíst:

1. tento centrální dokument,
2. architekturu distribuovaných služeb,
3. service boundaries,
4. API kontrakty,
5. datové kontrakty,
6. security model,
7. integrační pravidla.

Bez toho nesmí měnit návrh služby.
