---
type: operating_model
document_type: methodology
title: "AKB: metodika tvorby dokumentace aplikací"
external_ref: DOC-AKB-AUTHORING-METHOD
application_id: akb
owner: akb-team
classification: internal
status: draft
language: cs
source_system: git
tags: [dokumentace, metodika, autorstvi, akb]
documentation_profile: akb-application-docs-1
documentation_kind: metodika
document_revision: "1.0"
target_environment: obecne
applies_to: "Dokumentace aplikací předávaná do AKB"
reviewed_on: "2026-08-27"
---

# AKB: metodika tvorby dokumentace aplikací

## Účel a rozsah

Metodika sjednocuje dokumentaci AKB, STRATOS a dalších aplikací. Autor má jasnou osnovu, uživatel dohledá správný návod a Chat získá zdroj s rozpoznatelnou aplikací, verzí a účelem. Platí pro návody, technické reference a provozní podklady. Nenahrazuje schvalování interních předpisů ani rozhodnutí o přístupu.

Jde o návrh redakčních pravidel k převzetí vlastníkem dokumentace. Označení `akb-application-docs-1` je název této metodiky, nikoli nová verze API nebo již implementovaný automatický importér.

## Rychlý postup autora

1. Zvolte aplikaci, cílového čtenáře a jeden konkrétní účel dokumentu.
2. Vyberte odpovídající vzor z tabulky níže.
3. Vyplňte identitu dokumentu, jeho revizi a použitelnost pro verzi aplikace a prostředí.
4. Nahraďte všechny zástupné údaje, popište předpoklady, postup, výsledek a bezpečné řešení neúspěchu.
5. Nechte postup věcně ověřit vlastníkem aplikace nebo pověřeným správcem.
6. Vložte zdroj a přílohy do AKB řízenou cestou jako koncept; ověřte metadata a skutečné přístupy.
7. Po kontrole publikujte oprávněnou rolí a ověřte hledání, citace i případné PDF.

Pro obyčejný manuál se nezakládá balíček Controlled Rules a nevytěžují se automaticky právní limity. Tento další proces je určen pouze pro skutečně řízená rozhodovací pravidla.

## Druhy dokumentů a vzory

| Potřeba čtenáře | Oblast | Vzor |
| --- | --- | --- |
| Jak provedu konkrétní úkon? | `uzivatel` | [Uživatelský postup](../templates/application-documentation/akb-vzor-uzivatelsky-postup-cs.md) |
| Jak aplikaci připravím a nainstaluji? | `instalace` | [Instalační postup](../templates/application-documentation/akb-vzor-instalacni-postup-cs.md) |
| Jak provozuji službu nebo obnovím data? | `provoz` | [Provozní postup a obnova](../templates/application-documentation/akb-vzor-provozni-obnova-cs.md) |
| Jaké jsou přesné parametry a rozhraní? | `reference` | [Technická reference](../templates/application-documentation/akb-vzor-technicka-reference-cs.md) |
| Jak systém funguje a co chrání data? | `architektura`, `bezpecnost` | [Architektura a bezpečnost](../templates/application-documentation/akb-vzor-architektura-bezpecnost-cs.md) |

Samostatný `prehled` shrnuje přínosy a hranice pro vedení. Oblasti `metodika` a `vzor` slouží autorům. Nedělejte jednu rozsáhlou příručku, která míchá uživatelské úkony, instalaci, tajné provozní hodnoty a audit.

## Názvy a stabilní identita

Název souboru má tvar:

```text
aplikace[-modul]-oblast-tema-jazyk.md
```

Používejte malá ASCII písmena, číslice a spojovníky. Modul je volitelný. Jazyk je například `cs` nebo `en`. Revize ani datum nejsou součástí běžného názvu zdroje; u archivního distribučního balíčku být mohou.

Příklady:

```text
akb-uzivatel-vlozeni-dokumentu-cs.md
stratos-budget-uzivatel-zalozeni-akce-cs.md
stratos-projectflow-provoz-obnova-cs.md
personalni-system-uzivatel-zadost-o-dovolenou-cs.md
```

