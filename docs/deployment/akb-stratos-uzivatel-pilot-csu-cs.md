---
type: knowledge_article
document_type: manual
title: "AKB a STRATOS: uživatelská příručka pilotu ČSÚ"
external_ref: DOC-AKB-STRATOS-PILOT-USER
application_id: akb-stratos
owner: akb-team
classification: internal
status: draft
language: cs
source_system: git
tags: [dokumentace, csu-pilot, uzivatel, manual, akb, stratos]
documentation_profile: akb-application-docs-1
documentation_kind: uzivatel
document_revision: "1.0"
target_environment: csu-test
applies_to: "Návrh pilotu; konkrétní release se určí při převzetí"
reviewed_on: "2026-08-27"
---

# AKB a STRATOS: uživatelská příručka pilotu ČSÚ

## Co potřebujete

Schválený osobní účet, přístup z vnitřní sítě a přidělená oprávnění. Tato příručka popisuje zamýšlený pilot; konkrétní dostupné funkce potvrdí jeho převzetí. Neobsahuje hesla ani přihlašovací URL konkrétního prostředí.

## Přihlášení a přístup

AKB a STRATOS používají společné přihlášení přes Keycloak. Při přechodu mezi aplikacemi uživatel obvykle nevyplňuje heslo znovu, protože aplikace ověří existující centrální SSO relaci. Každá aplikace však samostatně kontroluje aktuální oprávnění; úspěšné přihlášení samo o sobě nedává přístup ke všem dokumentům, financím nebo projektům.

Volbu důvěryhodného zařízení používejte jen na vlastním nebo spravovaném zařízení. Po odhlášení, odebrání oprávnění nebo vypršení relace chráněný obsah zůstane nedostupný.

## Práce s dokumenty

1. V registru dokumentů vyhledejte název, oblast nebo postup.
2. Otevřete publikovaný dokument a ověřte jeho účinnost a verzi.
3. U odpovědi v chatu otevřete citaci; vede na konkrétní dokumentovou verzi nebo zdrojový úsek.
4. Historický dotaz formulujte s jednoznačným datem, například „Jaké znění platilo 1. 7. 2024?“. V průběhu roku se znění může změnit.

Koncept není platný pokyn. Pokud je zdroj označen jako neúplný, v konfliktu nebo po termínu revize, odpověď není automatickým rozhodnutím a je třeba postupovat podle uvedeného gestora.

## Jak se ptát chatu

Chat přijímá běžně formulované otázky, například:

- „Kde najdu formulář pro zahraniční cestu?“
- „Jaký je limit průzkumu trhu?“
- „Jaký má IT rozpočet na rok 2025?“
- „Jaký je stav projektového portfolia?“
- „Jaké prostředky potřebuji pro testovací instalaci AKB a STRATOS?“
- „Kde najdu vzor provozního návodu pro další aplikaci?“

Příklady nejsou potvrzením, že příslušný formulář, předpis nebo finanční údaj už byl do pilotu vložen. Návod k používání Budgetu je dokumentový podklad; skutečný rozpočet se načítá z Budgetu. U manuálu je důležitá také verze aplikace, nikoliv pouze datum dokumentu.

AKB volí zdroj podle obsahu dotazu: řízené dokumenty a pravidla, nebo aktuální autorizovaná data STRATOS. U kombinovaného dotazu může odpověď uvést více zdrojů; jejich původ je vždy viditelný.

Pokud AKB zdroj nemá, není oprávněný nebo je dočasně nedostupný, neodhadne odpověď. Zobrazí srozumitelný stav a případně doporučí další krok. Neznamená to automaticky, že data v organizaci neexistují.

## Kdo co dělá

- Zaměstnanec: čte zveřejněné dokumenty a používá chat.
- Gestor: připravuje obsah a ověřuje vytěžené informace.
- Schvalovatel: schvaluje nebo vrací návrhy.
- Administrátor AKB: spravuje nastavení, workflow a vazby na přístupové politiky; centrální granty a scope spravuje pověřený správce STRATOS.

Pokud vidíte chybný obsah, neobcházejte jej vlastní kopií dokumentu. Nahlaste název dokumentu, verzi, stručný problém a případně correlation ID správci AKB nebo vlastníkovi dané oblasti.

## Stažení dokumentace a PDF

Akce „Stáhnout zdroj“ vrací formát uloženého originálu. U Markdownu jde o soubor `.md`, nikoliv automaticky o PDF. Předávací sada obsahuje odvozené PDF ze stejné revize Markdownů. Po jeho řízeném vložení je možné číst a stahovat tento PDF dokument v rozsahu přidělených oprávnění. Dostupnost přílohy nebo exportu ověřte v konkrétním vydání.

PDF soubor má vlastní kontrolní součet a vazbu na zdrojové revize. Není druhou nezávisle upravovanou verzí obsahu ani důkazem, že ČSÚ pilot už prošel akceptací.

## Jak ověřit správnou odpověď

Otevřete citaci, porovnejte aplikaci, verzi a prostředí a zkontrolujte, že text skutečně odpovídá otázce. Při chybě nebo chybějícím podkladu kontaktujte vlastníka dokumentu. Není nutné zkoušet odhadnout interní technické příkazy.
