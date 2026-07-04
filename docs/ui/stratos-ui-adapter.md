# STRATOS UI Adapter

AKB Platform bude soucasti portfolia STRATOS aplikaci. Sdilena UI knihovna ve
STRATOS repozitari je `@voldzi/stratos-ui` a obsahuje zejmena `AppShell`,
`AppRail`, `Button`, `SearchBox`, `ViewTabs`, `DataTable`, `HelpHint`,
`FieldLabelWithHelp` a tokeny `--stratos-*`.

## Implementacni Rozhodnuti

`@voldzi/stratos-ui` je cilovy zdroj sdilenych UI komponent. Povinna STRATOS
UI baseline pro AKB web je `@voldzi/stratos-ui@0.3.20` nebo novejsi
kompatibilni patch/minor verze. Balicek se nema
pripojovat pres `file:` dependency mimo Docker build context a AKB nema
pridavat scoped `.npmrc` pro `@voldzi:registry=https://npm.pkg.github.com`.
Balicek je publikovany ve verejnem npm registry a `apps/web/pnpm-lock.yaml`
ma smerovat na verejny npm tarball.

Aktualni kompatibilni adapter je v `apps/web/src/components/stratos`:

- komponenty pouzivaji STRATOS nazvoslovi a CSS tridy `stratos-*`,
- globalni CSS mapuje AKL tokeny na `--stratos-*`,
- shell a rail jsou AKB prop wrapper nad `@voldzi/stratos-ui` `AppShell`/`AppRail`; topbar, tlacitka, search box a view tabs pouzivaji stejne sdilene struktury jako STRATOS Budget,
- dokumentovy PDF viewer je zapouzdreny jako `StratosPdfViewer`, aby stejny render citacni strany, textoveho highlightu a bbox overlaye mohl byt pozdeji prenesen do sdileneho STRATOS UI balicku,
- feature komponenty nemusi znat, zda bezi nad lokalnim adapterem nebo budou pozdeji prepojeny primo na `@voldzi/stratos-ui`.

Od baseline `0.3.20` nesmi AKB lokalne prepisovat shell layout, z-indexy
popoveru ani picker vrstveni obecnymi hacky. `StratosAppShell` a
`StratosAppRail` pouzivaji sdilene overlay chovani pro sirky 769-1280 px,
status prvky v topbaru se v uzkych sirkach zkracuji podle sdileneho patternu a
uzivatelske chyby se maji predavat pres sdileny `ErrorState` bez surovych
technickych detailu typu JWT, OIDC, 401 nebo JSON payload.

Pokud ma vyvojove prostredi lokalni `.npmrc`, ktere scope `@voldzi` smeruje na
GitHub Packages kvuli jinym balickum, nesmi se tento override promitnout do AKB
lockfile pro `@voldzi/stratos-ui`.

## Stabilni Sdilene Exporty

Prvni napojeni AKB pouzije tyto exporty z `@voldzi/stratos-ui`:

- `GlobalTopbar` / STRATOS topbar pattern vcetne app switcheru a user menu
- `CommandCenter`
- `UnifiedSelect`
- `StratosSettingsSurface`
- `SurfaceModeMenu`
- `DetailSurface`
- `DirectoryPersonPicker` pro vyber osoby z adresare
- `AccessAuditList` pro auditni timeline a auditni vyrezy
- `AccessEffectiveMatrix` pro read-only efektivni pristupy z RBAC
- `GovernanceIssueList` pro normalizovane spravcovske governance nalezy
- `createStratosProfileSettingsClient`
- `createStratosProfileSettingsPayload`
- `mergeStratosProfileSettings`
- jednotny CSS import `@voldzi/stratos-ui/styles.css`

## Pouzite Komponenty

- `StratosAppShell`, `StratosAppRail`, `StratosTopbar` pro hlavni spravcovskou navigaci.
- `StratosButton`, `StratosButtonLink`, `StratosIconButtonLink` pro prikazy a ikonove akce.
- `StratosSearchBox` pro registry fulltext.
- `StratosSelect` pro filtrovaci selecty v registru a workflow inboxu.
- `StratosViewTabs` pro taby v detailu dokumentu.
- `StratosWorkspaceSidebar` a `StratosWorkspaceNav` pro druhe leve menu/submenu podle STRATOS workspace patternu.
- `StratosDataTable` pro profesionalni tabulkove pohledy s deklarativnimi sloupci.
- `StratosPdfViewer` pro vykresleni citacni PDF strany pres pdf.js, jemne textove zvyrazneni citace a source-location bbox overlay.
- `StratosSettingsSurface` pro jednotne nastaveni profilu, vzhledu, preferenci a AKB aplikačních sekci.
- `AccessAuditList` pro auditni timeline na `/audit`, dashboardu a detailu dokumentu.
- `AccessEffectiveMatrix` pro read-only prehled efektivnich pristupu v nastaveni profilu.
- `GovernanceIssueList` pro vysledky spravcovskych/provoznich kontrol v
  detailu dokumentu; executive dashboard nema zobrazovat governance nalezy.
- `createStratosProfileSettingsClient`, `createStratosProfileSettingsPayload`
  a `mergeStratosProfileSettings` pro cteni, slouceni a zapis profilu pres
  `GET/PUT /api/v1/profile/settings`; AKB neuklada profil, jazyk, vzhled ani
  avatar jen do lokalniho stavu komponenty.