Jde o příklady pojmenování, nikoli seznam již existujících návodů. Viditelný název v AKB zůstává přirozený, například „Budget: založení plánované akce“. Nepoužívejte názvy `final`, `final2` nebo `nova-verze`.

Dokument drží stálé `external_ref`, například `DOC-STRATOS-BUDGET-CREATE-ACTION`. Skutečnou identitu a verze přiděluje Registry AKB. Přejmenování souboru nesmí samo o sobě založit druhý dokument; při vložení nové revize vždy dohledáte původní záznam podle ID nebo externího odkazu. Příloha odkazuje na konkrétní verzi rodiče, ne jen na podobný název souboru.

## Metadata bez zbytečné administrativy

Autor vyplňuje především název, aplikaci, druh, vlastníka, revizi a použitelnost. Jazyk, klasifikaci a opakující se hodnoty lze předvyplnit podle schválené sady. Pro přístupy se ale nesmí slepě převzít výchozí hodnota.

| Údaj | Význam |
| --- | --- |
| `title`, `external_ref` | Srozumitelný název a stabilní identita dokumentu. |
| `application_id`, případně `component_id` | Aplikace a volitelně modul; nejde o oprávnění. |
| `document_type`, `documentation_kind` | Typ AKB a redakční oblast; nejsou to totéž. |
| `owner` | Spravující tým; při převzetí se přiřadí skutečný odpovědný vlastník. |
| `document_revision` | Revize textu dokumentace, například `1.0`; není to release aplikace. |
| `applies_to`, `target_environment` | Pro kterou verzi či ověřený rozsah verzí a prostředí postup platí. |
| `classification`, `language`, `tags` | Klasifikace, jazyk a několik věcných témat pro hledání. |
| `status`, účinnost, termín revize | Skutečný stav a data se ověřují v Registry; hlavička souboru je pouze návrh. |

Číselné release verze uvádějte jen z doloženého vydání. Není-li přesný release určen, napište „návrh, vyžaduje ověření pro cílové vydání“, nikoli „platí pro všechny verze“. Datum přípravy ani revize se nesmí zaměnit za datum účinnosti předpisu. Upomínka přezkumu neznamená automatické zrušení dokumentu.

### Kompatibilita se současným AKB

Sada používá YAML hlavičku slučitelnou se základními poli `stratos-okf-v1`. Nástroj OKF dnes zpracovává jen vyjmenovaná pole; redakční údaje `documentation_profile`, `documentation_kind`, `document_revision`, `target_environment`, `applies_to` a `reviewed_on` automaticky nepřenáší všechny.

Při řízeném vložení se musí zkontrolovat jejich mapování do metadat dokumentu, případně zůstanou čitelně v obsahu. Nelze předpokládat, že pouhé přidání YAML vytvoří nové filtry, přístupové role nebo datum účinnosti. Tato sada nemění schéma API ani chování importéru. Dokud není přenos a vyhledání konkrétního pole ověřeno, nesmí na něm stát bezpečnostní či verzovací rozhodnutí.

## Osnova kvalitního postupu

Každý postup má jasný účel, určení čtenáře, předpoklady, číslované kroky, očekávaný výsledek, chybové stavy a odpovědnou podporu. Každý krok říká, co uživatel udělá a jak pozná úspěch. Používejte skutečné názvy ovládacích prvků ověřené v daném vydání.

- Jedna kapitola řeší jednu úlohu. Nadpis odpovídá běžné otázce uživatele.
- Zkratku při prvním použití vysvětlete; do textu přirozeně zahrňte běžné synonymum.
- Tabulky mají hlavičky a jednotky; částka vždy uvádí měnu a DPH, je-li relevantní.
- Obrázek doplňuje text, nenese jedinou informaci potřebnou k provedení úkolu.
- Příkazy mají předpoklady, rozsah dopadu a ověření. Destruktivní krok musí mít schválení a obnovu.
- Neuvádějte hesla, tokeny, privátní klíče ani reálné osobní údaje v příkladech či snímcích.
- Fakt, doporučení, návrh a neověřený předpoklad musí být rozlišitelné.

