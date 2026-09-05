# Součinnost STRATOS pro nový začátek a kvalitní chat AKB

## Vymezení resetu

Závěrečné potvrzení resetu STRATOS uvádí, že AKB zůstalo nezměněné.
AKB má nadále historická dokumentová a konverzační data. Nejde o pokyn
k opakování resetu STRATOS ani k mazání jeho dat.

Potvrďte prosím společné pořadí samostatného owner resetu AKB: záloha,
izolovaná obnova, schválení rozsahu, pozastavení integračních writerů,
reset výhradně AKB store, nulový stav, obnovení writerů a kontrola, že
bootstrap ani konektory nevracejí historická/demo data. AKB provádí vlastní
reset; správce STRATOS pouze koordinuje své integrační writery. Stávající
identity a aktivní práva se bez zvláštního schválení nemění.

## SSO

V existujícím profilu in-app browseru byl reprodukován
`ERR_TOO_MANY_REDIRECTS` při vstupu do AKB. Anonymní HTTP průchod dosáhl
centrálního přihlašovacího formuláře s HTTP 200. Ruční retry stránka AKB
fungovala. V kontrolovaném dvacetiminutovém vzorku AKB callback logů nebyly
známé chyby state, výměny tokenu ani validace identity.

Potřebujeme společně získat omezený řetězec přesměrování stejného profilu
při přechodu STRATOS → AKB a AKB → STRATOS, při změně účtu a odhlášení.
Předávat jen pořadí, službu, cestu bez query, HTTP status a anonymizované
correlation ID. Nepředávat cookies, autorizační kódy, tokeny ani export HAR
bez odstranění citlivých hodnot. Vlastníka opravy určí až tento důkaz;
nezavádět náhradní statické oprávnění ani sdílenou session cookie.

## TLP a živé podklady pro chat

V kontrolovaném stavu není doložen nový drift doménových manifestů. Není
požadováno rozšiřování oprávnění ani změna hodnot živých dat.

Pro společnou akceptaci potvrďte na přesné revizi integračního kontraktu:

- Každá vrácená položka má stabilní identitu, source version, rozhodný čas,
  autorizovaný rozsah, stav úplnosti a platnou policy vazbu.
- Pokud doménová položka podléhá TLP/PAP či dalším omezením, AKB je musí
  získat autoritativně a ověřitelně. Chybějící metadata nejsou TLP:CLEAR.
- Živý souhrn neodstraňuje užší publikum ani zákaz exportu/externího AI.
  U kombinace zdrojů se omezení nesmějí rozšířit; nepoužívat pouze barvu
  jako náhradu rozhodnutí o příjemcích, organizaci, účelu a operaci.
- Revokace, změna scope, neaktivní identita, výpadek projection, neúplná
  stránka a policy denial musí zůstat odlišitelné a fail-closed.
- Pokud potřebná pole současný kontrakt nemá, nejprve předložit explicitní
  návrh změny se schématem a negativními testy. Nevymýšlet jednostranně
  lokální význam ani tiše měnit manifest.

Ověříme minimálně zaměstnance, manažera, externistu a úzké publikum;
zvlášť dokumentové dotazy, živé doménové dotazy a jejich kombinace.
Bez prokázané policy konformity se TLP obsah do nového korpusu nenahrává.

Požadovaný výstup: potvrzený rozsah resetu a writerů, redigovaná SSO
diagnostika, přesná revize policy/doménového kontraktu a výsledky jeho
pozitivních i negativních testů. Žádná produkční změna tímto dokumentem
není automaticky schválena.
