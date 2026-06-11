# STRATOS UI Adapter

AKB Platform bude soucasti portfolia STRATOS aplikaci. Sdilena UI knihovna ve STRATOS repozitari je `@stratos/ui` a obsahuje zejmena `AppShell`, `AppRail`, `Button`, `SearchBox`, `ViewTabs`, `DataTable` a tokeny `--stratos-*`.

## Implementacni Rozhodnuti

`@stratos/ui` je cilovy zdroj sdilenych UI komponent. Balicek se nema pripojovat pres `file:` dependency mimo Docker build context. Distribuce ma jit pres GitHub Packages jako restricted package s read-only tokenem `read:packages`.

AKB je pripraveny na instalaci balicku pres npm scope konfiguraci:

```ini
@stratos:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NPM_TOKEN}
always-auth=true
```

Do repozitare patri pouze `apps/web/.npmrc.example`. Skutecny `.npmrc` a token zustavaji lokalni/CI secret a jsou ignorovane Gitem. Dockerfile umi nacist `.npmrc` jako BuildKit secret `npmrc`, aby se token neulozil do image vrstvy.

Aktualni lokalni fallback je kompatibilni adapter v `apps/web/src/components/stratos`:

- komponenty pouzivaji STRATOS nazvoslovi a CSS tridy `stratos-*`,
- globalni CSS mapuje AKL tokeny na `--stratos-*`,
- shell, rail, topbar, tlacitka, search box a view tabs maji stejnou strukturu jako cilovy STRATOS system,
- feature komponenty nemusi znat, zda bezi nad lokalnim adapterem nebo budou pozdeji prepojeny na `@stratos/ui`.

Fallback zustava jen do doby, nez bude `@stratos/ui` dostupne pro AKB CI/Docker build pres GitHub Packages token. V tomto prostredi `npm view @stratos/ui --registry=https://npm.pkg.github.com` zatim vraci `404`, tedy balicek neni dostupny bez dalsiho opravneni nebo publikace pod ocekavanym scope.

## Stabilni Sdilene Exporty

Prvni napojeni AKL pouzije tyto exporty z `@stratos/ui`:

- `ProjectTopbar`
- `CommandCenter`
- `UnifiedSelect`
- `SettingsSurface`
- `SurfaceModeMenu`
- `DetailSurface`
- jednotny CSS import `@stratos/ui/styles.css`

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

Jakmile bude dostupny read-only GitHub Packages token:

1. pridat dependency `@stratos/ui` na publikovanou verzi z GitHub Packages,
2. pridat `import "@stratos/ui/styles.css";` do globalniho vstupu webu,
3. premapovat exporty v `apps/web/src/components/stratos/index.ts` na importy ze sdilene knihovny,
4. odstranit lokalni implementace, pokud sdilena knihovna pokryva stejne props,
5. ponechat `--stratos-*` tokeny jako verejny kontrakt pro AKB theme,
6. spustit typecheck, build, Docker build se secretem `npmrc` a vizualni QA hlavniho shellu, registru, detailu dokumentu a nastaveni.

## UI Pravidla

AKB se ridi pravidly STRATOS portfolia:

- jeden levostranny rail jako hlavni navigacni autorita,
- klidna enterprise hustota misto marketingove stranky,
- zadne karty v kartach,
- akcni prvky pres sdilene button/icon button vzory,
- search, tabs a tabulky pres sdilene vzory,
- primarni administrativni UI v cestine s dostupnym EN prepinacem.
