# Časově řízená dokumentace

## Účel

AKB spravuje právní předpisy, interní směrnice, přílohy, formuláře a metodiky
jako neměnné verze s doložitelnou účinností. Stejný model používá chat i
aplikační API:

- bez data vrací stav účinný dnes;
- s `valid_on` vrací stav účinný k požadovanému dni;
- odpověď vždy nese přesnou verzi a citaci;
- neexistující, neověřený nebo rozporný podklad se nesmí nahradit domněnkou.

Historický rozsah veřejných právních zdrojů začíná 1. ledna 2023. Starší
podklady mohou být uloženy, ale nejsou součástí garantovaného historického
profilu, dokud je gestor neověří.

## Základní model

`DocumentVersion` je neměnný zdrojový soubor. Pole `valid_from` a `valid_to`
vymezují uzavřený interval účinnosti v kalendářních dnech; `valid_to=null`
znamená bez známého konce. Více publikovaných verzí jednoho dokumentu proto
může zůstat platných v různých, nepřekrývajících se intervalech.

`ControlledDocumentPackage` spojuje jednu přesnou verzi hlavního dokumentu s
přesnými verzemi příloh, formulářů, vzorů a metodik. Balíček má vlastní
účinnost, stav `draft | approved | valid | superseded | cancelled | archived`
a neměnnou
historii vydání. Nové vydání nahrazuje předchozí balíček; nepřepisuje jeho
obsah.

Při výběru přesné hlavní verze pracovní plocha předvyplní účinnost balíčku
z `valid_from` této verze a doporučí kontrolu za jeden rok. Gestor může data
upravit před založením, ale nemusí je přepisovat ručně. Chybný koncept lze
auditovaně převést do stavu `cancelled`; historie omylu se nemaže ani
nepřepisuje.

Balíček může přejít do stavu `valid` pouze tehdy, když:

1. hlavní dokument i všichni členové existují a jsou publikovaní;
2. jejich účinnost pokrývá začátek účinnosti balíčku;
3. uživatel má oprávnění publikovat hlavní dokument;
4. balíček obsahuje alespoň hlavní dokument.

## Hierarchie zdrojů

AKB při porovnání stejného `normative_key` používá uzavřené pořadí:

| Zdroj | Pořadí |
| --- | ---: |
| zákon | 100 |
| prováděcí předpis | 90 |
| interní směrnice | 60 |
| interní pokyn | 50 |
| metodika | 40 |
| formulář | 20 |
| informativní výklad | 10 |

Pravidlo z nižší úrovně je `shadowed`, pokud stejnou otázku upravuje vyšší
účinný zdroj. Interní pravidlo zůstává `supplemental`, pokud vyšší předpis danou
otázku neupravuje. Dvě rozdílné hodnoty na stejné nejvyšší úrovni vytvářejí
`conflict`; žádná z nich není způsobilá pro automatickou spotřebu.

`consumer_eligible=true` dostane jen pravidlo:

- z balíčku účinného k požadovanému dni;
- autorizované pro volajícího;
- potvrzené gestorem jako `accepted` nebo `edited`;
- bez konfliktu a bez zastínění vyšším předpisem;
- s citací do členské verze daného balíčku.

## Vytěžení pravidel

Profil `controlled_document_rules_v1` navrhuje definice, povinnosti, zákazy,
odpovědnosti, výjimky, lhůty, finanční limity a požadované důkazy. Vytěžení je
návrh, nikoli právní rozhodnutí. Každý návrh obsahuje:

- stabilní `rule_id` a významový `normative_key`;
- strukturovanou hodnotu, jednotku, měnu a režim DPH;
- podmínky, výjimky, odpovědné role a požadované důkazy;
- přesnou citaci: dokument, verzi, chunk, článek/odstavec, stránku a krátký
  doslovný výňatek;
- míru jistoty.

Bez citovatelného podkladu se pravidlo nevytvoří. Gestor přijme, upraví nebo
odmítne návrh. AKB zaznamená audit, ale do provozních logů neukládá text
dokumentu ani citovaný výňatek.

## Zastaralost a změny

`review_due_on` je upozornění, ne automatické zrušení účinnosti. Starší interní
směrnice může zůstat posledním známým interním pravidlem. Při dotazu na pozdější
datum AKB vrátí dostupné pravidlo s
`SOURCE_REVIEW_OVERDUE_POSSIBLY_STALE` a požadavkem na kontrolu gestorem.

