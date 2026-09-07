# Připravenost AKB pro dokumenty celé organizace

Datum: 5. 9. 2026. Posouzení aktuální pracovní větve
`codex/document-intake-hardening`, základ
`398aec0593c34bbe8dc1d65423c280d483198ded`. Návrh cílového modelu a podmínek
spuštění. Tabulky níže zachycují vstupní posouzení před navazující implementací;
aktuální změny jsou rozlišeny v následujícím odstavci.

## Aktualizace během realizace

V pracovní větvi je nyní povinné TLP a katalog pěti dokumentových profilů,
neměnná historie verzí a původu, samostatně revidované aktuální odpovědnosti,
povinné profilové formuláře a potvrzení od centrální autority. Zápis a návrh
smlouvy nemusejí předstírat právní účinnost. Smíšené PDF již zachovává všechny
fyzické stránky; obrázky PNG/JPEG/WebP používají skutečný Tesseract a vyžadují
kontrolu. XLSX čte i řádky za dlouhou prázdnou oblastí, zachovává souřadnice
buněk a PPTX zachovává prázdné buňky tabulek. Formáty bez odpovídajícího
adaptéru mají výslovně nedostupný příjem.

Současný závazný popis je v [katalogu profilů](../CONTRACTS/AKB_DOCUMENT_PROFILE_PROPOSAL.md),
[podpoře formátů](../CONTRACTS/DOCUMENT_FORMAT_CAPABILITIES_V1.md),
[realizačním plánu](document-intake-hardening-plan.md) a
[záznamu ověření](../qa/document-policy-and-chat-2026-09-05.md).
Centrální schválení, dokončení všech provozních průchodů a společná akceptace
zůstávají podmínkou spuštění. Vstupní nálezy níže nejsou tvrzením, že již
opravené vady nadále existují.

## Rozhodnutí a závěr

AKB má použitelný základ: dokument, obsahová verze, původní soubor, přiřazené
odpovědnosti, centrální oprávnění, příjem, vytěžení, indexy a citace. Na tomto
základu lze uvedené rodiny dokumentů stavět. Kontrola však neopravňuje tvrdit,
že všechny typy mají dokončený a ověřený provozní postup. Některé mezery jsou
základní modelová rozhodnutí, která je potřeba uzavřít před prvním naplněním.

Produktový vlastník závazně odstranil výjimku „schváleno bez TLP“. Každý
přijatý dokument a verze musí mít explicitní účinné TLP a úplná odpovídající
pravidla. [ADR 0017](../adr/0017-mandatory-document-policy.md) rozlišuje tento
schválený požadavek, jeho lokální implementaci a dosud neuzavřenou společnou akceptaci.

Cílem je, aby přidání běžného organizačního podtypu znamenalo schválení profilu,
nikoli přepis úložiště, Chatu a jednotlivých formulářů. Nový technický formát,
nový parser nebo nový obchodní systém může i nadále vyžadovat samostatný adaptér
a integrační testy. Žádný návrh nemůže zaručit, že již nikdy nebude potřeba
změnit kód.

## Dokumentový druh není souborový formát

PDF může být smlouva, manuál, právní předpis i zápis. Stejný druh může přijít
jako DOCX, textové PDF nebo sken. Druh určuje metadata, odpovědnost, schválení
a časová pravidla; formát určuje bezpečnou interpretaci, vytěžení a náhled;
zdroj určuje původ, autoritu a integrační oprávnění. Tyto tři osy se nemají
slévat do jedné volby nebo do jedné univerzální výjimky `other`.

