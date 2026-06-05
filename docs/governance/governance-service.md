# Governance / Compliance Service

Governance Service je samostatna sluzba AKL Platform pro analyzu rizene dokumentace. Nepatri ji Registry data ani workflow publikace; ty zustavaji v Registry API.

## Odpovednost

- Porovnani verzi dokumentu.
- Sumarizace zmen a materiality.
- Kontrola souladu navrhu dokumentu vuci platnym citovanym zdrojum.
- Detekce rozporu mezi dokumenty.
- Navrh KB clanku z rizene dokumentace.
- Upozorneni na koncici platnost.

## Zakazane Chovani

- Nepublikovat dokumenty.
- Nemenit opravneni.
- Nezapisovat do databaze Registry API.
- Nevydavat navrh za autoritativni rozhodnuti.
- Nevracet governance vystup bez citaci, zdroju a confidence.

## Integrace

Smerem do Registry API:

- `POST /api/v1/authz/filter-documents`
- `POST /api/v1/audit/events`
- `GET /api/v1/documents`
- `GET /api/v1/documents/{document_id}/versions`

Smerem do RAG Retrieval Service:

- `POST /api/v1/rag/retrieve`

Vsechna volani propaguji:

```text
X-Request-ID
X-Correlation-ID
X-Service-Name
Authorization
```

## Vystupni Princip

Kazdy vystup obsahuje:

- `citations` - konkretni dokument, verze, sekce/chunk nebo registry metadata,
- `sources` - zdrojove dokumenty, retrieved chunky nebo registry metadata,
- `confidence` - `high`, `medium`, `low`, `insufficient_source`, nebo `conflicting_sources`,
- `warnings` - strojove cteny seznam rizik,
- `missing_information` - co chybi pro spolehlivy zaver.

## Bezpecnost

Obsah dokumentu se neloguje. Audit obsahuje ID vysledku, typ governance workflow, pocty zmen/nalezu, ID citovanych dokumentu, confidence, warning count a hash vysledku.

Produkce vyzaduje:

```text
AKL_ENV=production
AKL_AUTH_MODE=bearer
AKL_SERVICE_TOKEN=<secret from secrets manager>
AKL_GOVERNANCE_REGISTRY_CLIENT_MODE=http
AKL_GOVERNANCE_RAG_CLIENT_MODE=http
```

## Limity

Aktualni implementace je deterministicka baseline. Je vhodna pro workflow signalizaci, predvyplneni review a kontrolu trasovatelnosti. Nenahrazuje pravni nebo vlastnicke schvaleni dokumentu.