## Markdown, PDF a přílohy

Kanonický zdroj je jeden: Markdown nebo jiný spravovaný originál. PDF je odvozený čitelný výstup stejné revize, nikoli samostatně upravovaný dokument. U PDF se eviduje jeho vlastní kontrolní součet a vazba na konkrétní revizi zdroje. Hash zdroje a hash PDF přirozeně nejsou stejné.

Současný AKB podporuje Markdown jako dokument. Ovládací prvek „Stáhnout zdroj“ stáhne původní soubor. Automatický převod celého Markdown dokumentu do PDF zatím v této cestě není; Office má vlastní konverzi do PDF. Proto předávací sada obsahuje předem vytvořené PDF. Chcete-li jej nabídnout také v AKB, vložte jej řízeně jako odpovídající odvozený soubor či svázanou přílohu a ověřte dostupnou vazbu a autorizaci. Nevydávejte dva nezávisle indexované exempláře za dva různé důkazy.

Formulář, obrázek nebo datový slovník se připojuje k přesné verzi návodu. Změna použitelnosti přílohy vyžaduje novou vazbu v nové verzi. Distribuční ZIP je obal pro předání; nenahrazuje jednotlivé dohledatelné dokumenty v AKB.

## Vzory nejsou provozní fakta

Prázdné vzory jsou samostatně dohledatelné dokumenty s názvem „Vzor“, oblastí `vzor` a odpovídajícím tagem. Jejich účelem je odpovědět „kde je šablona“, nikoli „jaký máme server“. Zástupné hodnoty se označují `DOPLNIT`; nesmějí být vydány jako skutečná konfigurace.

Současná sada nezavádí automatický zákaz využití šablon retrieverem. Proto je nutný negativní test Chatu před publikací vzorů do jeho korpusu. Pokud Chat použije vzor jako provozní důkaz, vzory se do té doby zpřístupní jen v dokumentovém režimu, který je prokazatelně vylučuje z odpovědí, nebo zůstanou neveřejným konceptem. Samotný tag není bezpečnostní filtr.

## Přístup, publikace a nová revize

Kategorie dokumentace není role. Externí čtenář dostává jen schválený rozsah pro příslušnou aplikaci a dokumenty; označení `internal` ani `application_id` mu samo žádný přístup nedává. Přílohy, náhledy, download a citace musí mít nejvýše stejný přístup jako zdroj.

Nové dokumenty se vkládají jako koncept. Autor či vlastník ověří text a použitelnost; oprávněná role provede potřebné schválení a publikaci. U běžných manuálů není potřeba vytvářet další organizační role nad rámec schváleného modelu. Soubory této sady mají záměrně `status: draft`.

Nové vydání vzniká jako další verze stejného dokumentu. Zachová se historie, přesné citace a staré přílohy. Před publikací se uvede, zda nové znění nahrazuje dosavadní návod, nebo platí souběžně pro jinou verzi aplikace. Chat nemá použít návod pro jinou verzi, pokud jeho použitelnost není potvrzena; má si vyžádat upřesnění.

## Kontrola před vydáním

1. Žádné nevyplněné údaje mimo samotné vzory; identita, vlastník a revize jsou jednoznačné.
2. Postup provedl nebo ověřil kompetentní člověk pro uvedený release; neprovedené testy jsou přiznány.
3. Odkazy a přílohy vedou na správný dokument a verzi, ne na lokální cestu autora.
4. PDF je úplné, čitelné, bez přetékajících tabulek a odpovídá zdroji.
5. Přístupy a neviditelnost konceptu se ověřily pod cílovým čtenářem.
6. Vyhledání běžnou otázkou, otevření citace a negativní dotaz bez podkladu dopadly správně.

Praktické vložení této sady popisuje [postup importu a ověření](akb-postup-vlozeni-predavaci-dokumentace-cs.md).
