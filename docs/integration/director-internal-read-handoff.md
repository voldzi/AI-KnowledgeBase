# Pokyn: interní čtení pro ředitele IT

## Požadovaný výsledek

Vlastník organizace požaduje pro ověřený účet ředitele IT čtení publikovaných
interních podkladů organizace. Změnu provede vlastník centrální STRATOS Access
Governance / IAM. Nejde o oprávnění měnit STRATOS ani o důkaz jeho implementační
chyby. Konkrétní identitu předejte zabezpečenou provozní cestou, nikoli e-mailem
odvozeným od jména nebo statickým OIDC claimem.

## Výchozí zjištění

- AKB capability: `akb:access`, `akb:chat`, `akb:read_document`.
- Scopes: `public`, `budget_scope:budget:it`,
  `recipient_set:employee-directives`; 142 efektivních `document:*` rozsahů.
- Chybí obecný organizační rozsah. Zaměstnanecká výjimka pokrývá jen příslušné
  publikované směrnice a jejich přesné zdrojové verze, ne všechny interní
  dokumenty.
- Registry na ověřovaném releasu vyžaduje scope zdroje i policy audience a
  aktuální rozhodnutí Information Policy. Samotný název role nebo klasifikace
  dokumentu nejsou oprávněním.

## Postup vlastníka oprávnění

Spravujte tento přístup jako jeden schválený čtecí profil ředitele IT. Uživatel
ani správce nemá ručně doplňovat stovky jednotlivých dokumentových grantů.
Profil vyjadřuje oprávnění; konkrétní `effectiveScopes` z něj odvozuje centrální
projekce podle registrovaných zdrojů a jejich Information Policy. Název profilu
není nová lokální role v AKB a sám o sobě nic neautorizuje.

1. Ověřte interní subjekt, aktivní identitu, členství v organizaci a platný AKB
   grant. Zachovejte ostatní aplikace i servisní identity beze změny.
2. Přidejte schválený čtecí organizační rozsah pro AKB prostřednictvím podporované
   centrální správy. Zachovejte uvedené tři capability; nepřidávejte upload,
   správu dokumentů, schvalování, publikování, audit ani administraci.
3. Ověřte projekci pro každý typ zdrojového scope. Organizační scope v AKB sám
   nenahrazuje explicitní `budget_scope:*`, `document:*`, recipient set ani
   osobní vlastnictví zdroje. Potřebné efektivní rozsahy musí dodat centrální
   rozhodnutí, nikoli lokální fallback v AKB.
4. Veřejné publikované referenční podklady zpřístupněte v soukromém registru
   stejným schváleným mechanismem, pokud odpovídají policy. Nezaměňujte to se
   zveřejněním dokumentů na anonymní veřejný endpoint.
5. Zachovejte koncepty a rozpracované revize pro jejich oprávněné účastníky.
   `restricted`, `confidential`, TLP/PAP, explicitní příjemci a jiná organizace
   zůstávají chráněné. Případná výjimka vyžaduje samostatné rozhodnutí vlastníka
   daných dat; plošné interní čtení ji neuděluje.
6. Po nové autorizaci ověřte registr, náhled přesné verze, chatovou citaci a
   historickou citaci. Porovnejte počty po klasifikaci a stavu, ne pouze celkový
   počet souborů v objektovém úložišti.
7. Ověřte odebrání grantu, expiraci a nedostupnost autorizační služby. AKB nesmí
   pokračovat podle staré role, preference profilu, promptu ani méně důvěryhodného
   zdroje.

Před plošným přiřazením ověřte publikované zdroje se scope `organization`,
`budget_scope` a `document` odděleně. Širší profil nesmí přepsat užší policy,
zpřístupnit koncepty nebo rozšířit živá finanční a projektová data. Pokud
centrální model neumí požadovaný čtecí profil vyjádřit, vraťte konkrétní
kontraktní mezeru; nezavádějte zástupný administrátorský grant.

## Výstup a akceptace

- Potvrzení aktivního grantu, capability a typů scope bez tokenů nebo secretů.
- Počty autorizovaných publikovaných interních/veřejných dokumentů; důvod
  případných výjimek bez odhalení jejich obsahu.
- Čtení a citace fungují. Neoprávněná editace, upload, schválení, publikace,
  globální audit a přístup mimo organizaci zůstávají odmítnuté.
- Correlation ID nových pozitivních i negativních kontrol a čas ověření.

Projektové a finanční oprávnění tímto pokynem nerozšiřujte. Pro případné
zamítnutí ProjectFlow nejprve vraťte požadovaný scope, skutečný povolený scope
a reason kód pro stejný korelovaný požadavek; AKB pak určí vlastníka opravy.