- `HelpHint` / `FieldLabelWithHelp` ze sdileneho `@voldzi/stratos-ui` pro jednotnou kontextovou napovedu u urednickych kroku.
- `DirectoryPersonPicker` pro prirazeni osoby ve workflow inboxu. AKB dodava jen
  opravneny adresar pres BFF `/api/workflow/assignees`; trigger, popover,
  filtrovani a vyber osoby zustavaji ve sdilene knihovne.

## Aktualni Napojeni V AKL

Adapter je zapojeny na techto plochach:

- hlavni spravcovsky shell, levy rail a workspace submenu pres Budget-kompatibilni `AppShell`/`AppRail` DOM kontrakt,
- Employee Chat Portal horni akce,
- `/documents` registry toolbar: search, select filtry, primarni akce a ikonove akce,
- `/documents` registry tabulka pres `StratosDataTable`,
- dashboard poslednich dokumentu pres `StratosDataTable`,
- `/documents/[documentId]`: detailove taby, navrat do registru, upload verze, governance akce a generovani insightu,
- `/documents/[documentId]` Viewer tab: `StratosPdfViewer` pro nativni PDF preview nad podepsanym zdrojem,
- `/tasks`: search, select filtry, vycisteni filtru, detailove akce,
  rozhodovaci tlacitka a prirazeni osoby pres sdileny `DirectoryPersonPicker`
  s `popoverPlacement` a `popoverMinWidth`, bez lokalniho forku pickeru,
- `/ingestion`: tabulka uloh pres `StratosDataTable`,
- `/upload`, `/chat`, `/ingestion` a dashboard vybrane hlavni prikazy.
- uzivatelske nastaveni pres `StratosSettingsSurface`; AKB pridava pouze
  `appNavItems` a `appSections` pro provozni stav, read-only role/opravneni a
  admin role-preview. Profil, jazyk, vzhled a avatar nejsou ulozene v
  `localStorage`, ale pres web bridge `GET/PUT /api/v1/profile/settings` do
  `settings.core` a `settings.apps.akb`. Sdilene hodnoty zahrnuji
  `displayName`, `email`, `avatarId`, `avatarColor`, `avatarImageUrl`,
  `language`/`locale`, `theme`, `accent`/`accentColor` a vybrane preference
  povrchu; AKB domenove hodnoty zustavaji pod `settings.apps.akb`.
- auditni timeline na `/audit`, dashboardu a detailu dokumentu pres
  `AccessAuditList`; lokalni auditni tabulky se nepouzivaji tam, kde jde o
  timeline nebo kratky prehled pristupovych udalosti.
- read-only efektivni pristupy v nastaveni profilu pres `AccessEffectiveMatrix`
  misto lokalnich textovych poli pro seznam roli a povolenych ploch.
- governance nalezy v detailu dokumentu pres `GovernanceIssueList`; AKB
  predava normalizovane polozky se zavaznosti, aplikaci, typem problemu,
  entitou, popisem, doporucenou akci a odkazem na citovany podklad, pokud je
  k dispozici. Opravy a synchronizace vazeb zustavaji server-side workflow, UI
  pouze ukazuje auditovatelny stav a odkazy na reseni.

AKB domenove komponenty zustavaji v AKB pouze tam, kde reprezentuji Document AI
domenu: kontrolovane dokumenty, ingestion workflow, citace, governance a
interni detail dokumentu. Obecne STRATOS prvky jako topbar, nastaveni,
surface-mode menu, vyber osob, field help, selecty, metriky a tabulkove prvky
se nesmi znovu implementovat lokalne, pokud existuji ve `@voldzi/stratos-ui`.

Zbyvajici mista pouzivaji CSS kompatibilni `.button` aliasy, zejmena download/external anchor prvky a specializovane radkove akce v detailu dokumentu. Dalsi krok je pridat explicitni `StratosAnchorButton`, `UnifiedSelect` popover pro stav/typ/klasifikaci a `DateRangePicker` pro casove filtry.

Field-help API je sdilene v `@voldzi/stratos-ui`: AKB pouziva `HelpHint`, `FieldLabelWithHelp` a `SelectField.labelAccessory`. Selecty uz nemaji aplikacni obal pro pozicovani otazniku.

## Migracni Cesta Na Sdileny Balicek

Aktualni cesta na sdileny balicek:

1. drzet dependency `@voldzi/stratos-ui` minimalne na `0.3.20` z verejneho npm registry,
2. drzet `import "@voldzi/stratos-ui/styles.css";` v globalnim vstupu webu,
3. premapovat zbyvajici adaptery v `apps/web/src/components/stratos/index.ts` na primy import ze sdilene knihovny, pokud sdilena knihovna pokryva stejne props,
4. odstranit lokalni implementace, pokud sdilena knihovna pokryva stejne props,
5. ponechat `--stratos-*` tokeny jako verejny kontrakt pro AKB theme,
6. spustit typecheck, build, Docker build a vizualni QA hlavniho shellu, registru, detailu dokumentu a nastaveni.

## UI Pravidla

AKB se ridi pravidly STRATOS portfolia:

- jeden levostranny rail jako hlavni navigacni autorita,
- klidna enterprise hustota misto marketingove stranky,
- zadne karty v kartach,
- akcni prvky pres sdilene button/icon button vzory,
- search, tabs a tabulky pres sdilene vzory,
- primarni administrativni UI v cestine s dostupnym EN prepinacem.
