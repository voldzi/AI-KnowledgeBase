# Společná akceptace STRATOS 0.5.1, AKB a Chatu

Stav 2026-09-06: **původní chyby návratu a souběhu relací jsou v ověřených
scénářích opravené. Celá dokumentová aplikace dosud není akceptovaná.**

## Převzetí a provedené změny

STRATOS implementace `2e15bba7b2b13559dec431393a69de65c41ae21f`, předání
`7f2dc46171afbf8cfb9199f214c693f69dacbb8d`. Rozdíl předání je pouze report.
Pět dotčených STRATOS služeb bylo sestaveno z neměnného exportu
`/private/tmp/akb-stratos-candidate-2e15bba7` a spuštěno ve společném projektu
`akb-stratos-test`. STRATOS zdrojový checkout nebyl upravován.

AKB ověřilo velikost, SHA-256 a npm integrity tarballu 0.5.1, převzalo jej do
vlastního Docker kontextu a uložilo tarball, manifest, závislost, lockfile,
Docker podporu a rozhodnutí o distribuci společně do lokálního commitu
`4712376aa5a25c8e96c312b81846b93f63678459`. Nic nebylo publikováno ani nasazeno
do produkce. Další implementace v této zprávě zůstává v pracovním stromu.

- AKB i samostatný Chat používají společný topbar a přepínač včetně Chatu.
  Všechny veřejné cíle jsou předány do Docker buildu, nikoli jen runtime env.
- Celý přihlašovací protokol má oddělené namespace `akb_platform_*` a
  `akb_chat_*`; cookie paths a bezpečnostní atributy zůstávají zachované.
  Cizí client selector je odmítnut bez revokace relace druhé aplikace.
- AKB i Chat mají monitor autority každých 60 s a při návratu/focusu.
  Chyba odstraní chráněné UI; změna identity/capabilities/scopes obnoví
  serverový kontext. Počáteční přesměrování stále provádí serverová stránka.
  Zrušení požadavku při odchodu nezapisuje uživatelské odhlášení.
- Probe obchází cache projekce, předává kontrolní hlavičku STRATOS a
  neprodlužuje místní BFF idle deadline ani poslední aktivitu.
- Registry nově přijímá Budget audience `organization` a `recipient_set`
  včetně TLP:RED. Finanční zdrojový scope zůstává samostatný a přesný;
  kontrola policy hash, čerstvé osoby/PDP, centrální registrace a profilu
  nebyla odstraněna. Oprava zahrnuje vstupní validátor i binary autorizaci.

## Skutečné průchody ve společném prostředí

Test používal skutečný lokální Keycloak a zaměstnance `suite-sso-reader`
s omezenými, časově platnými Access Center profily. Druhý zaměstnanec
`suite-sso-restricted` nemá ProjectFlow grant. Nebylo vypnuto ověřování TLS,
podpisů, issuer/audience ani centrálních oprávnění.

| Scénář | Výsledek |
| --- | --- |
| Jedno zadání hesla; přepínačem Budget → PF → ArchFlow → AKB → Budget | PASS; původní falešné odhlášení se neopakovalo |
| STRATOS → samostatný Chat | PASS |
| Nové souběžné karty všech pěti aplikací | PASS; stejné přihlášení, všechny BFF 200 |
| AKB → Chat → AKB a lokální cíle přepínačů | PASS |
| Dvě nezávislé cookies relací AKB/Chat ve stejném prohlížeči | PASS |
| Omezený zaměstnanec v PF | PASS; bootstrap 403 |
| Skutečné odebrání PF grantu přes Access Center | PASS; dříve viditelný pracovní prostor skryt za 55 373 ms, bootstrap 403 |
| Skutečná deaktivace testovacího členství | PASS; při návratu/focusu AKB skryto za 377 ms, Chat za 462 ms od změny |
| Řízená chyba probe 401/403/503 v AKB i Chatu | PASS v opraveném fault harnessu; chráněný shell odstraněn |
| Chat → vlastní BFF revokace → potvrzené IdP odhlášení → ostatní BFF | PASS při standardní identity freshness; podrobnosti níže |
| Obnovení testovacího členství a PF grantu | PASS; nezůstala dočasná revokace |

Řízené chyby jsou fault injection, nikoli důkaz centrální revokace. První
fault harness u Chatu nezachytil požadavky přes PWA service worker a třikrát
vypršel. Samostatný opravený běh blokoval worker pouze pro tyto transportní
testy a všech šest scénářů prošlo. Skutečná navigace, deaktivace členství a
logout proběhly s normální PWA. Původní výsledky jsou zachovány pro audit.

