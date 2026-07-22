# Director Copilot: AKB foundation acceptance evidence

Datum ověření: 2026-07-22

Stav: první produkční vertikální řez je přijat. STRATOS, Budget a ProjectFlow
běží v release `c6e0e9c724381ebfe3f26adaf67457230dfd64e4`. AKB produkční
release `89d46f7c88838b39f4f373ef93ee5703bfbcbb73` je nasazen se zapnutou
funkcí, read-only service secretem, čerstvou reautorizací před syntézou a
úspěšnými health kontrolami. Produkční akceptace proběhla pod účtem
`stratos_admin`.

## Ověřený rozsah AKB

- uzavřené DomainTool, EvidenceItem, QueryPlan v2 a AnalysisSnapshot kontrakty;
- per-application capabilities a scopes pouze z ověřené STRATOS projection;
- zdrojové požadavky obsahují jen scope typy podporované cílem: Budget přijímá
  `organization`, `budget_scope`, `project`; ProjectFlow přijímá
  `organization`, `portfolio`, `project`; nerelevantní `document` scopes se do
  federovaného volání nekopírují;
- více než 100 relevantních scopes selže uzavřeně jako
  `ACCESS_SCOPE_LIMIT_EXCEEDED`; AKB autorizační množinu tiše nezkracuje;
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
- podporovaný produkční Compose mount, release preflight a privátní secret
  tmpfs pro oba webové profily.

## Výsledky ověření

| Kontrola | Výsledek |
| --- | --- |
| web TypeScript typecheck | prošel |
| web unit/contract suite | 311 testů prošlo |
| RAG flow suite | 36 testů prošlo; 1 známé Starlette deprecation warning |
| Next.js production build | prošel, 34 statických/dynamických route skupin v build výpisu |
| skeleton + OpenAPI freshness | prošlo |
| Director JSON/OpenAPI syntax a fixtures | prošlo |
| dev a docker-home Compose config včetně Director mountu | prošlo |
| immutable release workflow včetně Director preflightu | prošlo |
| GitHub CI release `89d46f7c` | všech 11 úloh prošlo včetně web E2E a immutable release scénáře |
| Docker Desktop | 4.78.0, Engine 29.5.3, linux/arm64 |
| Docker build `akl/web:local` | prošel |
| Docker build `akl/rag-retrieval-service:local` | prošel |
| web container `/api/health` | `status=ok`, Docker health `healthy` |
| RAG container `/health` | `status=ok`, Docker health `healthy` |
| start Copilota bez service secretu | správně odmítnut, exit 1 |
| read-only secret mount -> tmpfs | čitelný pouze runtime uživatelem, režim `0400` |
| produkční `web` a `chat-web` | healthy, OCI revize a veřejné health verze `89d46f7c` |

## Produkční akceptace

Účet `stratos_admin` dostal autoritativní `projectflow:read` a organizační
scope ve STRATOS access projection. Pět po sobě jdoucích dotazů přes skutečné
produkční UI spojilo stejný kanonický projekt z Budget a ProjectFlow a vrátilo:

- rozpočtovou odchylku `18 500 Kč`;
- zpoždění kritického milníku `447 dní`;
- projektově přiřazený smluvní dokument se třemi citovanými výňatky;
- oddělená ověřená fakta, dokumentová zjištění, interpretaci a nejistoty.

Naměřené celkové latence byly `5258`, `3179`, `2666`, `2930` a `2933` ms;
produkční p95 je `5258 ms` proti limitu `10000 ms`. P95 doménových nástrojů je
`472 ms` proti limitu `3000 ms`.

Negativní živý test dočasně deaktivoval přesně jeden ProjectFlow grant účtu
`stratos_admin`. Copilot za `537 ms` bezpečně vrátil `Nedostatečný Zdroj`, bez
faktů a citací. Grant byl poté obnoven ve stejné podobě a pozitivní průchod
znovu prošel. Release navíc před každou syntézou načítá čerstvou projection bez
cache a při změně identity, grantu, capability, scope nebo expirace vrátí
`ACCESS_PROJECTION_CHANGED_BEFORE_SYNTHESIS` bez volání RAG.

Zbývající scénáře jsou kryté release testy: expirovaná projection, neplatný
policy hash, `RESTRICTED`/`NO_EXTERNAL_AI`, nedostupný ProjectFlow s označenou
částečnou odpovědí, prompt v doménových datech, pokus o rozšíření scope a
neexistence společného kanonického projektu. Všech deset případů datasetu
`director_copilot_v1` prošlo bez autorizačního úniku. Strojově ověřitelný
záznam je v
`quality/reports/director_copilot_v1-production-2026-07-22.json`.

Použité kladné hodnoty jsou výslovně označený integrační akceptační fixture,
nikoli skutečné účetní nebo realizační údaje. Aktivační brána prvního řezu je
splněna; rozšíření na další manažerské nástroje vyžaduje vlastní verzovaný
kontrakt a eval dataset.
