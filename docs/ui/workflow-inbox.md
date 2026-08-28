# Osobni Pracovni Prehled

Route `/tasks` (v integrovane instalaci `/akb/tasks`) je osobni pracovni plocha
gestora a schvalovatele. V hlavni navigaci ma nazev `Moje prace / My workspace`.
V centralnim modelu ji otevre aktivni uzivatel s `akb:read_document` nebo
`akb:manage_document`. Pristup na stranku neni opravneni schvalovat ani publikovat.

## Prehledy

- **Ke schvaleni**: aktivni revize prirazene prihlasene osobe nebo jeji skupine.
- **Moje ukoly**: aktivni osobni ukoly s filtry stavu, priority a typu.
  Historicka rozhodnuti zustavaji v detailu dokumentu a autorizovanem auditu.
- **Moje dokumenty**: vlastnene dokumenty a dokumenty s aktivnim osobnim nebo
  skupinovym prirazenim. Filtry rozlisuji gestora/vlastnika a schvalovatele,
  stav posledni pristupne verze a terminy.
- **Tymove ukoly**: autorizovany prehled pro `akb:manage_document`; ctenar ma
  pristup jen k vlastni praci, i kdyz zada tymovou cestu primo.

Nacita se jen aktivni zalozka, po 25 polozkach. Celkovy pocet odpovida jejim
filtrum a aktualnim opravnenim, nikoli cele databazi. Schvalovatel muze v prehledu
dokumentu filtrovat vsechny dokumenty, u kterych ma tuto odpovednost, nejen
prave otevrene zadosti. Filtry a navrat z detailu zustavaji v URL.

Terminy se vyhodnocuji podle kalendarniho dne `Europe/Prague`:

- `valid_to` je vcetne posledniho dne; upozorneni zacina 30 dni pred koncem;
- pri priprave nove verze zustava videt konec platnosti publikovane verze;
- `metadata.review_due_on` je samostatny termin revize, ne konec platnosti;
- neuvedeny nebo chybny termin revize je viditelny, nikoli domysleny;
- archivovane, zrusene a nahrazene dokumenty nevytvareji upozorneni na termin.

Prekroceni revize samo nezneplatni dokument ani neschvali novou verzi.
Seznam se aktualizuje pri otevreni stranky, po rozhodnuti a tlacitkem obnovy.

## Predani A Rozhodnuti

1. Gestor zkontroluje zdroj, prilohy, metadata, ucinnost a prirazeneho
   schvalovatele v detailu dokumentu.
2. V casti schvaleni zvoli **Predat ke schvaleni**. Poznamka je volitelna.
3. Registry vytvori perzistentni ukol pro presnou nepublikovanou verzi a
   prirazeneho schvalovatele; stejny pozadavek nad stejnym zdrojem je idempotentni.
4. Schvalovatel otevre **Moje prace > Ke schvaleni**, precte presnou verzi a zvoli
   **Schvalit** nebo **Vratit k uprave** s pripominkou.
5. Vraceni uzavre tuto revizi a vytvori jediny ukol gestorovi. Po oprave se
   vytvori novy schvalovaci cyklus; stara rozhodnuti zustavaji dohledatelna.
6. Schvalena verze neni automaticky zverejnena. Opravneny uzivatel ji publikuje
   existujici publikacni akci. Do te doby zustava predchozi platne vydani zachovano.

Prirazeni osoby neni prideleni prava. Schvaleni vyzaduje aktualni opravneneho
cloveka, shodu s prirazenym schvalovatelem a existujici publikacni opravneni.
Predkladatel nemuze rozhodnout vlastni nove predani, ani pres clenstvi ve skupine.
Skupinove schvaleni znamena jedno rozhodnuti opravnenym clenem, nikoli kvorum.
Organizacni jednotka nebo servisni identita nemuze byt sama schvalovatelem.

## Ochrana Konkretni Verze

Predani obsahuje interni otisk verze, zdroje, souboru, metadat, politiky a
aktivnich prirazeni. Zmena techto udaju nebo vznik novejsi verze zabrani
schvaleni stareho zdroje. Je nutne znovu predat aktualni verzi.
Publikace znovu kontroluje otisk posledniho schvaleni a cisty vysledek
bezpecnostni kontroly presneho zdroje, pokud je kontrola povinna.

