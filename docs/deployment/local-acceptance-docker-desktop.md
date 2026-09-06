# Lokální společná akceptace AKB a STRATOS v Docker Desktopu

Stav 2026-09-06. Trvalý izolovaný Docker projekt `akb-stratos-test` sestavuje
aktuální pracovní adresáře AKB a STRATOS jejich existujícími Dockerfiles.
Obsahuje 21 služeb, skutečné databáze, S3, vyhledávání, antivirus a OIDC.
Nejde o produkční nasazení ani o důkaz dokončeného příjmu dokumentů.
Aktuální výsledek: [ověření předání STRATOS](../qa/stratos-ui-051-acceptance-2026-09-06.md).
Aktivní STRATOS build používá export commitu 2e15bba7 v
`/private/tmp/akb-stratos-candidate-2e15bba7`; při regeneraci nynější sestavy
použijte explicitně `prepare --stratos-root /private/tmp/akb-stratos-candidate-2e15bba7`.
Výchozí `prepare` by přepnul build context zpět na sousední checkout.
AKB weby nyní dostávají veřejné adresy při Docker buildu a port 3221 používá
`AKL_WEB_PROFILE=chat`. Oddělení cookies a původní cesta přepínání nyní prošly. Globální odhlášení
bylo změřeno při běžných limitech; nejde o okamžitý back-channel logout.

## Adresy a přihlášení

| Aplikace | Lokální adresa |
| --- | --- |
| STRATOS / Access Center / Budget | http://localhost:3240 |
| AKB | http://localhost:3220/akb |
| Chat | http://localhost:3221 |
| ProjectFlow | http://localhost:3231 |
| ArchFlow | http://localhost:3232 |
| STRATOS API | http://localhost:14001 |
| ProjectFlow API | http://localhost:14010 |
| MinIO konzole | http://localhost:19041 |
| Testovací identita | https://login.akb.localhost:18081 |

Pro přihlášení otevřete oddělený profil Chrome:

```bash
python3 scripts/open_local_acceptance_browser.py
```

Použijte účet `operator` a heslo ze soukromého souboru
`data/local-acceptance/access.md`. Soubor má práva 0600 a není ve verzování.
Hesla ani generovanou konfiguraci nekopírujte do sdílené dokumentace.
Správce začíná v Access Center. Pro testovací osoby přidělujte aplikační profily
a datové rozsahy přes **Aplikační přístupy** v tomto centru. Bootstrap správce
nemá automaticky práva k dokumentům nebo Chatu: bez nich AKB i Chat otevřou
nápovědu. Samotné přihlášení není povolením číst dokumenty.

Identity jsou dva syntetičtí zaměstnanci a standardní technické identity
bootstrapu. Testovací Keycloak vydává lidským klientům podepsanou kategorii
`identity_audience=employees`; autorizační rozhodnutí stále provádí STRATOS.
Klienti mají scope `basic` (identifikátor uživatele), `profile`, `email`, `roles`
a PKCE. Nejde o ověření identity brokeru v režimu `managed`.

HTTPS identity používá vlastní lokální CA. Aplikace důvěřují přidané CA;
oddělený prohlížeč má výjimku pouze pro konkrétní veřejný klíč tohoto testu.
Systémové úložiště certifikátů ani běžný profil prohlížeče se nemění.
Spouštěč řeší také lokální DNS jméno identity. Běžný prohlížeč tuto konfiguraci
nemusí znát. Certifikát serveru platí 90 dnů; před expirací je nutná jeho řízená
obnova a restart Keycloaku/aplikací i odděleného prohlížeče.

## První sestavení prázdného prostředí

Předpoklady: spuštěný Docker Desktop, existující Python prostředí AKB s PyYAML,
sousední checkout STRATOS a dostatek místa pro obrazy a indexy. Hostitelský
Ollama na portu 11434 musí obsahovat zvolené modely; automatické stahování je
vypnuté. Ověřen byl `bge-m3` a dostupnost `gemma4:12b-mlx`.

Příkazy spouštějte z kořene AKB:

```bash
.venv/bin/python scripts/local_acceptance.py prepare
COMPOSE_PARALLEL_LIMIT=1 .venv/bin/python scripts/local_acceptance.py compose build
.venv/bin/python scripts/local_acceptance.py compose up -d postgres stratos-postgres keycloak minio qdrant opensearch clamav
.venv/bin/python scripts/local_acceptance.py compose ps
# Počkejte na zdravou infrastrukturu, zejména Keycloak a první aktualizaci ClamAV.
.venv/bin/python scripts/local_acceptance.py initialize
.venv/bin/python scripts/local_acceptance.py compose up -d
.venv/bin/python scripts/local_acceptance_smoke.py
```

Jiný checkout STRATOS lze zadat pomocí `prepare --stratos-root /absolutni/cesta`.
`prepare` nečte projektové `.env`, zachovává již vygenerované klíče a zapisuje
konfiguraci pod ignorované `data/local-acceptance`. Compose používá explicitní
prázdný env soubor a vlastní pojmenované volumes. Nepouštějte příkazy s jiným
názvem projektu. Port 3240 byl vybrán kvůli souběžnému jinému testu na 3230.

