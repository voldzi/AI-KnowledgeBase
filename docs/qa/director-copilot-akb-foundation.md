# Director Copilot: AKB foundation acceptance evidence

Datum ověření: 2026-07-21

Stav: AKB implementace ověřena lokálně a v Docker Desktopu, funkce zůstává
výchozím stavem vypnutá a nebyla nasazena do produkce.

## Ověřený rozsah AKB

- uzavřené DomainTool, EvidenceItem, QueryPlan v2 a AnalysisSnapshot kontrakty;
- per-application capabilities a scopes pouze z ověřené STRATOS projection;
- oddělený service bearer `svc-akb-director-copilot` a actor bearer;
- paralelní Budget/ProjectFlow fan-out bez přímého čtení databází;
- přesná korelace `canonical_id`, scope bounds, policy lineage a response limity;
- navazující AKB retrieval pouze přes povinné `document_context_tags`;
- finální snapshot doplňuje pouze dokumentové citace s úplnou, hashově ověřenou
  Information Policy V2; neověřená citace se jako důkaz ani uživatelská citace
  nepřijme;
- dokumentová citace je přiřazena jen projektu se shodným tagem v projektovém
  `document_context_bindings`; souhrn viditelně odlišuje projekty bez
  citovaného smluvního podkladu;
- čtyřvrstvá odpověď: fakta, dokumentová zjištění, interpretace a nejistoty;
- úplný katalog Information Policy V2, konjunktivní source audiences a povinný
  audit výsledku;
- fail-closed AI pro `RESTRICTED`, `NO_EXTERNAL_AI`,
  `LOCAL_PROCESSING_ONLY`, recipient/originator a PAP obligations;
- ephemerální federované odpovědi bez persistence historie;
- samostatný produkční aktivační Compose overlay a privátní secret tmpfs.

## Výsledky ověření

| Kontrola | Výsledek |
| --- | --- |
| web TypeScript typecheck | prošel |
| web unit/contract suite | 304 testů prošlo |
| RAG flow suite | 36 testů prošlo; 1 známé Starlette deprecation warning |
| Next.js production build | prošel, 34 statických/dynamických route skupin v build výpisu |
| skeleton + OpenAPI freshness | prošlo |
| Director JSON/OpenAPI syntax a fixtures | prošlo |
| dev, docker-home a aktivační overlay Compose config | prošlo |
| Docker Desktop | 4.78.0, Engine 29.5.3, linux/arm64 |
| Docker build `akl/web:local` | prošel |
| Docker build `akl/rag-retrieval-service:local` | prošel |
| web container `/api/health` | `status=ok`, Docker health `healthy` |
| RAG container `/health` | `status=ok`, Docker health `healthy` |
| start Copilota bez service secretu | správně odmítnut, exit 1 |
| read-only secret mount -> tmpfs | čitelný pouze runtime uživatelem, režim `0400` |

Dočasné smoke kontejnery, sítě a prázdné svazky byly po testu odstraněny.
Lokální Chroma kontejner nebyl změněn.

## Co záměrně není uzavřeno

End-to-end dotaz nad skutečnými živými daty nelze označit jako přijatý, dokud
externí vlastníci nedodají:

1. STRATOS service identity, obě source audiences a autoritativní
   per-application projection fixtures;
2. Budget `budget.project_financial_snapshot.v1` endpoint a conformance testy;
3. ProjectFlow `projectflow.project_delivery_snapshot.v1` endpoint, lokální PEP
   a conformance testy;
4. společný test odebrání scope během toku, partial/no-answer, citovaného
   smluvního zjištění a auditního výpadku;
5. verzovaný `director_copilot_v1` eval dataset a schválené SLI prahy.

Do splnění těchto bodů musí zůstat
`AKL_DIRECTOR_COPILOT_ENABLED=false`. Závazné pokyny jsou v
`docs/integration/DIRECTOR_COPILOT_HANDOFF.md` a třech navazujících handoff
dokumentech.
