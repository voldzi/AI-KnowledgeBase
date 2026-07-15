# STRATOS UI Adapter

AKB Platform bude soucasti portfolia STRATOS aplikaci. Sdilena UI knihovna ve
STRATOS repozitari je `@voldzi/stratos-ui` a obsahuje zejmena `AppShell`,
`AppRail`, `Button`, `SearchBox`, `ViewTabs`, `DataTable`, `HelpHint`,
`FieldLabelWithHelp` a tokeny `--stratos-*`.

## Implementacni Rozhodnuti

`@voldzi/stratos-ui` je cilovy zdroj sdilenych UI komponent. Povinna STRATOS
UI baseline pro AKB web je `@voldzi/stratos-ui@0.3.29` nebo novejsi
kompatibilni patch/minor verze. Balicek se nema
pripojovat pres `file:` dependency mimo Docker build context a AKB nema
pridavat scoped `.npmrc` pro `@voldzi:registry=https://npm.pkg.github.com`.
Balicek je publikovany ve verejnem npm registry a `apps/web/pnpm-lock.yaml`
ma smerovat na verejny npm tarball.

Hlavni shell nema lokalni vizualni adapter. `apps/web/src/components/app-shell.tsx`
a `project-topbar.tsx` importuji shell a navigacni komponenty primo z
`@voldzi/stratos-ui`. AKB v techto souborech vlastni jen routing, role,
lokalizovane popisky, stav aktivniho modulu, prikazy a domenova data.

Adresar `apps/web/src/components/stratos` zustava pouze pro male API adaptery,
kde AKB feature pouziva odlisny props kontrakt, nebo pro znovupouzitelne
domenove komponenty. Neobsahuje re-exporty ani kopie `AppShell`, `GlobalTopbar`,
`AppRail`, `WorkspaceSidebar`, `WorkspaceNav` nebo `CommandCenter`.

`globals.css` mapuje barevne tokeny a nastavuje odsazeni pracovni plochy.
Neobsahuje lokalni implementaci gridu shellu, mobilniho draweru, backdropu,
focus trapu, popoveru ani mobilniho railu.

Od baseline `0.3.24` nesmi AKB lokalne prepisovat shell layout, z-indexy
popoveru ani picker vrstveni obecnymi hacky. `StratosAppShell` a
`StratosAppRail` pouzivaji sdilene overlay chovani pro sirky 769-1280 px,
status prvky v topbaru se v uzkych sirkach zkracuji podle sdileneho patternu a
uzivatelske chyby se maji predavat pres sdileny `ErrorState` bez surovych
technickych detailu typu JWT, OIDC, 401 nebo JSON payload.
`GlobalTopbar` pouziva nativni `href` model pro STRATOS app switcher a
`mobileBehavior={{ context: "hide", actions: "overflow", status: "compact" }}`;
AKB predava `currentAppId="akb"` a pouze environment-specific URL. Nazvy,
ikony, poradi, dostupnost ProcessForge a vynechani aktualni aplikace z nabidky
vlastni centralni katalog v `@voldzi/stratos-ui`.
AKB nepridava mobilni opravy pro `.stratos-app-shell-main`,
`.stratos-app-shell-content` ani `.stratos-global-topbar-context`, pokud jde o
chovani pokryte sdilenym shellem.

Od baseline `0.3.34` pouziva AKB take sdileny `StratosAuthErrorPage` pro
nedostupne nebo odmitnute centralni overeni pristupu. Uzivateli se zobrazuje
stabilni STRATOS reason code a bezpecne akce pro opakovani nebo nove prihlaseni;
surova odpoved auth sluzby se do UI nepredava.

Pokud ma vyvojove prostredi lokalni `.npmrc`, ktere scope `@voldzi` smeruje na
GitHub Packages kvuli jinym balickum, nesmi se tento override promitnout do AKB
lockfile pro `@voldzi/stratos-ui`.

## Stabilni Sdilene Exporty

Prvni napojeni AKB pouzije tyto exporty z `@voldzi/stratos-ui`:

- `AppShell`
- `AppRail`
- `useRailSectionSidebarController`
- `WorkspaceSidebar` / `WorkspaceNav`
- `WorkspaceSidebarTriggerButton`
- `GlobalTopbar` / STRATOS topbar pattern vcetne app switcheru a user menu
- `GlobalTopbarBreadcrumb`
- `CommandCenterTrigger`
- `TopbarStatusGroup`
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

