# ADR 0010: Copilot ředitele používá řízené doménové read-modely

Stav: Accepted

Datum: 2026-07-21

## Kontext

AKB Chat má spojovat dokumentové důkazy s aktuálními údaji z Budget,
ProjectFlow a později dalších aplikací STRATOS. Přímé čtení jejich databází by
obcházelo lokální autorizační PEP, Information Policy, audit a vlastnictví
doménových schémat.

## Rozhodnutí

AKB nebude číst databáze zdrojových aplikací. Serverový orchestrátor AKB bude
volat verzované, deterministické a read-only doménové nástroje přes aplikační
API.

- Transport používá dedikovanou identitu `svc-akb-director-copilot` a oddělený
  čerstvý uživatelský bearer.
- Každá zdrojová aplikace ověří oba tokeny, načte aktuální STRATOS access
  projection a aplikuje vlastní lokální PEP.
- Capabilities ani scopes poslané v hlavičkách nejsou autorita. Scopes v těle
  jsou pouze horní mez dotazu a zdroj je musí znovu zúžit.
- AKB normalizuje odpovědi do `EvidenceItem`, odvodí nejpřísnější policy a
  vytvoří neměnný `AnalysisSnapshot` bez raw doménových payloadů.
- Audience požadavky všech zdrojových policy zůstávají současně závazné; AKB je
  neslučuje textovým průnikem. Chybějící dokumentové kontextové tagy a AI cesta
  pro `RESTRICTED`, `NO_EXTERNAL_AI` nebo `LOCAL_PROCESSING_ONLY` selžou
  uzavřeně.
- Úplný katalog Information Policy V2 je přenesen beze ztráty. Federovaný
  výsledek se bez úspěšného auditu nevrátí; nesplnitelné recipient, originator
  a PAP obligations zabrání AI syntéze.
- První řez používá Budget, ProjectFlow a dokumentové RAG AKB. Je pouze pro
  čtení a je za výchozím vypnutým feature flagem.

## Důsledky

Zdrojové aplikace musí udržovat stabilní ID, časovou semantiku, policy lineage a
contract fixtures. AKB získává auditovatelnou federaci bez druhého source of
truth, ale dostupnost odpovědi závisí na dostupnosti a odezvě zdrojových API.
Částečný výsledek musí být uživateli viditelný a nikdy se nedoplňuje odhadem.

Aktivace v produkci je možná až po conformance testech zdrojů, OBO/service
identity testu, negativních scope testech a reautorizaci uložené historie.
