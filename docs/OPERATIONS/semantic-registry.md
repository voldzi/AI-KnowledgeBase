# Lokální sémantický registr STRATOS

## Účel

AKB používá lokální verzovaný snapshot Sémantického slovníku pojmů veřejné
správy (SSP) jako českou lexikálně-sémantickou vrstvu Copilota. Produkční chat
se při zpracování dotazu nepřipojuje k veřejnému SPARQL endpointu.

Snapshot obsahuje české preferované názvy, alternativní názvy, definice a
vztahy `broader` a `related`. Směrování na Budget, ProjectFlow, ArchFlow nebo
AIIP mohou ovlivnit pouze samostatně schválené vazby. Celý importovaný slovník
není automaticky důvěryhodným routerem.

## Soubory

- `apps/web/src/lib/director-copilot/data/ssp-cs.snapshot.json` - generovaný
  lokální snapshot;
- `apps/web/src/lib/director-copilot/data/semantic-registry-bindings.json` -
  ručně schválené vazby na STRATOS zdroje a metriky;
- `contracts/semantic-registry/v1/snapshot.schema.json` - uzavřený kontrakt;
- `apps/web/scripts/sync-ssp-semantic-registry.mjs` - synchronizační nástroj.

## Ověření lokálního snapshotu

```bash
cd apps/web
pnpm semantic-registry:check
```

Kontrola je offline. Ověří verzi, počty, identifikátor a SHA-256 obsahu.

## Řízená aktualizace SSP

```bash
cd apps/web
pnpm semantic-registry:sync
pnpm semantic-registry:check
pnpm typecheck
pnpm test
pnpm build
```

Synchronizace:

- používá pouze pevný HTTPS hostitel `xn--slovnk-7va.gov.cz`;
- stránkuje po 500 pojmech a má horní limit 20 000 pojmů;
- omezuje velikost každé odpovědi a timeout;
- opakuje pouze `429` a serverové chyby;
- odmítne schválenou vazbu, jejíž pojem ve zdroji chybí;
- vytváří stabilní identifikátor z SHA-256 konceptů a vazeb.

Změnu snapshotu a schválených vazeb je nutné zkontrolovat v code review. Samotný
nový pojem SSP nesmí automaticky získat mapování na STRATOS zdroj.

## Přidání vazby

1. Najít kanonický SSP URI a ověřit jeho definici a kontext.
2. Doplnit vazbu do `semantic-registry-bindings.json`.
3. Uvést cílový zdroj nebo metriku, datum, schvalující autoritu a odůvodnění.
4. Znovu synchronizovat snapshot.
5. Doplnit pozitivní, nejednoznačný a negativní test formulace.
6. Ověřit, že dokumentový dotaz zůstane v RAG a že vazba nemění autorizaci.

## Licence a původ

Snapshot zachovává identitu zdroje, dokumentaci, licenci a atribuci. SSP je
publikován jako otevřený sémantický zdroj veřejné správy. Před dalším veřejným
šířením nebo připojením jiného slovníku musí vlastník ověřit případné
slovníkově specifické výjimky.

LSD-Czech/NajdiSlovo není součástí snapshotu. Připojí se až po potvrzení
produkční licence pro lokální kopii; web se nesmí scrapovat.

## Bezpečnostní hranice

Sémantický registr určuje pouze kandidátní význam dotazu. Nikdy:

- nevytváří capability nebo scope;
- nečte databáze zdrojových aplikací;
- nemění Information Policy;
- nezvyšuje klasifikaci ani povolenou datovou třídu;
- neposílá uživatelský dotaz na veřejný SSP endpoint;
- nenahrazuje autorizaci cílového doménového nástroje.