- `AppShell`, `AppRail` a `useRailSectionSidebarController` pro hlavni spravcovskou navigaci a jednotne desktop/overlay chovani.
- `GlobalTopbar`, `GlobalTopbarBreadcrumb`, `CommandCenterTrigger` a `TopbarStatusGroup` pro horni globalni kontext.
- `StratosButton`, `StratosButtonLink`, `StratosIconButtonLink` pro prikazy a ikonove akce.
- `StratosSearchBox` pro registry fulltext.
- `StratosSelect` pro filtrovaci selecty v registru a workflow inboxu.
- `StratosViewTabs` pro taby v detailu dokumentu.
- `WorkspaceSidebar` a `WorkspaceNav` pro druhe leve menu/submenu podle STRATOS workspace patternu.
- `StratosDataTable` pro profesionalni tabulkove pohledy s deklarativnimi sloupci.
  Tenky AKB adapter zapojuje sdilene `onColumnResize`, respektuje omezeni
  `minWidth`/`maxWidth` a uklada uzivatelske sirky lokalne podle identity
  tabulky. Vlastni resize ovladac, auto-fit dvojklikem a klavesnicove chovani
  zustavaji vyhradne implementaci `@voldzi/stratos-ui`.
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
- `FileDropzone` pro jediny file input v `/documents/new` a `/upload`. AKB
  neposkytuje vlastni drag/drop markup ani validacni CSS; nadale vlastni hash,
  preflight, upload session, binarni prenos, ingestion, DLP a audit.
- `WorkflowParticipants` pro konfigurovatelne role dokumentu. Vychozi AKB model
  vyzaduje jednoho gestora a jednoho odlisneho schvalovatele. Osoby a skupiny
  z adresare se mapuji na `DirectorySubjectOption`; technicke ID je pouze
  rizena hodnota, nikoli hlavni viditelny text.

## Aktualni Napojeni V AKL

Adapter je zapojeny na techto plochach:

- hlavni spravcovsky shell, levy rail a workspace submenu primo pres sdilene
  `AppShell`, `AppRail`, `WorkspaceSidebar`, `WorkspaceNav` a
  `useRailSectionSidebarController`,
- mobilni prepinani modulu pres `AppRail mobileFallback="bottom"`; AKB nema
  vlastni mobilni modulovy prepinac,
- zavreni overlay navigace tlacitkem, backdropem nebo Escape a navrat focusu
  vlastni sdileny `AppShell`,
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
- `/chat`, `/ingestion` a dashboard vybrane hlavni prikazy; nahrani nove verze
  je pouze kontextova akce jednoho vybraneho dokumentu a neni samostatnou
  polozkou navigace ani Command Center.
- uzivatelske nastaveni pres `StratosSettingsSurface`; AKB pridava pouze
  `appNavItems` a `appSections` pro srozumitelný read-only přehled přístupů a
  admin role-preview. Technické údaje o API/OIDC režimu se uživateli
  nezobrazují. Profil, jazyk, vzhled a avatar nejsou ulozene v
  `localStorage`, ale pres web bridge `GET/PUT /api/v1/profile/settings` do
  `settings.core` a `settings.apps.akb`. Sdilene hodnoty zahrnuji
  `displayName`, `email`, `avatarId`, `avatarColor`, `avatarImageUrl`,
  `language`/`locale`, `theme`, `accent`/`accentColor` a vybrane preference
  povrchu; AKB domenove hodnoty zustavaji pod `settings.apps.akb`.
- app switcher získává jednotné zámky přes
  `buildStratosAppsAvailabilityFromAccessProjection` z autoritativní centrální
  projekce `applicationAccess`; místní AKB role nejsou zdrojem dostupnosti
  ostatních STRATOS aplikací.
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

## Udrzovaci Kontrakt

1. Drzet dependency `@voldzi/stratos-ui` minimalne na `0.3.27` z verejneho npm registry.
2. Importovat `@voldzi/stratos-ui/styles.css` prave jednou v root layoutu.
3. Importovat standardni shell, topbar, navigaci, popovery a kanban primo ze sdilene knihovny.
4. Nevytvaret lokalni CSS pro `.stratos-app-shell*`, `.stratos-workspace-sidebar*`, `.stratos-app-rail*`, `.stratos-global-topbar*`, sdilene popovery nebo kanban.
5. Ponechat v AKB pouze domenova data, role, routing, mutace a prikazy.
6. Po aktualizaci knihovny spustit typecheck, produkcni build, E2E shell testy a vizualni QA podle `docs/qa/stratos-shell-qa.md`.

## UI Pravidla

AKB se ridi pravidly STRATOS portfolia:

- jeden levostranny rail jako hlavni navigacni autorita,
- klidna enterprise hustota misto marketingove stranky,
- zadne karty v kartach,
- akcni prvky pres sdilene button/icon button vzory,
- search, tabs a tabulky pres sdilene vzory,
- primarni administrativni UI v cestine s dostupnym EN prepinacem.