`initialize` je postup pro nově vytvořené testovací databáze: AKB Alembic,
lokální schema/bootstrap/hardening STRATOS, migrace ProjectFlow a S3 bucket.
Není náhradou produkčních migrací. Nad již používanou databází jej neopakujte
automaticky při každém sestavení; nové migrace nejprve posuďte.
Import Keycloaku proběhne při vytvoření realm. Změna generovaného `realm.json`
sama nemění již existující realm; klienty pak aktualizujte přes administraci
tohoto testovacího Keycloaku. Nepoužívejte mazání volumes jako aktualizaci.

## Opakovaný test změn

```bash
.venv/bin/python scripts/local_acceptance.py prepare
COMPOSE_PARALLEL_LIMIT=1 .venv/bin/python scripts/local_acceptance.py compose build web chat-web registry-api
.venv/bin/python scripts/local_acceptance.py compose up -d --no-deps web chat-web registry-api
.venv/bin/python scripts/local_acceptance_smoke.py
node scripts/local_acceptance_browser_smoke.mjs
```

Vyberte skutečně dotčené služby; uvedená trojice je příklad. Změny veřejných
adres Next.js vyžadují nový build. Test prohlížeče používá Playwright z
`apps/web`; Chromium instalujte podle lokálního vývojového postupu. Při tomto
ověření byl použit `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/akb-intake-playwright`.
Test prochází jedno zadání hesla, navazující relace STRATOS, ProjectFlow,
ArchFlow, AKB a Chatu i návrat do STRATOS. Stav plné akceptace přepínače a
konektorů rozlišuje [společná matice](../qa/stratos-suite-acceptance-2026-09-05.md).
Nevytváří dokumenty a nemění oprávnění. Obrázky ukládá
do soukromého testovacího adresáře; tokeny ani obsahy relací nevypisuje.

Současný `local_acceptance_smoke.py` záměrně očekává nepřipravený příjem:
STRATOS 503 `DOCUMENT_ADMISSION_CATALOG_NOT_READY`, AKB 503
`document_profile_admission_unavailable`. Očekává také odmítnutí neplatného
požadavku (400), anonymního požadavku (401) a detekci standardního EICAR testu
skutečným ClamAV. Po implementaci adaptéru musí přibýt pozitivní akceptace
příjmu a odpovídající očekávání; pouhé přepsání 503 na 200 není důkaz.

Zastavení a pokračování zachovává testovací data:

```bash
.venv/bin/python scripts/local_acceptance.py compose stop
.venv/bin/python scripts/local_acceptance.py compose start
```

## Co musí projít před produkcí

Společný průchod soubor → kontrola obsahu → atomická registrace profilu/TLP →
zpracování → index → Chat → přesná citace; chybějící TLP/gestor, odvolaný
přístup, různé publikum včetně TLP:RED, opakování po ztrátě odpovědi a nová
verze. Zvlášť ověřit nativní příjem, Budget, další aplikace a veřejné kolekce.
Dosavadní brány nesmějí být obejity konfiguračním přepínačem.

Lokální build běží na ARM64; ClamAV 1.4 zde používá AMD64 emulaci. Ollama běží
na hostiteli, Docling je vypnutý a weby používají loopback HTTP. Výsledky
neprokazují produkční výkon ani produkční HTTPS proxy. S3 automatické mazání
zůstává nedostupné kvůli neúčinnému IfMatch v ověřeném MinIO.
Pro release platí [samostatný release proces](../maintenance/release-process.md):
aktuální hlavní větev, přesný kandidát, cílové obrazy, CI/bezpečnostní kontroly
a teprve potom propagace stejné ověřené verze do produkce.

## Source intake checkpoint 2026-09-06

AKB implements ProjectFlow/ArchFlow source intake; [the STRATOS handoff](../integration/STRATOS_SOURCE_DOCUMENT_INTAKE_V1.md) supplies exact connector and authority contracts. Central source authority, new source identities/writer fixtures and joint positive document/Chat acceptance remain pending. `AKL_STRATOS_SOURCE_INTAKE_AUTHORITY_URL` stays empty until the delivered authority is ready. Budget intake remains disabled.

Use `.venv/bin/python scripts/local_acceptance.py build web chat-web registry-api` to build affected images sequentially. The observed Docker VM has 8 GB RAM; parallel production builds alongside the running suite exhausted memory and killed the ClamAV daemon. This local build action reduces peak memory without skipping any image. Do not weaken scan enforcement. After a build, run the real ClamAV clean/EICAR smoke; container state alone is insufficient.

The local generator now assigns `service_ingestion` and the `roles` client scope to the Budget service account. The existing local Budget account was repaired through Keycloak administration without credential rotation or granting generic Registry writes. ClamAV retains its signature volume; its healthcheck now reports sustained failure after three probes instead of fifteen, while preserving the startup grace period.

Read-only bridge boundary smoke: `.venv/bin/python scripts/local_acceptance_source_intake_smoke.py`. This proves anonymous rejection and that the real Budget service cannot impersonate a new source; it explicitly does not prove positive ProjectFlow/ArchFlow ingestion.