| Rodina dokumentů | Základ při vstupním posouzení | Tehdy nalezená práce před běžným provozem |
| --- | --- | --- |
| Směrnice, metodiky, postupy a manuály | Typy, verze, schvalování, publikace a volba vytěžení. | Povinná metadata, cyklus revizí, plánovaná účinnost a správné nahrazování verzí. |
| Poznámky a znalostní články | Znalostní článek, textové formáty a obecný souborový příjem. | Jednoduchý řízený proces; rozhodnout přímé psaní textu v AKB. Dnešní formulář vyžaduje soubor a samostatného schvalovatele. |
| Zápisy porad a projektů | `meeting_record`, projektová dokumentace a společná evidence. | Typovaná data jednání, účastníci, schválená rozhodnutí a přesné projektové vazby. Úkoly propojit se zdrojovým systémem, nevyrábět jejich druhou autoritu. |
| Smlouvy a dodatky | Obecný typ smlouvy a specializovaný ověřovaný kontrakt Budget. | Obecný smluvní profil mimo Budget, vztahy dodatků, smluvní období, ukončení, přílohy a odpovědnosti. |
| Zákony a vyhlášky | Oficiální kolekce, e-Sbírka, účinnost verzí, normativní balíčky a vztahy. | Doložený vydavatel a účinnost, správné dnešní/historické znění, pravidla aktualizací a rozšíření doménových katalogů. |
| Přílohy, tabulky, prezentace a technické podklady | Společné soubory a několik konkrétních parserů. | Úplná matice příjem–vytěžení–náhled–citace. Prosté přijetí souboru není doklad úplného obsahu v Chatu. |

Evidence: [typový katalog a role](../../apps/web/src/lib/documents/document-workflow.ts),
[typy a normativní balíčky](../../services/registry-api/app/schemas.py),
[formulář](../../apps/web/src/features/documents/new-document-form.tsx),
[oficiální kolekce](../../apps/web/src/lib/public-sources/sync.ts).

## Skutečná podpora formátů

„Propojená cesta“ níže znamená existující návaznost v aktuálním kódu; nejde o
nově provedenou produkční akceptaci. Podpora obrázků/OCR závisí na konfiguraci
a dostupnosti služeb. Compose nastavuje jako výchozí OCRmyPDF a vypnutý
Docling; skutečné proměnné běžící produkce v tomto auditu kontrolované nebyly.

| Formát | Stav při vstupním posouzení | Tehdy zjištěné omezení |
| --- | --- | --- |
| Textové PDF | Propojený příjem, vytěžení, index a stránkový náhled/citace. | Kvalitu tabulek a přesných zvýraznění ověřit na reálných dokumentech. |
| Skenované PDF | Propojená cesta při dostupném OCR. | Běžný výběr parseru může u smíšeného PDF přeskočit skenované strany, pokud celý soubor již obsahuje dost nativního textu. |
| DOCX | Text, nadpisy, běžné tabulky a PDF náhled. | Obrázky, textová pole, revize a vnořené struktury nejsou doloženě úplně vytěžené. |
| XLSX/XLSM | Uložené hodnoty buněk a tabulkové bloky. | Neprovádí přepočet vzorců; čtení listu se ukončuje po 50 prázdných řádcích. Index listu není přesná stránka PDF náhledu. |
| PPTX | Text, tabulky a poznámky snímků. | Obrázkové snímky a diagramy native parser nečte; filtrování prázdných buněk může změnit přiřazení tabulkových hodnot. |
| Markdown/TXT | Propojená textová cesta. | Web příjem vyžaduje UTF-8; další parserové fallbacky nejsou automaticky vlastností uploadu. |
| CSV, HTML/XHTML, JSON/XML | Přijetí a textové vytěžení. | CSV není plně interpretovaný sešit s datovými typy a buněčnými citacemi; HTML není věrná interpretace vzhledu stránky. |
| PNG/JPEG/WEBP | Přijetí a náhled; OCR podle dostupného adaptéru. | Výchozí OCRmyPDF zpracovává PDF, nikoli fotografie. Tesseract/Docling mají vlastní odlišné seznamy médií. |
| GIF/SVG | Přijetí a náhled. | Obecný odpovídající extractor v prověřeném routeru chybí. |
| TIFF/BMP | Podpora některých OCR adaptérů. | Běžný web příjem je nepovoluje; není to dokončená upload cesta. |
| DOC/RTF | Přijetí a LibreOffice PDF náhled. | Chybí odpovídající obecný ingestion parser nebo propojení konverze s vytěžením. |
| XLS/PPT/ODT/ODS/ODP | Konverzní služba je zná. | Samotná schopnost konverze neznamená podporovaný běžný příjem a indexaci. |
| YAML a specializované architektonické formáty | Více přípon má povolený příjem/textový náhled. | Přiřazení MIME a přípony k obecnému parseru není uzavřené pro všechny tyto formáty. |
| EML/MSG, uživatelské ZIP/7z/RAR/TAR | Běžnou cestou nepodporované. | Chybí příjem a řízené rozdělení zpráv/příloh/archivů se samostatným původem, pravidly a citacemi. Interní ZIP struktura DOCX není podpora uživatelských archivů. |

