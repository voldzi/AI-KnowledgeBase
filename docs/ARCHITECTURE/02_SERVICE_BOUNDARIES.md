# Service boundaries

Odkaz na centrální zadání: `../00_CENTRALNI_ZADANI_AKL_PLATFORM.md`

Tento dokument definuje hranice služeb AKL Platform.

---

## 1. Platform / Infrastructure

### Odpovědnost

- provozní infrastruktura,
- Docker Compose,
- reverse proxy,
- monitoring,
- logování,
- backup/restore,
- síťové propojení,
- dev/prod-like prostředí.

### Nesmí dělat

- business logiku,
- datový model dokumentů,
- RAG logiku,
- parsing dokumentů.

---

## 2. Identity & Document Registry API

### Odpovědnost

- evidence dokumentů,
- verze dokumentů,
- metadata,
- platnost,
- klasifikace,
- workflow stavů,
- oprávnění,
- audit,
- API pro frontend a ostatní služby.

### Vlastní data

- Document,
- DocumentVersion,
- DocumentFile,
- DocumentAccessPolicy,
- AuditEvent,
- UserProfile,
- RoleMapping.

### Nesmí dělat

- parsovat dokumenty,
- vytvářet embeddingy,
- generovat LLM odpovědi,
- přímo manipulovat s Qdrant indexem mimo schválené admin operace.

---

## 3. Ingestion Service

### Odpovědnost

- zpracování dokumentů,
- parsing,
- OCR,
- chunking,
- embedding,
- indexace,
- ingestion report.

### Vlastní data

- IngestionJob,
- IngestionReport,
- ParserResult,
- ChunkingResult.

### Nesmí dělat

- spravovat role a oprávnění,
- rozhodovat o publikaci dokumentu,
- odpovídat uživateli na RAG dotazy,
- obcházet Registry API.

---

## 4. RAG Retrieval Service

### Odpovědnost

- retrieval,
- reranking,
- sestavení kontextu,
- odpověď s citacemi,
- kontrola zdrojové opory,
- no-answer policy,
- advanced RAG operace.

### Vlastní data

- query trace,
- retrieval result,
- answer result,
- krátkodobá technická cache, pokud je povolena.

### Nesmí dělat

- měnit registry dokumentů,
- přidávat nové dokumenty,
- přímo měnit oprávnění,
- vystavovat LLM runtime napřímo frontendům.

---

## 5. LLM Gateway Service

### Odpovědnost

- abstrakce nad LLM backendy,
- chat completion,
- embeddings,
- streaming,
- model routing,
- rate limiting,
- timeouty.

### Nesmí dělat

- RAG retrieval,
- znalost dokumentů,
- autorizaci dokumentů,
- ukládání citlivých promptů bez výslovného režimu.

---

## 6. Web Frontend

### Odpovědnost

- uživatelské rozhraní,
- volání API,
- prezentace citací,
- upload wizard,
- dokumentový registry UI,
- audit viewer.

### Nesmí dělat

- přímé volání Qdrant,
- přímé volání PostgreSQL,
- přímé volání LLM runtime,
- lokální rozhodování o oprávněních mimo UI hinty.

---

## 7. Evaluation Service

### Odpovědnost

- eval datasety,
- spuštění testovacích dotazů,
- měření kvality retrieval,
- měření citací,
- reporty.

### Nesmí dělat

- měnit produkční dokumenty,
- měnit produkční oprávnění,
- vystupovat jako produkční RAG odpovědní služba.

---

## 8. Governance / Compliance Service

### Odpovědnost

- kontrola souladu,
- srovnání verzí,
- detekce rozporů,
- návrhy KB článků,
- upozornění na expiraci.

### Nesmí dělat

- autoritativně měnit dokument bez workflow,
- publikovat nové verze bez Registry API,
- ignorovat citace a audit.

---

## 9. Zakázané integrační vzorce

Zakázáno:

- služba A importuje interní Python/TypeScript třídy služby B,
- frontend přistupuje přímo do databáze,
- RAG služba čte všechny dokumenty bez authz filtru,
- Ingestion Service zapisuje metadata dokumentu mimo Registry API,
- LLM Gateway loguje plné prompty s citlivými daty v produkci,
- služby sdílí jeden globální `.env` bez namespace proměnných.

---

## 10. Povolené integrační vzorce

Povoleno:

- REST API přes OpenAPI,
- event přes schválené event schema,
- sdílené JSON Schema kontrakty,
- mock klient pro test,
- generated API client z OpenAPI,
- outbox pattern,
- service account s omezenými oprávněními.