Schvalovaci ukol nelze obejit akci `resolve`, prepsanim stavu dokumentu ani
prerazenim ukolu na jinou osobu. Opravneni a Information Policy se kontroluji
znovu pri rozhodnuti i publikaci. Odpoved `allowed_actions` je pouze aktualni
napoveda pro UI, nikoli trvale opravneni.

Existujici odvozene legacy ukoly zustavaji kompatibilni. Po prvnim explicitnim
predani dokumentu se publikace jeho verzi ridi novym presnym schvalenim.
Zadna existujici produkcni verze neni touto zmenou automaticky publikovana,
schvalena, migrovana nebo zrusena.

## API A Provozni Chovani

Registry vlastni:

```text
POST /api/v1/documents/{document_id}/versions/{version_id}/submit-review
GET  /api/v1/workflow/tasks?assigned_to_me=true
GET  /api/v1/workflow/documents
POST /api/v1/workflow/tasks/{task_id}/actions
```

Osobni seznamy se filtruji podle overene identity a aktualni autorizace pred
strankovanim. Vraci `items`, `total`, `limit` a `offset`; web overi uplnost
pozadovane stranky. Ukoly podporuji `q`, stav, prioritu a typ; dokumenty `q`,
`assignment`, `version_status` a `deadline`. Chybejici pravo ani vypadek sluzby
se nezobrazuje jako prazdna bezproblemova fronta. Pri zmene filtru se predchozi
vysledek skryje, dokud neni bezpecne nacten novy. Navrat z detailu zachova
aktivni zalozku, filtry a stranku.

Osobni stranka nenacita vsechny ingestion joby ani celou auditni historii.
Provozni podrobnosti zustavaji na obrazovkach Ingestion a Audit; Registry
nadale materializuje sve odvozene dokumentove, governance a auditni ukoly.

GET seznamu neprovadi zapis ani udrzbu ukolu. Odvozene ukoly a idempotentni
SLA eskalaci aktualizuje smycka Registry na pozadi, standardne kazdych 60 sekund.
`AKL_WORKFLOW_MAINTENANCE_ENABLED` ji zapina; interval ridi
`AKL_WORKFLOW_MAINTENANCE_INTERVAL_SECONDS` (15 az 3600 sekund).
PostgreSQL transakcni advisory lock nedovoli soubezny cyklus jine repliky.
Explicitni predani a rozhodnuti se ukladaji ihned, nezavisle na tomto intervalu.
U explicitniho schvaleni muze eskalace
zvysit prioritu, ale nesmi zmenit prirazeneho schvalovatele. U starsich ukolu
zustava puvodni eskalacni mechanismus. E-mail ani notifikacni worker v tomto
inkrementu nejsou zapnuty.

## Navazujici E-mailova Upozorneni

Navrh pro samostatne schvaleny inkrement, nikoli hotova dorucovaci funkce:

- udalosti: nove predani, vraceni k uprave, schvaleni, blizici se revize/expirace;
- transakcni outbox v Registry, unikatni klic udalost + ukol/verze + prijemce,
  retry s backoffem a stavem doruceni; nezneuzivat auditni log jako frontu;
- prijemce z overeneho adresare, cerstva kontrola aktivniho prirazeni a prava
  cist dokument pred odeslanim; zadne adresy z neoverenych metadat;
- e-mail pouze s obecnym upozornenim a odkazem do AKB, bez obsahu, priloh,
  citaci, tokenu nebo schvalovaciho odkazu, ktery obchazi prihlaseni;
- souhrn terminu nejvyse jednou denne; deduplikace opakovanych upozorneni;
- SMTP/secrets, odchozi sit, odesilatel, retence a preference se dohodnou
  pred zapnutim se spravcem infrastruktury; zadna zmena STRATOS je nezastoupi.

Do zapojeni dorucovani je autoritativnim seznamem **Moje prace**, ne e-mailova schranka.

Overeni tohoto inkrementu a podminky nasazeni:
`docs/qa/document-approval-workspace-2026-08-27.md`.

Navazujici overeni osobniho pristupu, strankovani, vykonu a chybovych stavu:
`docs/qa/workspace-access-performance-2026-08-28.md`.
