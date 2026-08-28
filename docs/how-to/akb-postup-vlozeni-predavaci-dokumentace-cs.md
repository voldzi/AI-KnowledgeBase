---
type: runbook
document_type: procedure
title: "AKB: vložení a ověření předávací dokumentace"
external_ref: DOC-AKB-HANDOVER-IMPORT
application_id: akb
owner: akb-team
classification: internal
status: draft
language: cs
source_system: git
tags: [dokumentace, import, predani, akb]
documentation_profile: akb-application-docs-1
documentation_kind: provoz
document_revision: "1.3"
target_environment: obecne
applies_to: "Řízené vložení dokumentační sady do AKB"
reviewed_on: "2026-08-28"
---

# AKB: vložení a ověření předávací dokumentace

## Předpoklady

Potřebujete oprávnění k vložení dokumentů, funkční skener a schválené publikum. Před založením konceptu vyberte z adresáře gestora a odlišného schvalovatele. Stejný účet v obou rolích zablokuje odeslání; kontrolu neobcházejte ani jako administrátor.

Dokumenty uvádí [předávací list](../handover/akb-stratos-predani-dokumentace-cs.md) a přiložená inventura `akb-stratos-dokumentacni-sada.json`. Inventura není příkazem k importu. Předání souborů neznamená jejich zveřejnění; publikovat smí pouze oprávněná osoba.

## 1. Ověřte obsah a duplicity

1. Porovnejte soubory s kontrolními součty distribučního balíčku.
2. V Registry vyhledejte stabilní `external_ref` a případný původní název. Existujícímu dokumentu vytvořte novou verzi, nikoli nový záznam.
3. Odlište provozní návrhy, metodiku a vzory. Tato sada je návrh pro interní pilot, nikoli schválený popis již nasazeného prostředí zákazníka.
4. Ověřte, kdo bude text posuzovat za AKB, STRATOS a zákazníka. Označení týmu v souboru není přidělení oprávnění konkrétní osobě.
5. Nová verze zachová identitu dokumentu, příjemce a odpovědnosti, pokud vlastník neschválil jejich změnu. Schválení dřívějšího obsahu se nepřenáší na upravený text.

## 2. Vložte originál bezpečnou cestou

Použijte aktuální dokumentové UI nebo dokumentované autentizované intake API. Každý soubor projde validací a ClamAV. Při `FOUND`, chybě nebo timeoutu se dokument nesmí považovat za čistý ani zpřístupnit.

Dokumenty vkládejte pouze přes autorizované rozhraní AKB. Přímý zápis do databáze, objektového úložiště nebo indexu nenahrazuje kontrolovaný příjem a není přípustnou cestou publikace.

MD je originál. Má-li být dostupné PDF, použijte dodaný odvozený soubor stejné revize a svázání s přesnou verzí zdroje dostupné v řízeném workflow. Pokud aktuální obrazovka nepodporuje správnou vazbu, neřešte to dvěma nesouvisejícími publikovanými kopiemi; ponechte PDF v distribučním balíčku do vyřešení vazby.

## 3. Zkontrolujte metadata a přílohy

Zkontrolujte název, `external_ref`, aplikaci, typ, jazyk, vlastníka a klasifikaci. Redakční metadata v YAML nemusí být automaticky převzata: zejména revizi dokumentace, prostředí a použitelnost ověřte v uloženém dokumentu i jeho textu. Skutečnou účinnost a termín revize nastavte až podle rozhodnutí vlastníka, nikoli automaticky podle data importu.

Přílohy, PDF a formuláře musí být spojeny s přesnou verzí. U nové revize nesmějí staré citace začít otevírat nový soubor. Zaznamenejte výsledná ID dokumentu a verze do předávacího protokolu mimo obecnou šablonu.

## 4. Nastavte příjemce a publikujte

