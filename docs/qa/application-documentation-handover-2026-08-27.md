# Předávací dokumentace AKB a STRATOS: ověření 27. 8. 2026

## Rozsah a stav

Připravena dokumentační sada `AKB-STRATOS-CSU-PILOT-DOCS`, revize 1.0:
16 zdrojových Markdown dokumentů včetně metodiky, postupu vložení a pěti
autorských vzorů. Součástí předání je souhrnné PDF a ZIP s inventurou,
kontrolními součty a dohledatelnou vazbou PDF na originály.

Zadání se týká malého pilotu pouze ve vnitřní síti ČSÚ. Sada rozlišuje návrh,
ověřenou implementaci, neprovedenou cílovou instalaci a otevřené podmínky
převzetí. Všech 16 MD bylo vloženo do stávající AKB jako koncepty. Gestorem
je `stratos_admin`, schvalovatelem Jiří Volek. Nebylo provedeno schválení,
publikace ani změna přístupových grantů. Souhrnné PDF nebylo vloženo podruhé
jako nezávislý zdroj.

## Kontroly souborů

- 16 unikátních stabilních identifikátorů a sjednocená jmenná konvence.
- Validace 16 zdrojů základním profilem OKF prošla.
- Dry-run importního plánu prošel; nejde o zápis do Registry.
- Relativní odkazy mezi podklady jsou platné.
- PDF má vložené české fonty, obsah, záložky a identifikaci zdrojů.
- Kontroluje se přítomnost textu i vykreslení stran; PDF není nezávislý
  autoritativní dokument a nemá být duplicitním důkazem v RAG.
- Redakční profil `akb-application-docs-1` není implementovaný API kontrakt.
  Ne všechna doplňková YAML metadata se přenášejí do AKB automaticky.
- Současné stahování zdroje vrací původní MD. Dodané PDF je připravený
  odvozený výstup; tímto úkolem nebyl přidán automatický MD-to-PDF export.

Inventura: [dokumentační sada](../handover/akb-stratos-dokumentacni-sada.json).
Použité baseline a chybějící integrační podklady STRATOS jsou zaznamenány
v [předávacím listu](../handover/akb-stratos-predani-dokumentace-csu-cs.md).

## Ověření v aplikaci

V přihlášené relaci `stratos admin` byl použit standardní formulář
`https://stratos.zeleznalady.cz/akb/documents/new`. Žádný přímý zápis do
databáze, S3 ani indexu nebyl použit.

1. Před vložením byla v registru kontrolována metodika, skupina podkladů
   `AKB a STRATOS`, postup vložení a skupina `Vzor:`. Vyhledávání po načtení
   vrátilo 0 odpovídajících výsledků. Nejde o úplnou deduplikaci obsahu všech
   již existujících dokumentů.
2. Po určení Jiřího Volka byl schvalovatel vybrán z adresáře. Každý formulář
   měl odlišného gestora a schvalovatele, klasifikaci `internal` a verzi 1.0.
   Původní ochrana proti stejné osobě v obou rolích zůstala zachována.
3. Aplikace potvrdila vytvoření dokumentu, první verze a spuštění zpracování
   u všech 16 souborů. Výsledná ID jsou v inventuře pod
   `registry_document_ids`. Při zpožděném dokončení nebyly uploady opakovány.
4. V registru bylo zpětně viděno prvních 15 nových konceptů. Přijetí
   posledního vzoru architektury bylo potvrzeno úspěšnou obrazovkou s jeho
   ID; jeho následný detail již nebylo možné ověřit.
5. U metodiky a předávacího listu byly v detailu zpětně ověřeny obě uložené
   odpovědnosti, stav `koncept` a zpracování `dokončeno`. Dokončení ingestion
   zbývajících 14 dokumentů nebylo nezávisle ověřeno.
6. Metodika má přesnou verzi `ver_d7137de9166b4cb5a3a455ea09a024da`.
   Její baseline compliance kontrola `gov_9a8e539fb610` skončila
   `compliant`: 5 prošlo, 0 k posouzení, 0 selhalo. Nejde o věcné schválení
   obsahu, legislativní stanovisko ani kontrolu cílové instalace ČSÚ.
7. Místní kontrola souboru a hashování nejsou důkazem serverového AV výsledku.
   Příjem proběhl standardní cestou; jednotlivé skenové/auditní záznamy
   nebyly dostupné v této relaci, a proto je report nepotvrzuje samostatně.

### Ověřené odkazy

