# Director Copilot: AKB foundation acceptance evidence

Datum ověření: 2026-07-22

Stav: STRATOS, Budget a ProjectFlow dodaly produkční kontrakt v release
`c8f2ea522f55dadbb448577e5c7ababdbe8861a1`. AKB produkční aktivační verze
`04907c3a801f1b4f3c0d55305d33aa107e4bef30` je nasazena se zapnutou funkcí,
read-only service secretem a úspěšnými health kontrolami. První živý dotaz
odhalil překročení zdrojového limitu nerelevantními scopes; oprava a regresní
testy jsou součástí tohoto navazujícího release kandidáta.

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
| web unit/contract suite | 306 testů prošlo |
| RAG flow suite | 36 testů prošlo; 1 známé Starlette deprecation warning |
| Next.js production build | prošel, 34 statických/dynamických route skupin v build výpisu |
| skeleton + OpenAPI freshness | prošlo |
| Director JSON/OpenAPI syntax a fixtures | prošlo |
| dev a docker-home Compose config včetně Director mountu | prošlo |
| immutable release workflow včetně Director preflightu | prošlo |
| Docker Desktop | 4.78.0, Engine 29.5.3, linux/arm64 |
| Docker build `akl/web:local` | prošel |
| Docker build `akl/rag-retrieval-service:local` | prošel |
| web container `/api/health` | `status=ok`, Docker health `healthy` |
| RAG container `/health` | `status=ok`, Docker health `healthy` |
| start Copilota bez service secretu | správně odmítnut, exit 1 |
| read-only secret mount -> tmpfs | čitelný pouze runtime uživatelem, režim `0400` |

## Produkční aktivační zjištění

První produkční dotaz 2026-07-22 aktivoval federovanou větev a správně selhal
uzavřeně. Auditní metadata odhalila, že AKB předalo Budgetu také rozsáhlou
množinu nerelevantních `document` scopes a překročilo limit 100 položek.
Regrese je kryta testem a odstraněna filtrováním na závazný scope katalog
každého zdroje.

Současně aktuální access projection testovacího `stratos_admin` neobsahuje
`projectflow:read` ani podporovaný `organization`/`portfolio`/`project` scope
pro ProjectFlow. AKB tento nedostatek záměrně neobchází; pozitivní celý průchod
zůstává závislý na opraveném centrálním grantu reálného testovacího uživatele.

Dočasné smoke kontejnery, sítě a prázdné svazky byly po testu odstraněny.
Lokální Chroma kontejner nebyl změněn.

## Zbývající produkční přijetí

Externí dodávka je převzata. End-to-end dotaz nad skutečnými živými daty lze
označit jako přijatý až po:

1. nasazení navazující opravy scope filtru přes immutable workflow;
2. doplnění čtecího ProjectFlow grantu a pozitivní dotaz reálného oprávněného
   uživatele s ověřením Budget,
   ProjectFlow, dokumentové citace a auditního záznamu;
3. společném partial/no-answer testu a opakování deny po odebrání scope;
4. verzovaném `director_copilot_v1` eval datasetu a schválených SLI prazích.

Do dokončení bodů 1-3 se aktivace nepovažuje za produkčně přijatou. Závazné
pokyny zůstávají v `docs/integration/DIRECTOR_COPILOT_HANDOFF.md` a třech
navazujících handoff dokumentech.