Hlavní evidence: [příjem](../../apps/web/src/lib/upload/preflight.ts),
[router](../../services/ingestion-service/parsers/router.py),
[OCR](../../services/ingestion-service/parsers/ocr.py),
[tabulky](../../services/ingestion-service/parsers/xlsx.py),
[prezentace](../../services/ingestion-service/parsers/pptx.py),
[Office rendice](../../services/ingestion-service/renditions/pdf.py),
[provozní výchozí konfigurace](../../infra/docker-compose/docker-compose.docker-home.yml).

## Základní mezery potvrzené v implementaci

1. **Povinná dokumentová politika ještě není jednotný invariant.** Sdílená
   Information Policy V2 dovoluje null TLP; veřejný kolektor používá výchozí
   politiku s null TLP. Povinný schválený dokumentový profil musí pokrýt
   Registry, ruční i integrační příjem, verze, aktivaci pro index/Chat a
   navazující použití. Nejde pouze o validační zprávu formuláře.
   [Politika](../../services/registry-api/app/information_policy.py),
   [výchozí politika](../../apps/web/src/lib/stratos/information-policy.ts).

2. **Obecná metadata jsou volná a měnitelná na kořeni dokumentu.** Model
   DocumentVersion nemá úplný obecný snapshot autorských a doménových metadat.
   Změna kořenového slovníku proto není spolehlivou historií konkrétního
   obsahu. Existující hash review kontroluje změny a je užitečný, ale nenahrazuje
   čitelný historický záznam. Doplnit verzované schéma a neměnný snapshot
   původu a schválených metadat. Aktuální odpovědnost při odchodu gestora měnit
   auditovaně, aniž se přepíše historické autorství nebo původ obsahu.
   [Model](../../services/registry-api/app/models.py),
   [review snapshot](../../services/registry-api/app/document_workflow.py).

3. **Budoucí účinnost má konkrétní riziko.** Publikace okamžitě označí jiné
   platné verze s překryvem intervalů za nahrazené. Výběr dnešní verze však
   zároveň odmítá verzi s budoucím datem účinnosti. Aktuální otevřená V1 a
   předem publikovaná budoucí V2 tak mohou vytvořit období bez aktuálního
   zdroje. Existující podpora nepřekrývajících se historických právních verzí
   tuto situaci sama neřeší. Před provozem ověřit plánované nástupnictví i
   odpověď na dotaz „co platilo k datu“.
   [Publikace a výběr aktuální verze](../../services/registry-api/app/api.py),
   [dosavadní časové testy](../../services/registry-api/tests/test_documents_versions.py).

   Izolovaný behaviorální důkaz 5. 9. 2026: dvě kontroly skutečných
   `_publish_version` a `_current_valid_document_version` nad SQLite v paměti
   prošly. Otevřená V1 + schválená V2 od 5. 10. 2026 po předčasné publikaci
   vrátí dnešní verzi `None`. Kontrolní varianta s koncem V1 dne 4. 10. vrátí
   správně V1. Test neprováděl celý HTTP/STRATOS schvalovací proces ani
   produkční změnu. Jde o potvrzený případ, ne tvrzení, že časové verze vůbec
   nefungují.