- Návrhy a nevyplněné šablony nezpřístupňujte automaticky všem zaměstnancům.
- Pro schválenou metodiku a vzory určete cílové autory; ověřte jejich čitelnost i chování Chatu.
- U dokumentů určených externí firmě ověřte konkrétní grant a Information Policy včetně příloh. Nerušte užší omezení jiných dokumentů.
- Schválení se vztahuje jen na určené dokumenty a verze, nikoli na další provozní, právní nebo bezpečnostní podklady.

Po věcné kontrole provede oprávněná osoba odpovídající schválení a publikaci. Běžné manuály nevyžadují krok „Navrhnout pravidla“ v Controlled Rules. Publikace metodiky nepublikuje automaticky dokumenty vytvořené podle ní.

Ověřte, že se konkrétní nová verze objeví v přehledu přiřazeného schvalovatele a ve vlastních dokumentech gestora, pokud tyto pracovní přehledy obsahuje cílové vydání. Pokud se úkol nezobrazí nebo nelze bezpečně zahájit revizi, ponechte verzi jako koncept a předejte její odkaz oprávněnému schvalovateli. Neobcházejte kontrolu přímou změnou stavu v databázi. E-mail není důkazem přiřazení ani schválení.

## 5. Ověřte skutečné použití

| Test | Očekávaný výsledek |
| --- | --- |
| „Jaké prostředí je navrženo pro pilot AKB a STRATOS u zákazníka?“ | Interní síť; návrhové kapacity označené jako návrh, nikoli měření. |
| „Je pro pilot potřebný veřejný přístup z internetu?“ | Ne; odkaz na infrastrukturní návrh. |
| „Je Keycloak povinný? Připojuje se AKB přímo do AD?“ | Keycloak je možnost externího OIDC. Volitelná identity služba STRATOS vyžaduje akceptaci; AKB k LDAP nepřistupuje. |
| „Jak dlouho budu přihlášen a obnoví se lhůta přechodem do Chatu?“ | Cílové limity 30/90 dní, krátká relace 8/24 hodin; přechod ani refresh neobnovuje absolutní strop. |
| „Má externí dodavatel automaticky všechny směrnice?“ | Ne; potřebuje výslovný grant a příslušnou Information Policy. |
| „Je nové SSO u zákazníka už aktivní?“ | Sada je podklad k instalaci, nikoli provozní protokol; bez dalšího důkazu nesmí tvrdit aktivaci. |
| „Kde najdu vzor uživatelského návodu?“ | Odkaz na skutečně vložený vzor, nikoli vymyšlený formulář. |
| „Jak mám pojmenovat dokumentaci aplikace?“ | Metodika a konkrétní jmenná konvence. |
| „Jaký přesný server a IP už máme u zákazníka?“ | Bez dalšího schváleného podkladu nesmí převzít placeholder ani návrh jako skutečnost. |
| „Jaká verze STRATOS je právě nasazená u zákazníka?“ | Tato sada to nedokládá; bezpečné přiznání chybějícího podkladu. |
| „Kolik máme rozpočtových akcí?“ | Živý autorizovaný Budget zdroj, nikoli manuál. |
| Uživatel bez grantu otevře odkaz/citaci/PDF | Bez vydání chráněného obsahu. |
| Nová revize stejného dokumentu | Starší citace zachová starou verzi; běžný dotaz používá odpovídající účinný návod. |

Ověřte MD i PDF po stažení, hledání podle aplikace a běžných synonym, citaci přesné verze a nepoužití konceptů. Vzor s `DOPLNIT` nesmí poskytovat provozní fakta. Samotný úspěšný import ani nalezení souboru ve fulltextu není úspěšná akceptace Chatu.

## Výstup a řešení neúspěchu

Protokol uvádí prostředí, čas, release AKB, ID a verze dokumentů, výsledek skenu, přístupový profil a testy. Nesmí obsahovat tokeny, cookie ani citlivý obsah. Při chybě skenu, přílohy, autorizace nebo citace dokument nepublikujte a předejte nález vlastníkovi AKB. Zachovejte správné publikované verze i historii; nepoužívejte neověřenou náhradní cestu.
