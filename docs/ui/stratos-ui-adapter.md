# STRATOS UI Adapter

AKL Platform bude soucasti portfolia STRATOS aplikaci. Sdilena UI knihovna ve STRATOS repozitari je `@stratos/ui` a obsahuje zejmena `AppShell`, `AppRail`, `Button`, `SearchBox`, `ViewTabs`, `DataTable` a tokeny `--stratos-*`.

## Implementacni Rozhodnuti

AKL Docker build ma jako context pouze AKL workspace, proto web aplikace zatim nemuze spolehlive importovat balicek z externiho repozitare `/Users/voldzi/Documents/Development/18 2026/STRATOS`.

Aktualni reseni je lokalni kompatibilni adapter v `apps/web/src/components/stratos`:

- komponenty pouzivaji STRATOS nazvoslovi a CSS tridy `stratos-*`,
- globalni CSS mapuje AKL tokeny na `--stratos-*`,
- shell, rail, topbar, tlacitka, search box a view tabs maji stejnou strukturu jako cilovy STRATOS system,
- feature komponenty nemusi znat, zda bezi nad lokalnim adapterem nebo budou pozdeji prepojeny na `@stratos/ui`.

## Pouzite Komponenty

- `StratosAppShell`, `StratosAppRail`, `StratosTopbar` pro hlavni spravcovskou navigaci.
- `StratosButton`, `StratosButtonLink`, `StratosIconButtonLink` pro prikazy a ikonove akce.
- `StratosSearchBox` pro registry fulltext.
- `StratosSelect` pro filtrovaci selecty v registru a workflow inboxu.
- `StratosViewTabs` pro taby v detailu dokumentu.
- `StratosWorkspaceSidebar` a `StratosWorkspaceNav` pro druhe leve menu/submenu podle STRATOS workspace patternu.
- `StratosDataTable` pro profesionalni tabulkove pohledy s deklarativnimi sloupci.

## Aktualni Napojeni V AKL

Adapter je zapojeny na techto plochach:

- hlavni spravcovsky shell, uzky levy rail a workspace submenu,
- Employee Assistant horni akce,
- `/documents` registry toolbar: search, select filtry, primarni akce a ikonove akce,
- `/documents` registry tabulka pres `StratosDataTable`,
- dashboard poslednich dokumentu pres `StratosDataTable`,
- `/documents/[documentId]`: detailove taby, navrat do registru, upload verze, governance akce a generovani insightu,
- `/tasks`: search, select filtry, vycisteni filtru, detailove akce a rozhodovaci tlacitka,
- `/ingestion`: tabulka uloh pres `StratosDataTable`,
- `/upload`, `/chat`, `/assistant`, `/ingestion` a dashboard vybrane hlavni prikazy.

Zbyvajici mista pouzivaji CSS kompatibilni `.button` aliasy, zejmena download/external anchor prvky a specializovane radkove akce v detailu dokumentu. Dalsi krok je pridat explicitni `StratosAnchorButton`, `UnifiedSelect` popover pro stav/typ/klasifikaci a `DateRangePicker` pro casove filtry.

## Migracni Cesta Na Sdileny Balicek

Az bude `@stratos/ui` dostupne v AKL build contextu:

1. pridat dependency na workspace nebo publikovany balicek `@stratos/ui`,
2. premapovat exporty v `apps/web/src/components/stratos/index.ts` na importy ze sdilene knihovny,
3. odstranit lokalni implementace, pokud sdilena knihovna pokryva stejne props,
4. ponechat `--stratos-*` tokeny jako verejny kontrakt pro AKL theme,
5. spustit typecheck, build a vizualni QA hlavniho shellu, registru a detailu dokumentu.

## UI Pravidla

AKL se ridi pravidly STRATOS portfolia:

- jeden levostranny rail jako hlavni navigacni autorita,
- klidna enterprise hustota misto marketingove stranky,
- zadne karty v kartach,
- akcni prvky pres sdilene button/icon button vzory,
- search, tabs a tabulky pres sdilene vzory,
- primarni administrativni UI v cestine s dostupnym EN prepinacem.