### Změřené globální odhlášení

Měření začíná po dokončení odhlášení u IdP včetně případného potvrzení.
Serverové endpointy jsou pozorovány přibližně každých 15 sekund; uvedené
časy jsou první zaznamenané odmítnutí 401, nikoli přesný okamžik expirace.

| BFF | První zaznamenané 401 |
| --- | --- |
| Chat, kde bylo odhlášení zahájeno | 700 ms |
| Budget / STRATOS | 244 566 ms |
| ProjectFlow | 244 879 ms |
| ArchFlow, sdílející centrální BFF | 245 188 ms |
| AKB | 291 552 ms |

Při závěrečném návratu do AKB a Chatu pracovní obsah nebyl dostupný; AKB
guard byl ověřen v čase 291 665 ms. Čas závěrečné kontroly Chat UI není časem
jeho skrytí — Chat se už při vlastním logoutu přesunul do přihlašovacího toku.
Tento běh neměří okamžik skrytí každého STRATOS UI samostatně ani všechny
směry zahájení logoutu.

Limity nebyly zkráceny: AKB/Chat 15 minut, STRATOS bez override standardní
freshness. Skutečná lhůta závisí také na expiraci tokenu. **Nejde o okamžitý
back-channel logout ani garantovanou pěti minutovou lhůtu.** Požadavek na
okamžité globální odhlášení by vyžadoval další koordinovanou práci identity
a všech BFF; změna polling intervalu tuto vlastnost sama nezajistí.

## Technické ověření a provozní stav

- Finální webové testy: **988 prošlo, 0 selhalo, 0 vynecháno**; typecheck prošel.
- Budget Registry: **63 testů prošlo**, včetně runtime/OpenAPI shody,
  organization/recipient_set, TLP:RED, odmítnutí aktuálním PDP a zachování
  finančního scope. Web Budget parser: **16 testů prošlo**.
- Přesné Dockerfiles: pět STRATOS služeb a AKB web, Chat a Registry sestaveny;
  webový frozen install v Dockeru používá pnpm 11.7.0. Běží 21 kontejnerů,
  žádný není unhealthy. Služby, volumes, klíče a identity zůstaly zachovány.
- Živý smoke: health/readiness služeb 200; zvláštní admission readiness
  STRATOS 503 `DOCUMENT_ADMISSION_CATALOG_NOT_READY`, AKB 503
  `document_profile_admission_unavailable`; anonymní požadavek 401 a
  chybný vstup 400. ClamAV povolil čistý vzorek a detekoval EICAR.
- Skeleton, OpenAPI index a kontrola whitespace prošly. Aktualizace origin
  zůstává nedostupná kvůli SSH publickey; místní baseline proti uloženému
  origin/main prošla. Sestava není ověřený produkční release kandidát.

Podklady: [výsledky a identity obrazů](stratos-ui-051-2026-09-06/).
Reprodukovatelný lifecycle runner je `scripts/local_acceptance_suite_sso.mjs`;
vyžaduje existující soukromé syntetické účty v `data/local-acceptance/`.
Dočasné změny grantů a členství obnovuje v `finally`. Hesla/tokeny/cookies
nepatří do sdílené dokumentace.

## Co zůstává k dokončení

1. **AKB:** source preflight/confirm kontrakt a implementace pro PF/ArchFlow;
   poté **STRATOS:** odpovídající zdrojové adaptéry. Tyto endpointy zatím nebyly
   dodány a tento SSO increment je neoznačuje jako hotové.
2. Společný nový dokument ze všech zdrojů → scanner → confirm → index → Chat
   → přesná citace, včetně verzování, retry a revokace mezi kroky.
3. Pozitivní native/official příjem, Executive Center provider a důvěryhodná
   federovaná historie podle společného backlogu.

Budget audience je nyní implementovaná a otestovaná, ale není to pozitivní
reálný upload. Jeho OpenAPI popis byl aktualizován; nový SHA-256 souboru je
`5853e7150ccb2643826e8410f38aa9fcf92745a298c81991df61aa0c5ed29fe1`.
Před další koordinovanou source integrací musí STRATOS aktualizovat pin.
`BUDGET_AKB_DOCUMENT_INTAKE_ENABLED=false` a uzavřená admission readiness
zůstávají zachované. Povinné TLP a odpovědnosti nemají žádnou novou výjimku.
