# AKL Platform — sada zadání pro CODEX

Status: preserved bootstrap package. For the active current-state documentation flow, start from `../../README.md`.

Tato složka obsahuje novou kompletní sadu dokumentů pro vývoj projektu **AKL — AI Knowledge Library**.

Architektura je navržena jako **distribuovaná sada samostatně nasaditelných služeb**. Každé CODEX vlákno má vlastní službu, vlastní odpovědnost a pevné integrační rozhraní.

## Jak začít

Pro reprodukovatelné spuštění Phase 02 po čistém clone začni v kořenovém `../../README.md`.
Pro import projektové dokumentace jako lokální znalostní báze pokračuj přes `../../integration/local-production-runbook.md` a `../../OPERATIONS/import-docs-folder.md`.
Pro enterprise pilot / assistant směr začni v `../../ARCHITECTURE/enterprise-architecture.md`, `../../security/enterprise-security-model.md` a `../../integration/enterprise-pilot-assistant.md`.
Pro UI práci nad dokumenty a workflow pokračuj přes `../../ui/document-workbench.md`, `../../ui/workflow-inbox.md`, `../../integration/document-workbench.md` a `../../qa/document-workbench-product-qa.md`.
Aktualni konsolidovany stav praci je v `../../maintenance/project-status.md`.

Nejdříve otevři:

1. `00_CENTRALNI_ZADANI_AKL_PLATFORM.md`
2. `../../ARCHITECTURE/01_ARCHITEKTURA_DISTRIBUOVANYCH_SLUZEB.md`
3. `../../ARCHITECTURE/02_SERVICE_BOUNDARIES.md`
4. `../../CONTRACTS/03_API_KONTRAKTY_OPENAPI.md`
5. `../../CONTRACTS/05_DATOVE_KONTRAKTY.md`
6. `../../CONTRACTS/06_SECURITY_AUTHZ_MODEL.md`
7. `08_INTEGRATION_RULES_FOR_CODEX_THREADS.md`
8. `10_PLAN_SPUSTENI_CODEX_VLAKEN.md`

## Doporučená CODEX vlákna

- `../01_CODEX_PLATFORM_INFRASTRUCTURE.md`
- `../02_CODEX_IDENTITY_DOCUMENT_REGISTRY_API.md`
- `../03_CODEX_INGESTION_SERVICE.md`
- `../04_CODEX_RAG_RETRIEVAL_SERVICE.md`
- `../05_CODEX_LLM_GATEWAY_SERVICE.md`
- `../06_CODEX_WEB_FRONTEND.md`
- `../07_CODEX_EVALUATION_SERVICE.md`
- `../08_CODEX_GOVERNANCE_COMPLIANCE_SERVICE.md`

## Doporučený postup

Nespouštěj všechna vlákna najednou.

První vlna:

1. Platform / Infrastructure
2. Identity & Document Registry API
3. LLM Gateway Service
4. Web Frontend

Druhá vlna:

1. Ingestion Service
2. RAG Retrieval Service

Třetí vlna:

1. Evaluation Service
2. Governance / Compliance Service

## Důležité pravidlo

Každá služba je samostatně nasaditelná.
Žádná služba nesmí přímo importovat interní kód jiné služby.
Komunikace mezi službami probíhá přes API, eventy nebo schválené datové kontrakty.