Zjištěná novelizace nebo novější veřejný zdroj vytvoří revizní úkol. AKB samo
nesmí změnit účinnost interního dokumentu ani prohlásit směrnici za neplatnou.
Zákon nebo prováděcí předpis s vyšší prioritou však okamžitě zabrání použití
odporujícího interního pravidla pro automatickou spotřebu.

## API

```text
POST /api/v1/controlled-documentation/packages
GET  /api/v1/controlled-documentation/packages?domain=...&valid_on=YYYY-MM-DD
POST /api/v1/controlled-documentation/packages/{package_id}/status
GET  /api/v1/controlled-documentation/rules?domain=...&valid_on=YYYY-MM-DD

POST /api/v1/stratos/extractions/controlled-rules/propose
POST /api/v1/document-extractions/{extraction_id}/feedback
```

Webová pracovní plocha je `/controlled-documentation`. Používá stejné API a
neobsahuje paralelní úložiště pravidel.

Pracovní plocha gestora načítá také schválené, dosud neplatné balíčky pomocí
`include_inactive=true`. Tento režim vyžaduje `document.update` a slouží pouze
k návrhu a lidskému ověření pravidel. Běžný chat a integrační spotřebitelé
parametr nepoužívají a nadále dostávají pouze platná vydání. Řízená extrakce
autorizuje přesné konceptní verze akcí `document.update`; obecné RAG čtení
zůstává omezené na platné verze. Balíček nelze vyhlásit jako platný, dokud
neexistuje poslední vytěžení, nejsou posouzeny všechny návrhy a alespoň jeden
citovaný návrh není potvrzený nebo opravený gestorem.

## Integrace aplikací

Budget ani jiná aplikace nesmí číst databázi AKB. Použije pravidlové API s
konkrétním `domain` a `valid_on`, vezme pouze `consumer_eligible=true` a uchová
vrácené identifikátory balíčku, verze, pravidla a citace jako rozhodovací
evidenci. `valid_on` je datum posuzované operace, nikoli datum HTTP požadavku.

Prázdný výsledek, konflikt, zastíněné pravidlo, chybějící citace, neznámý
reason kód nebo nedostupná autorizační služba znamená fail-closed. Aplikace smí
zobrazit vysvětlení uživateli, ale nesmí dopočítat limit ani nahradit pravidlo
konfigurační konstantou.

## Pilot veřejných zakázek

Pilotní doména je `public_procurement`. Veřejný korpus obsahuje zákon
č. 134/2016 Sb., časové verze od roku 2023, související prováděcí předpisy a
vybrané evropské směrnice. Interní směrnice č. 2/2023 se uloží jako historické
vydání 1 s účinností od 30. 5. 2023. Hlavní dokument je primárním členem
balíčku; Pr2 a Pr3 jsou samostatné neměnné přílohy stejného vydání. Metadata
balíčku evidují roční přezkum, gestora „Ředitel odboru veřejných zakázek a
právních služeb“ a schvalovatele „Předseda ČSÚ“. Neprovedený roční přezkum
nevymaže historický předpis, ale označí jeho pravidla varováním
`SOURCE_REVIEW_OVERDUE_POSSIBLY_STALE` a vytvoří práci pro gestora.

Oficiálním zdrojem českých znění je otevřené rozhraní e-Sbírky. Katalog pro
pilot obsahuje zejména zákon č. 134/2016 Sb., nařízení vlády č. 172/2016 Sb.,
vyhlášky č. 168/2016 Sb., 169/2016 Sb., 170/2016 Sb., 248/2016 Sb.,
260/2016 Sb. a 345/2023 Sb. Evropský kontext tvoří směrnice 2014/24/EU,
2014/25/EU a 2014/23/EU. AKB uchovává zdrojový originál, kanonický odkaz,
hash a interval účinnosti každé zachycené verze. Časová znění se přebírají
jako oficiální informativní PDF přes veřejný katalog stahování e-Sbírky; AKB
nepoužívá pro obsah znění prohlížečové HTML ani neúplné RDF fragmenty.

Pilot ověřuje:

1. aktuální odpověď bez data;
2. stav k datu v letech 2023 až současnost;
3. zastínění interního limitu vyšším předpisem;
4. použití interního pravidla, které zákon neupravuje;
5. varování u neprovedené roční kontroly;
6. citaci hlavního dokumentu i přílohy;
7. odmítnutí nepotvrzeného nebo rozporného pravidla;
8. shodný výsledek v chatu a API.

Pilot není automatickým právním posouzením druhu veřejné zakázky. Takové
rozhodnutí lze zpřístupnit až nad samostatně schváleným rozhodovacím
kontraktem, úplnou sadou časových fixtures a právní akceptací.
