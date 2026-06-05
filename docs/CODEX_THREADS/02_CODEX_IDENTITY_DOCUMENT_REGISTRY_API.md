# CODEX vlákno 02 — Identity & Document Registry API

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

**Identity & Document Registry API**

---

## 2. Cíl

Vytvořit centrální backendovou službu pro evidenci řízené dokumentace, verze, metadata, oprávnění a audit.

---

## 3. Odpovědnost služby


- Evidence dokumentů.
- Evidence verzí dokumentů.
- Metadata dokumentů.
- Stavy dokumentů.
- Platnost dokumentů.
- Klasifikace.
- Vlastník/gestor.
- Access policies.
- Authorization check API.
- Audit API.
- API pro frontend.
- API pro Ingestion a RAG služby.


---

## 4. Co služba nesmí dělat


- Neparsovat dokumenty.
- Nevytvářet embeddingy.
- Neodpovídat na RAG dotazy.
- Nevolat lokální LLM pro generování odpovědí.
- Nezapisovat přímo do Qdrant jako běžný tok.


---

## 5. Závislosti na ostatních službách


- PostgreSQL.
- Keycloak/OIDC nebo mock auth v dev režimu.
- Object storage URI pouze eviduje, nevlastní fyzické soubory.
- Volají ji Web Frontend, Ingestion Service, RAG Retrieval Service, Evaluation Service a Governance Service.


---

## 6. Povinné výstupy


```text
services/registry-api/
services/registry-api/app/
services/registry-api/tests/
services/registry-api/README.md
services/registry-api/.env.example
services/registry-api/Dockerfile
services/registry-api/openapi.yaml
docs/api/registry-api.md
docs/security/registry-authz.md
```


---

## 7. API / integrační body


Endpointy minimálně:

```text
POST   /api/v1/documents
GET    /api/v1/documents
GET    /api/v1/documents/{document_id}
PATCH  /api/v1/documents/{document_id}

POST   /api/v1/documents/{document_id}/versions
GET    /api/v1/documents/{document_id}/versions
GET    /api/v1/documents/{document_id}/versions/{version_id}
POST   /api/v1/documents/{document_id}/versions/{version_id}/publish
POST   /api/v1/documents/{document_id}/versions/{version_id}/archive

POST   /api/v1/authz/check
POST   /api/v1/authz/filter-documents

POST   /api/v1/audit/events
GET    /api/v1/audit/events

GET    /health
GET    /ready
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

Tvůj úkol je vytvořit službu Identity & Document Registry API.

Služba musí být samostatně nasaditelná a komunikovat s ostatními službami pouze přes REST API.

Implementuj:
- FastAPI aplikaci
- PostgreSQL datový model
- SQLAlchemy/Alembic migrace
- dokumenty
- verze dokumentů
- metadata
- stavy
- platnost
- klasifikaci
- access policies
- authorization check endpoint
- audit endpointy
- OpenAPI dokumentaci
- testy
- Dockerfile
- .env.example

Respektuj datové kontrakty v CONTRACTS/05_DATOVE_KONTRAKTY.md.
Neimplementuj ingestion, RAG ani LLM logiku.
```