4. **Data mají různé významy.** Oficiální synchronizace může při chybějící
   účinnosti použít datum získání jako `valid_from`. Požadovaný model musí
   oddělit vznik, vydání, účinnost, událost, pořízení kopie, příští kontrolu
   a konec uchování. Chybějící právní účinnost nesmí být domyšlena z data
   importu. Překročená revize sama neznamená právní neplatnost dokumentu.
   [Synchronizace](../../apps/web/src/lib/public-sources/sync.ts),
   [datum revize](../../services/registry-api/app/document_workflow.py).

5. **Typy a workflow jsou zčásti pevně v kódu.** UI má vlastní katalog vedle
   backendového výčtu. Šablony předvyplňují typ, značky a parser; netvoří
   společné schéma povinných údajů a přechodů. UI vyžaduje stejnou dvojici
   gestor/schvalovatel pro všechny typy. Pro jednoduchou poznámku je to
   zatěžující; složitější agenda potřebuje jiná schválení. Zachovat společné
   úkoly a bezpečnostní kontroly, doplnit několik jasných verzovaných profilů
   místo univerzálního programovacího jazyka pro workflow.

6. **Příjem, parser a náhled nemají jednotný seznam skutečných schopností.**
   Existují formáty přijímané webem, které běžně zvolená cesta vytěžení
   nedokáže zpracovat. Rozhodnutí o přijetí musí znát dostupný adaptér,
   jeho limity a způsob citování, nikoli jen povolenou příponu.

7. **Úplnost není totožná se správností vytěžení.** Tabulky, vzorce, skeny,
   obrázky, přílohy a strukturované právní vztahy potřebují reprezentativní
   testy. Bez této evidence nelze ve formuláři ani Chatu slibovat úplné
   vytěžení dokumentu. Původní soubor musí zůstat dostupný přes oprávněný
   náhled; odvozené PDF/OCR nesmí přepsat originál ani předstírat jeho podpis.

8. **Neúplné vytěžení má varování, ale nemusí blokovat použití.** Pipeline
   může obsah indexovat se stavem `completed_with_warnings`. Profil musí
   jednoznačně určit, zda takový výsledek čeká na opravu, je použitelný pouze
   jako neúplný podklad s viditelným omezením, nebo má schválenou výjimku z
   kvalitativního prahu. To nikdy není výjimka z povinného TLP či oprávnění.
   [Pipeline](../../services/ingestion-service/app/pipeline.py).

9. **Limity souboru musí platit také po rozbalení a interpretaci.** Samotný
   ZIP magic neověřuje správnou strukturu OOXML. Adaptéry a náhledy potřebují
   limity rozbalených dat, počtu položek/stran/listů, paměti a času; explicitně
   řešit šifrované a poškozené soubory a makra. Nejde o pokyn povolit další
   archivní formáty bez samostatné bezpečnostní brány.
   [Kontrola obsahu](../../apps/web/src/lib/upload/content-security.ts),
   [strukturovaný náhled](../../apps/web/src/lib/upload/ooxml-preview.ts).

## Návrh stabilního rozšíření

Zachovat společné jádro **Document → obsahová verze → původní soubor**,
stávající centrální rozhodování oprávnění, práci s důkazy a obnovitelné indexy.
Před naplněním doplnit následující jasné hranice:

- **Verzovaný katalog dokumentových profilů:** schéma metadat, povinné údaje,
  význam dat, kontrolní termíny, vztahy, proces schválení a výchozí zpracování.
  UI i server vycházejí ze stejného schváleného kontraktu. Typové výchozí
  hodnoty nejsou samy oprávněním přiřadit politiku.
- **Profil zdroje:** skutečná autorita, způsob přihlášení, dědění politiky,
  stabilní externí reference a synchronizace změn. Budget nesmí suplovat
  oprávnění ProjectFlow, ArchFlow ani obecného importéru.
- **Registr schopností zpracování:** pro každý formát příjem, sken, parser,
  OCR, limity, náhled, původ a kotva citace. Volit vhodný ověřený adaptér
  podle souboru a dostupnosti služby. U nepodporované funkce vrátit přesný
  stav; nikdy falešné „kompletně zpracováno“.
