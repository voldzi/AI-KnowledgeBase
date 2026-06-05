# AKL Governance / Compliance Service

Samostatne nasaditelna FastAPI sluzba pro pokrocile rizeni dokumentace v AKL Platform.

Implementovany rozsah:

- porovnani verzi rizeneho dokumentu,
- sumarizace zmen a materiality,
- kontrola souladu navrhu dokumentu vuci citovanym smernicim/metodikam,
- detekce rozporu mezi dokumenty,
- navrh KB clanku z rizeneho dokumentu,
- upozorneni na koncici platnost,
- citace, zdroje, confidence a audit u kazdeho governance vystupu.

Služba nepublikuje dokumenty, nemeni opravneni, neobchazi Registry API workflow a nevydava AI/governance navrhy za autoritativni rozhodnuti.

## API

Endpointy:

```text
POST /api/v1/governance/compare-versions
POST /api/v1/governance/check-compliance
POST /api/v1/governance/detect-conflicts
POST /api/v1/governance/generate-kb-article
GET  /api/v1/governance/validity-alerts

GET  /health
GET  /ready
```

OpenAPI kontrakt je v `openapi.yaml` a runtime OpenAPI je dostupne jako `/openapi.json`.

## Hlavni Toky

`compare-versions` porovna dva predane `DocumentVersionContent` vstupy po odstavcich. Kazda zmena nese citaci na levou nebo pravou verzi a odhad dopadu.

`check-compliance` pouzije predane `control_sources`, nebo si je vyzada z RAG Retrieval Service pres `/api/v1/rag/retrieve`. Navrh dokumentu se kontroluje proti pravidlum pro gestora, platnost, vyjimky a trasovatelnost.

`detect-conflicts` hleda typicke rozpory mezi autorizovanymi zdroji: jiny schvalovatel, jina lhuta nebo opacna normativni tvrzeni.

`generate-kb-article` vytvori pouze navrh KB clanku. Vystup ma `publication_status=draft_proposal` a seznam Registry kroku potrebnych pred publikaci.

`validity-alerts` nacita metadata platnosti z Registry API a vraci citovane alerty pro verze s blizicim se `valid_to`.

## Konfigurace

| Promenna | Vychozi | Popis |
|---|---:|---|
| `AKL_ENV` | `development` | `production` vynucuje bearer auth a HTTP klienty. |
| `AKL_AUTH_MODE` | `disabled` | `disabled`, `mock`, nebo `bearer`. |
| `AKL_SERVICE_TOKEN` | prazdne | Token pro prichozi bearer auth. |
| `AKL_UPSTREAM_BEARER_TOKEN` | prazdne | Token pro volani Registry API a RAG Retrieval Service. |
| `AKL_GOVERNANCE_DEPENDENCY_MODE` | `mock` | Vychozi mod zavislosti: `mock` nebo `http`. |
| `AKL_GOVERNANCE_REGISTRY_CLIENT_MODE` | podle dependency mode | Registry klient. |
| `AKL_GOVERNANCE_RAG_CLIENT_MODE` | podle dependency mode | RAG klient. |
| `AKL_REGISTRY_BASE_URL` | `http://localhost:8001/api/v1` | Registry API base URL. |
| `AKL_RAG_BASE_URL` | `http://localhost:8082/api/v1` | RAG Retrieval Service base URL. |
| `AKL_GOVERNANCE_MAX_DOCUMENT_CHARS` | `200000` | Maximalni velikost textu jednoho dokumentu ve vstupu. |
| `AKL_GOVERNANCE_MAX_CONTROL_CHUNKS` | `12` | Maximalni pocet kontrolnich RAG chunku. |
| `AKL_GOVERNANCE_DEFAULT_VALIDITY_ALERT_DAYS` | `60` | Vychozi okno pro alerty koncici platnosti. |

`AKL_ENV=production` odmita start, pokud neni `AKL_AUTH_MODE=bearer`, chybi `AKL_SERVICE_TOKEN`, nebo Registry/RAG klienti nejsou v `http` rezimu.

## Spusteni

```bash
cd services/governance-service
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

Mock rezim nepotrebuje bezici Registry API ani RAG Retrieval Service:

```bash
curl http://localhost:8080/health
curl http://localhost:8080/ready
```

## Security A Logging

Inbound API muze vyzadovat bearer token. Mezislužbova volani propaguji:

```text
X-Request-ID
X-Correlation-ID
X-Service-Name
```

Služba vola Registry API:

- `POST /api/v1/authz/filter-documents`,
- `POST /api/v1/audit/events`,
- `GET /api/v1/documents`,
- `GET /api/v1/documents/{document_id}/versions`.

Technicke logy neobsahuji plny text dokumentu, kontrolnich zdroju, promptu, tokeny ani secrets. Audit metadata obsahuji typ workflow, pocty nalezu, citovane dokumenty, confidence, warnings a hash vysledku.

## Limity

- Tato iterace pouziva deterministicke analyzatory bez LLM rozhodovani.
- Compare je odstavcovy, ne semanticky pravni diff.
- Compliance pravidla jsou governance baseline a musi byt rozsirena podle realnych internich smernic.
- Conflict detection hleda vybrane typy rozporu a vraci `needs review` signal, ne pravni rozhodnuti.
- KB clanek je pouze draft proposal a musi projit Registry workflow.

## Testy

```bash
cd services/governance-service
python -m pytest
```

Testy pouzivaji mock Registry API a mock RAG Retrieval Service.

## Docker

```bash
docker build -t akl-governance-service .
docker run --rm -p 8080:8080 --env-file .env.example akl-governance-service
```