- [Metodika tvorby dokumentace](https://stratos.zeleznalady.cz/akb/documents/doc_4485b317129d4826b50de62cbb3c186a)
- [Předávací list](https://stratos.zeleznalady.cz/akb/documents/doc_a855194f747748b89c3f8eb9f3bbbca2)
- Ostatní vazby na soubory a ID: [inventura sady](../handover/akb-stratos-dokumentacni-sada.json).

Identifikátory `external_ref` jsou zachovány ve zdrojovém YAML a v explicitním
štítku. Formulář nepřenesl všechny doplňkové položky YAML do samostatných
Registry metadat. Nelze proto tvrdit, že již funguje vyhledávání podle
Registry `external_ref` nebo automatická vazba aplikace podle tohoto profilu.
Všechny importy mají společný štítek `csu-docs-1`.

### Překážky schválení a závěrečné kontroly

- Detail nového konceptu umožňuje upravit odpovědnosti, ale nenabízí akci
  pro předání konceptu do revize. Publikace čeká na schválený stav a je
  neaktivní. Samotné přiřazení Jiřího Volka tedy není zahájené schvalování.
- Inbox zobrazil odvozený úkol `Draft needs completion` pro gestora,
  nikoli potvrzený schvalovací úkol Jiřího Volka. V této relaci nebyly
  dostupné publikační akce ani auditní stopa. Aktuální oprávnění Jiřího Volka
  k provedení schvalovacího úkonu nebyla ověřena přihlášením jeho účtem.
- Implementace `apps/web/src/features/documents/document-detail.tsx`
  nabízí v této části akce `publish` a `archive`, nikoli přechod
  `draft -> review`. `services/registry-api/app/api.py`, funkce
  `_sync_derived_workflow_tasks`, vytváří revizní úkol až pro stav `review`.
  Zjištění není důvodem k obcházení workflow nebo rozšíření role.
- Při následné kontrole detailů a registru se opakovaně objevila serverová
  chyba stránky `This page couldn’t load`, diagnostické číslo `3576189575`.
  Není to correlation ID ani důkaz ztráty přijatých souborů.
- Dne 27. 8. 2026 přibližně ve 13:00 Europe/Prague vracel
  `/akb/api/health` HTTP 200 a release
  `957c1d5e445970568e46c61a78d9227b1ff4fcf7`. `/akb/api/ready` vracel HTTP 200,
  všechny uvedené závislosti `ready`, včetně Registry, ingestion,
  object storage a document intake content security. To neprokazuje
  funkčnost konkrétní přihlášené obrazovky.

**Příjem dokončen: 16/16. Schvalování nepředáno; publikace neprovedena.**
Vytvořené koncepty nemají být hromadně znovu importovány při dalším pokusu.

## Zjištění pro další samostatný úkol

- Formulář blokuje stejného gestora a schvalovatele, ale při tomto průchodu
  nezobrazil srozumitelný důvod u neaktivního tlačítka. Validaci je vhodné
  zobrazit průběžně a odlišit založení konceptu od následného schválení.
  Případná změna pravidla oddělení rolí vyžaduje samostatné rozhodnutí.
- Při prvním otevření formuláře a registru se objevily dočasné chyby
  serverového vykreslení; opětovné načtení nejprve obnovilo obrazovky,
  při závěrečném ověřování už chyby přetrvávaly. Je třeba korelovat
  konkrétní chybu se serverovými logy, nikoli opakovat upload.
- Způsob vazby souhrnného PDF na přesné zdrojové verze je nutné ověřit před
  jeho zpřístupněním v AKB. Nevytvářet nezávislou publikovanou kopii sady.
- Požadovaný přístup všech aktivních interních zaměstnanců není tímto
  importem ověřen. `internal` není samo o sobě grant ke čtení. Stávající
  `recipient_set:employee-directives` se podle
  `docs/security/registry-authz.md` vztahuje na publikované interní směrnice
  a jejich přesné verze, nikoli automaticky na manuály a autorské vzory.

## Zbývající akceptace

1. Obnovit funkční detail dokumentu a ověřit zbývajících 14 ingestion úloh,
   přesné verze a skenové/auditní záznamy existujících importů.
2. Doplnit nebo zprovoznit autorizované předání konceptu do revize a ověřit
   skutečný schvalovací úkol pod účtem Jiří Volek. Jeho roli nepředstírat
   přes administrátorskou relaci.
3. Uživatel provede věcné schválení. Před publikací potvrdit účinnost
   a skutečný rozsah interních příjemců; datum importu není věcným
   rozhodnutím o účinnosti dokumentace.
4. Po publikaci otestovat běžného aktivního interního čtenáře, nepovoleného
   uživatele, stažení, citace, vyhledání a Chat podle
   [postupu vložení](../how-to/akb-postup-vlozeni-predavaci-dokumentace-cs.md).
   Vzor s nevyplněnými údaji nesmí poskytovat provozní fakta.

V této práci nebyl měněn runtime kód, produkční konfigurace, Keycloak,
schvalovací pravidla ani STRATOS. Nebyl vytvořen commit, PR ani deploy.

## Následná kontrola připravenosti, 27. 8. 2026

Výše uvedené výsledky zachycují původní import. Následná omezená read-only
kontrola produkční Registry v 13:32:19 UTC doplnila chybějící důkazy:

- 16/16 dokumentů se štítkem `csu-docs-1` má zpracování `INDEXED`;
- 16/16 má navázaný zdrojový soubor s čistým výsledkem bezpečnostní kontroly;
- dokumenty i jejich verze zůstávají `draft`, klasifikace `internal`;
- 16/16 má vazbu Information Policy a aktivní přiřazení gestora i schvalovatele.

Přiřazení role k dokumentu neprokazuje aktuální capability přihlášeného
uživatele. Nebyl změněn stav dokumentů, granty, data ani produkční konfigurace.
Výsledek neprokazuje viditelnost podkladů běžnému či externímu příjemci.

Schvalovací workflow a příprava chatu byly následně sjednoceny na aktuální
vývojové větvi; jejich stav a zbývající kroky popisuje
[závěrečné ověření připravenosti](chat-handover-readiness-2026-08-27.md).
