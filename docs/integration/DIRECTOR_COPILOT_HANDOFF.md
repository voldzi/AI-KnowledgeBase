# Předání integrace Copilota ředitele

Stav: závazné zadání pro první read-only vertikální řez

Datum: 2026-07-21

## Cíl

AKB Chat má odpovědět na otázku:

> Které projekty mají současně rozpočtovou odchylku, zpožděný milník a smluvní
> riziko?

AKB část je implementována za výchozím vypnutým přepínačem
`AKL_DIRECTOR_COPILOT_ENABLED=false`. Produkční aktivace není povolena, dokud
STRATOS, Budget a ProjectFlow nesplní níže uvedené předávací úkoly a společné
contract testy.

Samostatná zadání:

- `DIRECTOR_COPILOT_HANDOFF_STRATOS.md`
- `DIRECTOR_COPILOT_HANDOFF_BUDGET.md`
- `DIRECTOR_COPILOT_HANDOFF_PROJECTFLOW.md`

## Závazné soubory

- OpenAPI: `openapi/director-copilot-domain-tools.v1.json`
- JSON Schemas: `contracts/director-copilot/v1/`
- pozitivní a negativní fixtures: `contracts/director-copilot/v1/fixtures/`
- architektonické rozhodnutí: `docs/adr/0010-director-copilot-federated-read-models.md`

Zdrojové aplikace nesmějí kontrakt přepsat podle vlastního databázového modelu.
Jejich read-model se mapuje do společného kontraktu.

## Společný transport

Endpoint implementovaný v Budgetu i ProjectFlow:

```text
POST /api/v1/integrations/akb/domain-tools/execute
```

Povinné zabezpečení:

1. `Authorization` obsahuje bearer dedikované identity
   `svc-akb-director-copilot`.
2. `X-STRATOS-Actor-Authorization` obsahuje odlišný, čerstvý bearer osoby.
3. Zdroj ověří podpis, issuer a vlastní audience obou relevantních tokenů.
4. Zdroj načte aktuální STRATOS access projection aktéra a vybere svou aplikaci.
5. Zdroj aplikuje vlastní lokální PEP, Information Policy a stav entity.
6. `requested_scopes` pouze zužují dotaz. Nejsou autorizačním tvrzením.
7. `X-STRATOS-Capabilities`, `X-STRATOS-Scopes`, role nebo browserové hlavičky
   nejsou v produkci autorita.

Stejná servisní identita zapisuje závěrečný audit do AKB Registry. Její token
proto musí obsahovat také audience `akl-api`; Registry ji vede jako trusted
service client s jediným route grantem `audit`. Uživatelský bearer se pro tento
zápis nesmí použít. Registry uloží ověřený servisní subject jako `actor_id` a
původní osobu pouze jako `reported_actor_id` v metadatech události.

AKB odesílá pouze identifikátory, omezené filtry a aktéra. Neodesílá prompt ani
volné SQL. Zdrojový endpoint nesmí volat LLM ani AKB RAG.

Každá položka musí vrátit alespoň jeden stabilní `document_context_tags`. AKB
podle nich zúží navazující dokumentový retrieval a při jejich absenci odpověď
odmítne; nikdy nepřejde na globální hledání. Publikum všech zdrojových policy se
ve snapshotu vyhodnocuje konjunktivně (`all_source_policies_required`), takže
rozdílný Budget a ProjectFlow audience label nezanikne průnikem řetězců.
`RESTRICTED`, `NO_EXTERNAL_AI` a `LOCAL_PROCESSING_ONLY` v první verzi zabrání
předání strukturovaných faktů modelu; uživatel dostane jen deterministická fakta
a viditelný důvod blokace. Kontrakt přijímá úplný katalog Information Policy
V2; recipient/originator/PAP obligations rovněž blokují AI, dokud je AKB neumí
explicitně splnit. Federovaný výsledek se bez úspěšného auditu nevrátí.
Dokumentová citace se do finálního `AnalysisSnapshot` přijme pouze s úplným
`policy_binding_id`, `policy_version`, autoritativním `policy_hash`,
`policy_summary` a jejím samostatným `policy_summary_hash`. Souřadnice policy a
hash zkrácené citační reprezentace musí souhlasit; autoritativní `policy_hash`
zůstává otiskem celé Information Policy V2 a nesmí se zaměňovat s otiskem
souhrnu. Jinak AKB citaci zahodí a výstup označí jako
chybějící dokumentový důkaz. Citace navíc musí nést `document_context_tags`
s alespoň jedním přesným tagem z projektového `document_context_bindings`,
například `project:<id>` nebo `contract:<id>`. Vazbu vytváří pouze tag vrácený
zdrojovým read-modelem pro dané `canonical_id`; jedna citace se nesmí
automaticky vztáhnout na všechny projekty ve výsledku.

## Provozní limity

| Oblast | Limit |
| --- | --- |
| timeout jednoho nástroje | 8 sekund |
| položek v jedné odpovědi | kontrakt nejvýše 100; první AKB manager brief žádá nejvýše 25 |
| faktů na entitu | nejvýše 40 |
| velikost odpovědi | nejvýše 262 144 B |
| retry AKB | žádný automatický retry v jednom chatovém běhu |
| fan-out | Budget a ProjectFlow paralelně, nejvýše jeden call na zdroj |
| cache | zdrojově řízená; výsledek musí vždy nést `as_of` a `source_version` |

HTTP 401/403 se v AKB projeví jako `not_authorized`. Výpadek nebo neplatný
kontrakt se projeví jako označený partial výsledek; AKB chybějící hodnotu
neodhaduje. `next_cursor` se v jednom chatovém běhu automaticky nedočítá a
výsledek se viditelně označí `SOURCE_RESULT_TRUNCATED`.

## Aktivační brána

Před nastavením feature flagu na `true` musí projít:

- byte-identical validace všech request/response fixtures;
- odmítnutí nesprávné service identity, audience a stejného actor/service tokenu;
- okamžitý deny po odebrání capability, scope nebo lokálního členství;
- odmítnutí položky mimo požadovaný scope a neznámé obligation;
- timeout, 413, 429, 503 a partial scénář;
- korelace shodného `canonical_id` z obou aplikací;
- AKB RAG s citací smluvního dokumentu a no-answer bez citace;
- audit bez promptu, odpovědi, tokenu a raw doménového payloadu;
- produkčně podobný Docker smoke nad oběma web profily AKB.

Federované odpovědi jsou v první verzi záměrně ephemerální. Trvalá historie se
zapne až po samostatném akceptovaném reautorizačním testu všech evidence IDs při
každém otevření a sdílení vlákna.
