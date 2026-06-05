# CODEX vlákno 06 — Web Frontend

Odkaz na centrální zadání: `../00_CENTRALNI_ZADANI_AKL_PLATFORM.md`

Před zahájením práce přečti také:

- `../ARCHITECTURE/01_ARCHITEKTURA_DISTRIBUOVANYCH_SLUZEB.md`
- `../ARCHITECTURE/02_SERVICE_BOUNDARIES.md`
- `../CONTRACTS/03_API_KONTRAKTY_OPENAPI.md`
- `../CONTRACTS/05_DATOVE_KONTRAKTY.md`
- `../CONTRACTS/06_SECURITY_AUTHZ_MODEL.md`
- `../08_INTEGRATION_RULES_FOR_CODEX_THREADS.md`
- `../09_DEFINITION_OF_DONE.md`

---

## 1. Název služby

**Web Frontend**

---

## 2. Cíl

Vytvořit profesionální frontend pro práci s řízenou dokumentací, ingestion pipeline, RAG dotazy a citacemi.

---

## 3. Odpovědnost služby


- Dashboard.
- Document Registry UI.
- Document detail.
- Version history.
- Upload wizard.
- Ingestion status.
- Knowledge chat.
- Citation viewer.
- Audit viewer.
- Admin UI skeleton.
- API klienti.
- Mock režim pro raný vývoj.


---

## 4. Co služba nesmí dělat


- Nepřistupovat přímo do PostgreSQL.
- Nepřistupovat přímo do Qdrant.
- Nepřistupovat přímo k Ollama/vLLM.
- Nerozhodovat autoritativně o oprávněních.
- Neprovádět parsing dokumentů.


---

## 5. Závislosti na ostatních službách


- Registry API.
- Ingestion Service.
- RAG Retrieval Service.
- OIDC provider.


---

## 6. Povinné výstupy


```text
apps/web/
apps/web/src/
apps/web/src/app/
apps/web/src/components/
apps/web/src/lib/api/
apps/web/src/lib/types/
apps/web/src/features/documents/
apps/web/src/features/chat/
apps/web/src/features/ingestion/
apps/web/src/features/audit/
apps/web/README.md
apps/web/.env.example
apps/web/Dockerfile
docs/ui/information-architecture.md
docs/ui/screens.md
```


---

## 7. API / integrační body


Frontend volá:

```text
Registry API
Ingestion Service
RAG Retrieval Service
```

Frontend nesmí volat:

```text
PostgreSQL
Qdrant
Ollama/vLLM
MinIO interně, kromě podepsaných upload/download URL
```


---

## 8. Definition of Done pro toto vlákno

Služba musí dodat:

- samostatný adresář služby,
- `README.md`,
- `.env.example`,
- `Dockerfile`,
- healthcheck endpoint,
- testy,
- dokumentované API nebo integrační kontrakty,
- bezpečné logování,
- correlation id,
- žádné hardcoded secrets,
- jasně popsané limity,
- kompatibilitu s centrálními kontrakty.

---

## 9. Úvodní prompt pro CODEX

```text
Pracuješ na projektu AKL Platform — AI Knowledge Library.

Tvůj úkol je vytvořit Web Frontend jako samostatnou Next.js aplikaci.

Frontend musí obsahovat:
- dashboard
- registr dokumentů
- detail dokumentu
- historii verzí
- upload wizard
- stav ingestion jobu
- chat nad znalostní bází
- zobrazení citací
- audit viewer
- administrační skeleton

Použij mock API klienty, pokud backend není hotový, ale jasně je odděl od produkčních klientů.

Frontend nesmí přímo volat databáze, Qdrant ani LLM runtime.
```
