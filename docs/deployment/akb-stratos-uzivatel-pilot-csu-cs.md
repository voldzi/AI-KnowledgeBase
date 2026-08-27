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
document_revision: "1.2"
target_environment: csu-test
applies_to: "Návrh pilotu; konkrétní release se určí při převzetí"
reviewed_on: "2026-08-27"
---

# AKB a STRATOS: uživatelská příručka pilotu ČSÚ

## Co potřebujete

Potřebujete schválený osobní účet, přístup z vnitřní sítě a přidělená oprávnění. Adresu aplikace a kontakt na podporu vám předá správce pilotu. V nabídce se zobrazují části, ke kterým máte přístup.

## Přihlášení a přístup

AKB a STRATOS používají společnou přihlašovací službu schválenou organizací. Může jít o Keycloak nebo volitelnou identity službu STRATOS; uživatel zadává heslo pouze na centrální přihlašovací stránce. Při přechodu mezi aplikacemi ve stejném prohlížeči obvykle nevyplňuje heslo znovu. Každá aplikace samostatně kontroluje aktuální oprávnění; úspěšné přihlášení samo o sobě nedává přístup ke všem dokumentům, financím nebo projektům.

Následující politika relací popisuje cílové společné SSO. Správce pilotu před předáním potvrdí, že ji zvolená vydání aplikací a poskytovatel přihlášení společně ověřily. Neověřené přepnutí poskytovatele není součástí běžného uživatelského přihlášení.

Volbu „Zůstat přihlášen na tomto zařízení“ nastavujete pouze na centrální přihlašovací stránce, nikoliv znovu v AKB. Používejte ji jen na vlastním nebo spravovaném zařízení. Doložená důvěryhodná relace trvá nejvýše 90 dní od začátku centrálního přihlášení a skončí po 30 dnech neaktivity. Přechod mezi aplikacemi tuto dobu neprodlužuje. Bez této doložené volby má relace AKB nejvýše 8 hodin neaktivity a 24 hodin celkové platnosti a prohlížeč dostane pouze dočasnou cookie.

Pro plynulý přechod používejte stejný prohlížeč a uživatelský profil. Samostatně instalovaný Chat může při prvním spuštění vyžadovat vlastní přihlášení. Po odhlášení, odebrání oprávnění nebo vypršení relace chráněný obsah zůstane nedostupný. Samotné zavření okna není spolehlivé odhlášení: některé prohlížeče relaci při obnovení oken zachovají. Na sdíleném zařízení se vždy výslovně odhlaste.

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
- „Jaký má IT rozpočet na letošní rok?“
- „Jaký je stav projektového portfolia?“
- „Jaké prostředky potřebuji pro testovací instalaci AKB a STRATOS?“
- „Kde najdu vzor provozního návodu pro další aplikaci?“

Odpověď závisí na podkladech zpřístupněných v pilotu. Návod k používání Budgetu je dokumentový podklad; skutečný rozpočet se načítá z Budgetu. U manuálu je důležitá také verze aplikace, nikoliv pouze datum dokumentu.

AKB volí zdroj podle obsahu dotazu: řízené dokumenty a pravidla, nebo aktuální autorizovaná data STRATOS. U kombinovaného dotazu může odpověď uvést více zdrojů; jejich původ je vždy viditelný.

Pokud AKB zdroj nemá, není oprávněný nebo je dočasně nedostupný, neodhadne odpověď. Zobrazí srozumitelný stav a případně doporučí další krok. Neznamená to automaticky, že data v organizaci neexistují.

## Jak rozumět výsledku

| Stav odpovědi | Co znamená | Jak pokračovat |
| --- | --- | --- |
| Doložená odpověď | Odpověď má dostupný zdroj a uvedený rozsah. | Otevřete citaci a ověřte její použitelnost. |
| Neúplný výsledek | Zdroj poskytl jen část údajů. | Nepovažujte dílčí částku nebo počet za úplný souhrn. |
| Chybějící podklad | Pro otázku není dostupný dostatečný zdroj. | Upřesněte aplikaci, téma nebo datum; případně kontaktujte gestora. |
| Rozpor mezi pravidly | Podklady nedávají jednoznačné rozhodnutí. | Požádejte gestora o posouzení. |
| Přístup není povolen | Požadavek přesahuje vaše oprávnění. | Obraťte se na správce přístupů; nesdílejte cizí účet. |
| Dočasně nedostupný zdroj | Závislá služba neodpovídá. | Zkuste dotaz později; při opakování kontaktujte podporu. |

## Kdo co dělá

- Zaměstnanec: čte zveřejněné dokumenty a používá chat.
- Gestor: připravuje obsah a ověřuje vytěžené informace.
- Schvalovatel: schvaluje nebo vrací návrhy.
- Administrátor AKB: spravuje nastavení, workflow a vazby na přístupové politiky; centrální granty a scope spravuje pověřený správce STRATOS.
- Externí spolupracovník: čte jen konkrétní dokumenty a aplikace přidělené pro jeho práci; zaměstnanecké směrnice nedostává automaticky.

Pro gestora a schvalovatele se při předání ověří pracovní přehled přiřazených dokumentů a úkolů. Gestor má sledovat stav své verze a termín revize, schvalovatel obsah konkrétní verze čekající na rozhodnutí. Přidělení role samo nezpřístupní cizí dokumenty. Na e-mailovou notifikaci se nespoléhejte, dokud správce nepotvrdí, že je v daném prostředí zavedena.

Pokud vidíte chybný obsah, neobcházejte jej vlastní kopií dokumentu. Nahlaste název dokumentu, verzi, stručný problém a případně correlation ID správci AKB nebo vlastníkovi dané oblasti.

## Stažení dokumentace a PDF

Akce „Stáhnout zdroj“ vrací formát uloženého originálu. U Markdownu jde o soubor `.md`, nikoliv automaticky o PDF. Předávací sada obsahuje odvozené PDF ze stejné revize Markdownů. Po jeho řízeném vložení je možné číst a stahovat tento PDF dokument v rozsahu přidělených oprávnění. Dostupnost přílohy nebo exportu ověřte v konkrétním vydání.

PDF soubor odpovídá označené revizi dokumentace. Při jeho aktualizaci se vždy vychází ze stejného spravovaného originálu.

## Jak ověřit správnou odpověď

Otevřete citaci, porovnejte aplikaci, verzi a prostředí a zkontrolujte, že text skutečně odpovídá otázce. Při chybě nebo chybějícím podkladu kontaktujte vlastníka dokumentu. Není nutné zkoušet odhadnout interní technické příkazy.