- **Verzovaná metadata a pravidla:** bezpečně spojit schválený obsah,
  původ, profil a centrální policy binding. Dnešní `policy_hash` nepokrývá
  všechna data autora, gestora a platnosti; jeho centrální význam svévolně
  nerozšiřovat. Pro dokumentový snapshot navrhnout samostatnou revizi/otisk
  a přesnou návaznost na upload rozhodnutí, schválení a důkazy. Aktuální
  přístup se vždy ověřuje živě, ne pouze ze starého snapshotu.
- **Oddělené časové a provozní stavy:** skenování/zpracování, schválení,
  platnost/účinnost, revize a retence mají vlastní význam. Jediné pole
  `status` nesmí nejasně zastupovat všechny tyto osy.
- **Formátově přesné citace:** strana/oblast PDF, sekce textu, list a buňky
  tabulky či snímek prezentace. Číslo listu není automaticky stránkou
  převedeného PDF. Každý náhled musí umět dohledat původní místo v obsahu.

Jde o cílené doplnění modelu, kontraktů a adaptérů před provozem. Není důvod
na základě tohoto auditu zahazovat úložiště, Registry nebo RAG. Nové profily
musí být řízené a ověřované; cílem není umožnit libovolné nevalidované
konfigurační skripty.

## Pořadí a podmínky prvního naplnění

1. Uzavřít společný povinný dokumentový profil a jeho vynucení bez výjimky
   TLP; dohodnout odpovědnost STRATOS a Registry. Současně dokončit známý
   centrální replay blocker.
2. Doplnit snapshoty metadat, časový model a katalog profilů pro všechny
   výše uvedené rodiny. Zajistit, že změna organizačního podtypu nepřepisuje
   historické verze a nevyžaduje zásah do několika různých katalogů.
3. Sjednotit podporované formáty s běžícími parsery a korektními citacemi.
   Schválená podpora může být výslovně omezena; omezení musí uživatel znát
   před nahráním, nikoli až po neúspěšném zpracování.
4. Pro každou podporovanou kombinaci dokumentového profilu, formátu a zdroje
   doložit referenční průchod: příjem, sken, metadata, review, účinnost,
   vytěžení, autorizovaný Chat, přesná citace, změna a archivace. Společné
   invarianty testovat systematickou maticí a rizikové kombinace zvlášť.
5. Ověřit zamítnutí chybějícího TLP/gestora, změny pravidel během příjmu,
   cizího projektu, malwaru, výpadků a chybných metadat. Přidat plánované
   účinnosti, revize po termínu, změnu gestora, dodatky, tabulky s mezerami
   a vzorci, otočené skeny, neúplné OCR a dlouhé dokumenty.
6. Změřit kapacitu a uživatelskou odezvu na dohodnutém objemu a velikosti
   dokumentů; dokončit obnovu po ztracené odpovědi, monitoring aktualizací,
   bezpečný úklid a obnovu ze záloh. Malý souborový test není důkaz výkonu
   organizačního archivu.

Tato brána doplňuje, nenahrazuje [celkový produktový plán](document-intake-hardening-plan.md):
bezpečnost historie/sdílení/exportů Chatu, přístupnost, kvalitu odpovědí,
výkon a animace.

## Rozsah důkazů

Tři souběžné cílené kontroly pokryly doménový model, formáty a dokumentovou
politiku. Základem je aktuální kód, nikoli marketingový seznam přípon.
Vyhledávání Chroma zpočátku fungovalo; část navazujících dotazů blokovala
obnova indexu, proto následovalo cílené čtení známých souborů. Opakovaný fetch
Gitea selhal na SSH autentizaci; uložený `origin/main` odpovídá výchozímu SHA.
Žádná produkční data nebyla změněna a nebyla provedena nová kompletní
akceptace všech typů dokumentů. Provedený dvoupřípadový časový test je
výslovně oddělený od statického posouzení formátů a od celé HTTP integrace.
Dřívější výsledky první implementační etapy
zůstávají odděleně v [záznamu ověření](../qa/document-intake-hardening-2026-09-05.md).
