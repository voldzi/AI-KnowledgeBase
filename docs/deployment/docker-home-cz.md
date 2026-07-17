# Deployment Plan: docker.home.cz

Tento plán popisuje první produkční nasazení AKL / AI KnowledgeBase jako součásti STRATOS aplikací na `docker.home.cz`. Produkční databáze se zakládá prázdná; migrace historických dat není součástí nasazení.

## Cílový Stav

- AKL běží z přesného schváleného SHA chráněné větve `main`, rozbaleného jako
  read-only release v `/srv/akl/releases/<full-sha>`.
- PostgreSQL je jediná produkční relační databáze. SQLite se v produkci nepoužívá.
- Dokumentové binární zdroje jsou oddělené od databáze a ukládají se do dedikovaného AKL prostoru nad SeaweedFS.
- Keycloak používá STRATOS realm a STRATOS login theme. AKB je klient v tomto realm.
- STRATOS aplikace nevolají AKL z browseru přímo. Volají serverový STRATOS adapter podle `docs/integration/STRATOS_EXTERNAL_DOCUMENTS_API.md`.
- Build webu používá `@voldzi/stratos-ui` z veřejného npm registry. Pro tento
  balíček se nepřidává scoped `.npmrc` na GitHub Packages.

## 0. Bezpečnostní Předpoklady

1. Rotovat každý GitHub token, který byl někdy vložený do chatu, logu nebo shell historie.
2. Pro build nepoužívat `.npmrc` v repozitáři. Pokud produkční prostředí
   používá GitHub Packages kvůli jiným balíčkům, musí být tento token uložený
   mimo Git a nesmí přesměrovat `@voldzi/stratos-ui` mimo veřejný npm tarball v
   `apps/web/pnpm-lock.yaml`.
3. Web build používá `pnpm install --frozen-lockfile` nad veřejným npm registry. `@voldzi/stratos-ui` nesmí být přesměrovaný scoped `.npmrc` souborem na GitHub Packages.

## 1. Serverová Struktura

Na `docker.home.cz` připravit:

```text
/srv/akl/
  git/
    AI-KnowledgeBase.git/ # bare mirror, bez pracovního stromu
  releases/
    <full-sha>/           # ověřený read-only Git strom
  current -> releases/<full-sha>
  env/
    akl.prod.env          # produkční env, bez commitu
  secrets/
    keycloak-admin.env    # pouze lokální admin parametry pro bootstrap
  data/
    qdrant/
    logs/
  backups/                # Registry custom dump + checksum + inventory
  deployments/            # nesekretní záznamy pokusů
  state/
    applied-runtime.env   # poslední potenciálně aplikované SHA
    burned-shas/<full-sha> # trvalý zákaz opakování SHA po build boundary
  repo/                   # volitelný legacy/maintenance checkout, ne deploy source
```

Volitelný observability stack používá stejný immutable release a env soubor. Hodnota
`GRAFANA_ADMIN_USER` a `GRAFANA_ADMIN_PASSWORD` musí být nastavené v
`/srv/akl/env/akl.prod.env`, ne v Gitu. Tento účet je jen break-glass přístup.
Cílové přihlašování Grafany používá STRATOS Keycloak realm přes klienta
`akb-grafana`; role `stratos_admin` se mapuje na Grafana `GrafanaAdmin`.

Produkční hodnoty patří mimo Git do `/srv/akl/env/akl.prod.env` s oprávněním
`0600`. Release workflow vždy předává Docker Compose explicitní project,
`--env-file` a compose soubor z cílového release. Během deploye se v
`/srv/akl/repo` nesmí spustit `git pull`, `git checkout` ani `git switch` a z
tohoto pracovního stromu se nesmí buildovat. Bare mirror spravuje workflow
samostatně.
Produkční env se před deployem nesourcuje. Pokud okolní shell exportuje
libovolný stejnojmenný klíč jako `/srv/akl/env/akl.prod.env`, workflow skončí
ještě před lockem, DB gate, buildem a stopem writeru; tím se eliminuje Compose
precedence ambient proměnných nad `--env-file`. Stejně fail-closed skončí při
libovolné ambient proměnné interpolované přesným cílovým Compose souborem, i
když tento klíč v env souboru není. Kontrola platí také pro přípravu release a
první target bootstrap. Hodnoty v env souboru nesmí obsahovat `$` interpolaci.
Všechny release entry skripty před čtením konfigurace vypnou xtrace. Deploy po
validaci vytvoří jediný linked single-link snapshot s módem `0600` v privátním
`0700` adresáři pod `/srv/akl/env` a všechny Compose, DB, backup a verify kroky
váže na jeho root/directory/file device/inode/size/SHA-256. Atomická výměna
persistentního env uprostřed pokusu proto nezmění cíl migrace. Běžný exit snapshot
ověří, odlinkuje a fsyncne; kopie po SIGKILL zablokuje další pokus do provedení
přesně omezeného cleanup postupu z hlavního immutable-release runbooku.
Git běží bez replacement objects a mirror nesmí obsahovat `refs/replace/*`;
Docker musí používat lokální `default` context na
`unix:///var/run/docker.sock` bez ambient `DOCKER_HOST`/TLS přesměrování.

Úplný one-time bootstrap a běžný postup je v
`docs/OPERATIONS/immutable-docker-home-release.md`.

Volitelný OpenTelemetry/observability override:

```bash
docker compose \
  --project-name akl \
  --env-file /srv/akl/env/akl.prod.env \
  -f /srv/akl/current/infra/docker-compose/docker-compose.docker-home.yml \
  -f /srv/akl/current/infra/docker-compose/docker-compose.docker-home-observability.yml \
  config

docker compose \
  --project-name akl \
  --env-file /srv/akl/env/akl.prod.env \
  -f /srv/akl/current/infra/docker-compose/docker-compose.docker-home.yml \
  -f /srv/akl/current/infra/docker-compose/docker-compose.docker-home-observability.yml \
  up -d tempo loki otel-collector prometheus grafana
```

Tento override přidá `otel-collector`, `tempo`, `prometheus`, `grafana` a
`loki` pouze do Docker management sítí. OTLP collector se nevystavuje veřejně.
Grafana je dostupná přes AKB Caddy trasu `/akb/grafana/`, pokud je override
spuštěný. Nepřesměrovávat veřejné STRATOS aplikace přímo na Prometheus, Tempo
nebo Loki.

Před zapnutím Grafana OIDC vytvořit nebo aktualizovat Keycloak klienta:

```bash
KEYCLOAK_USE_BOOTSTRAP_ADMIN_SERVICE=true \
/srv/akl/current/scripts/ensure_grafana_keycloak_client.sh
docker compose \
  --project-name akl \
  --env-file /srv/akl/env/akl.prod.env \
  -f /srv/akl/current/infra/docker-compose/docker-compose.docker-home.yml \
  -f /srv/akl/current/infra/docker-compose/docker-compose.docker-home-observability.yml \
  up -d grafana
```

## 2. PostgreSQL

Použít PostgreSQL, ne SQLite.

Produkční přístup k PostgreSQL jde přes HAProxy:

```text
haproxy.home.cz:5000
```

Ověřeno z vývojového prostředí:

- `haproxy.home.cz:5000` je otevřený TCP endpoint,
- `patroni1.home.cz:5432`, `patroni2.home.cz:5432` a `patroni3.home.cz:5432` jsou dostupné PostgreSQL nody,
- aplikační connection stringy mají používat HAProxy endpoint, ne přímé Patroni nody.

Minimální databáze:

- `akl_registry`
- `akl_ingestion`
- `akl_rag`
- `akl_evaluation`
- `akl_governance`

Produkční connection string šablona:

```env
AKL_REGISTRY_DATABASE_URL=postgresql+psycopg://<user>:<password>@haproxy.home.cz:5000/akl_registry
AKL_RELEASE_EXPECTED_REGISTRY_DB_HOST=haproxy.home.cz
AKL_RELEASE_EXPECTED_REGISTRY_DB_PORT=5000
AKL_RELEASE_EXPECTED_REGISTRY_DB_NAME=akl_registry
AKL_RELEASE_EXPECTED_REGISTRY_DB_USER=<user>
```

Stejný host a port použít i pro další AKL databáze, vždy s konkrétním názvem DB. Pokud bude HAProxy poskytovat separátní read-only port, AKL ho v první produkční verzi nepoužívá pro zápisové služby.

První nasazení:

1. Vytvořit prázdné DB a role.
2. Nastavit produkční connection stringy v `/srv/akl/env/akl.prod.env`.
3. Spustit Alembic migrace Registry API proti prázdné DB.
4. Nespouštět žádnou datovou migraci; seed jen systémové konfigurace, pokud ji aplikace vyžaduje.

## 3. SeaweedFS Pro Dokumenty

SeaweedFS lze použít, ale AKL potřebuje jasný storage kontrakt.

Doporučený cílový model:

- bucket nebo dedikovaný prefix: `akl-documents`
- prefixy:
  - `sources/` pro originální soubory,
  - `previews/` pro renderované náhledy,
  - `ingestion/` pro mezivýstupy zpracování,
  - `exports/` pro exporty a auditní balíčky.

Preferovaná produkční integrace:

1. SeaweedFS S3 gateway vystavit pouze v interní Docker síti.
2. Doplnit v AKL storage adapter pro S3 kompatibilní API.
3. Konfigurace:

```env
AKL_OBJECT_STORAGE_PROVIDER=seaweedfs-s3
AKL_OBJECT_STORAGE_BUCKET=akl-documents
AKL_OBJECT_STORAGE_ENDPOINT=http://seaweedfs-s3:8333
AKL_OBJECT_STORAGE_REGION=local
```

Dočasný kompatibilní model, pokud je SeaweedFS připojený jako filesystem:

```env
AKL_WEB_OBJECT_STORAGE_ROOT=/srv/seaweedfs/akl
```

Tento dočasný model zachová současné lokální mapování `s3://akl-documents/...` na souborový root, ale pro produkci je čistší S3 adapter.

## 4. Keycloak: STRATOS Realm A Theme

Inspirace COP:

- COP theme používá `parent=keycloak`, `locales=cs,en` a vlastní CSS v `infra/keycloak/themes/cop`.
- AKL má dnes export `infra/keycloak/realm-akl.json`; pro STRATOS cílový stav má být společný realm pro aplikace STRATOS.

Cílový realm:

- realm: `stratos`
- display name: `STRATOS`
- login theme: `stratos`
- locales: `cs`, `en`
- clients:
  - `akl-web`, `budget-web`, `projectflow-web`, `archflow-web`, `stratos-shell` public OIDC clients,
  - `akl-api`, `budget-api`, `projectflow-api`, `archflow-api` confidential service clients,
  - `stratos-akl-adapter` confidential service client pro STRATOS adapter.
- sdílené realm role:
  - `stratos_admin`
  - `stratos_user`
  - `stratos_auditor`
- realm role pro AKL:
  - `akl_admin`
  - `akl_document_manager`
  - `akl_document_owner`
  - `akl_document_gestor`
  - `akl_reviewer`
  - `akl_reader`
  - `akl_auditor`
  - `akl_stratos_service`
- AKL zároveň v tokenu zachovává kanonické role `admin`, `document_manager`,
  `document_owner`, `document_gestor`, `reader`, `auditor` a servisní role bez
  prefixu, protože aktuální Registry API autorizuje přes tento kontrakt.
- `akl-web` a `stratos-akl-adapter` mají audience mapper na `akl-api`; Registry API v produkci validuje `AKL_OIDC_AUDIENCE=akl-api`.
- Pokud AKB/Keycloak provozní skript zapisuje service client hodnoty pro STRATOS
  aplikace, na `docker.home.cz` musí cílit na `/srv/STRATOS/deploy/.env`.
  STRATOS compose čte `deploy/.env`, ne root `.env`; zápis jinam se nepropíše
  do běžícího `stratos-api` kontejneru.
- Source-open smoke pro Budget & Contract se spouští přes
  `scripts/stratos_source_open_smoke.py`. V Docker síti používejte
  `BUDGET_AKB_WEB_BASE_URL=http://akl-web-1:3000/akb`; metadata a registrace
  dál používají `AKL_REGISTRY_BASE_URL=http://registry-api:8000/api/v1`.
  Skript umí číst STRATOS runtime proměnné `STRATOS_AKB_OIDC_TOKEN_URL`,
  `STRATOS_AKB_OIDC_CLIENT_ID`, `STRATOS_AKB_OIDC_CLIENT_SECRET`,
  `STRATOS_AKB_OIDC_AUDIENCE` a `STRATOS_AKB_OIDC_SCOPE` z
  `/srv/STRATOS/deploy/.env`. Pro smoke používejte parametry `--env-file`;
  nesourcujte STRATOS `.env` přímo v shellu, protože některé hodnoty mohou
  obsahovat mezery.

Theme struktura v repu:

```text
infra/keycloak/themes/stratos/
  login/
    theme.properties
    messages/messages_cs.properties
    messages/messages_en.properties
    resources/css/stratos-login.css
    resources/img/stratos-icon.svg
```

Mount na serveru:

```yaml
volumes:
  - /srv/akl/current/infra/keycloak/themes/stratos:/opt/keycloak/themes/stratos:ro
```

Bootstrap postup:

1. Připravit `realm-stratos.json` v `infra/keycloak`.
2. Importovat realm do Keycloaku.
3. Nastavit redirect URI pro produkční AKL doménu a interní testovací URL na `docker.home.cz`.
4. Ověřit login přes AKL frontend.
5. Ověřit browser login pro `akl-web`.
6. Ověřit service token pro `stratos-akl-adapter`.

## 5. Docker Compose Profil

Vytvořit produkční compose override pro `docker.home.cz`, například:

```text
infra/docker-compose/docker-compose.docker-home.yml
```

Služby:

- `web`
- `registry-api`
- `ingestion-service`
- `rag-retrieval-service`
- `llm-gateway-service`
- `evaluation-service`
- `governance-service`
- `qdrant`

Externí nebo sdílené služby:

- PostgreSQL
- Keycloak
- SeaweedFS
- reverse proxy
- případně Ollama nebo jiný LLM provider

Základní env:

```env
AKL_ENV=production
AKL_API_CLIENT_MODE=production
AKL_WEB_AUTH_MODE=oidc
AKL_RAG_REQUIRE_CITATIONS=true
AKL_RAG_AUTHZ_MODE=registry
AKL_RAG_RETRIEVER_MODE=qdrant
AKL_INGESTION_INDEXER_MODE=qdrant
AKL_QDRANT_COLLECTION=akl_document_chunks
```

Pokud Ollama běží mimo AKB compose stack, nastavte explicitní kandidátní
endpointy. AKB neprohledává lokální síť; zkusí pouze uvedené URL v pořadí:

```env
AKL_OLLAMA_BASE_URL=http://192.168.200.3:11434
AKL_OLLAMA_BASE_URLS=http://192.168.200.3:11434,http://192.168.200.2:11434,http://192.168.1.176:11434
AKL_OLLAMA_ENDPOINT_TIMEOUT_SECONDS=3
AKL_INGESTION_EMBEDDING_CONCURRENCY=1
```

Stanice `192.168.200.3`, `192.168.200.2` a `192.168.1.176` musí mít Ollama
dostupnou na síťovém rozhraní dosažitelném z `docker.home.cz`, nejen na
`127.0.0.1`. Nedostupný kandidát se při výběru endpointu přeskočí po
`AKL_OLLAMA_ENDPOINT_TIMEOUT_SECONDS`.

Povinné hodnoty pro `docker-home` profil patří do `/srv/akl/env/akl.prod.env`:

- `AKL_WEB_PUBLIC_BASE_URL=https://stratos.zeleznalady.cz/akb`
- `AKL_WEB_BASE_PATH=/akb`
- `AKL_WEB_SESSION_SECRET=<long random secret>`
- `AKL_WEB_UPLOAD_SIGNING_SECRET=<long random secret>`
- `AKL_EVAL_SERVICE_TOKEN=<long random service token>`
- `AKL_GOVERNANCE_SERVICE_TOKEN=<long random service token>`

Evaluation Service runs with `AKL_EVAL_AUTH_MODE=oidc` for the web Quality Lab,
validates the caller token against the shared AKB issuer/audience/JWKS settings,
and forwards that identity to RAG/Registry. The legacy evaluation service token
remains only for explicit bearer-mode automation. Persist and back up both
`evaluation-datasets` and `evaluation-reports` volumes.

Compose profil pro `docker.home.cz` má pro web build i runtime bezpečný fallback
`/akb`, aby se Next.js image při chybějící env hodnotě nepostavil pro root `/`.
Produkční env má ale explicitní `AKL_WEB_BASE_PATH=/akb` dál obsahovat kvůli
kontrole a čitelnosti provozní konfigurace.

Vzor je v `infra/docker-compose/docker-home.env.example`. Ten je šablona, ne produkční soubor.

Bezpečné vygenerování tokenů:

```bash
openssl rand -hex 32
```

Pro `AKL_WEB_SESSION_SECRET` je vhodné použít delší base64 hodnotu:

```bash
openssl rand -base64 48
```

## 6. Reverse Proxy A DNS

Navržené endpointy:

- STRATOS public shell: `https://stratos.zeleznalady.cz`
- AKL web target: `https://stratos.zeleznalady.cz/akb`
- AKL standalone alias during migration: `https://akl.zeleznalady.cz`
- Registry API interně: `http://registry-api:8080`
- RAG API interně: `http://rag-retrieval-service:8080`
- Keycloak issuer: `https://login.zeleznalady.cz/realms/stratos`

Veřejně vystavit jen STRATOS shell a aplikační path prefixy přes DMZ reverse proxy na `dmz.home.cz`. AKL běží pod `/akb`; interní service API ponechat v Docker síti. Souhrnný route kontrakt pro všechny STRATOS aplikace je v `docs/deployment/stratos-public-routing-and-docker-home.md`.

Produkční reverse proxy i `platform-status` musí pro web používat stabilní
Compose service DNS `web:3000`, nikdy jméno konkrétního kontejneru, například
`akl-web-1`. V `/srv/akl/env/akl.prod.env` proto držte explicitně
`WEB_UPSTREAM=web:3000` a nastavte také webovou část
`PLATFORM_READY_CHECKS` na `http://web:3000/akb/health`. Kontejnerové jméno se
při bezpečné rekreaci služby může změnit nebo dočasně zmizet; service DNS je
stabilní kontrakt Docker Compose sítě.

## 7. Nasazovací Postup

1. Vybrat schválený plný 40znakový Git SHA z chráněného `main`; větev ani
   pohyblivý tag nejsou release identita.
2. Připravit persistentní `/srv/akl/env/akl.prod.env` s mode `0600`, včetně
   `AKL_RELEASE_GIT_URL`, `AKL_RELEASE_TRUSTED_REF` a
   `AKL_RELEASE_COMPOSE_PROJECT`. Nastavit také
   `AKL_RELEASE_POSTGRES_TOOL_IMAGE` na již lokálně dostupný přesný
   `name@sha256:<digest>` nebo `sha256:<image-id>`; pohyblivý tag je zakázán a
   hostitelské balíčky `psql`/`pg_dump`/`pg_restore` nejsou potřeba.
3. Vytvořit Keycloak STRATOS realm a theme.
4. Vytvořit prázdné PostgreSQL databáze.
5. Připravit SeaweedFS prostor `akl-documents`.
6. Ověřit aktuální release, služby, health/readiness, HAProxy dostupnost,
   volné místo a poslední checksum/TOC-validovaný custom dump pouze read-only
   kontrolami. Za ověřený restore point se považuje až artefakt prověřený
   isolated restore rehearsal podle sekce `Required isolated Registry restore
   rehearsal` v `docs/OPERATIONS/immutable-docker-home-release.md`.
7. Spustit exact-SHA release z posledního ověřeného release:

```bash
RELEASE_SHA=0123456789abcdef0123456789abcdef01234567
/srv/akl/current/scripts/deploy_docker_home_release.sh --sha "$RELEASE_SHA"
```

Při prvním přechodu, kdy `/srv/akl/current` ještě neexistuje, se orchestrátor
nespouští z mutable `/srv/akl/repo`. Již připravený, schválený a read-only
immutable release slouží pouze k přípravě cílového SHA; vlastní bootstrap se
potom spustí z přesného cílového release:

```bash
BOOTSTRAP_SHA=0123456789abcdef0123456789abcdef01234567
RELEASE_SHA=89abcdef0123456789abcdef0123456789abcdef
BOOTSTRAP_RELEASE="/srv/akl/releases/${BOOTSTRAP_SHA}"
test ! -e /srv/akl/current && test ! -L /srv/akl/current
TARGET_RELEASE="$("${BOOTSTRAP_RELEASE}/scripts/prepare_docker_home_release.sh" "$RELEASE_SHA")"
test "$TARGET_RELEASE" = "/srv/akl/releases/${RELEASE_SHA}"
"${TARGET_RELEASE}/scripts/bootstrap_docker_home_target.sh" --sha "$RELEASE_SHA"
```

Chybějící běžná cesta i symlink `current` jsou invariant pouze tohoto prvního
přechodu; broken nebo již existující link se za nový host nepovažuje.
Target bootstrap odmítne jinou cestu i existující `current`, znovu ověří
`origin/main`, strict provenance metadata, ambient Compose izolaci a celý Git
strom cílového release a teprve potom spustí cílový orchestrátor. Workflow:

Pokud `/srv/akl/current` již existuje, ale jeho deploy skript ještě neobsahuje
řádek `AKL_IMMUTABLE_ORCHESTRATOR_CONTRACT=2`, nesmí se první hardened release
spustit starým skriptem z `current`. Přesný cílový SHA se připraví pomocí
disposable exact-SHA checkoutu a potom se spustí výhradně target-side přechod:

```bash
TARGET_SHA=89abcdef0123456789abcdef0123456789abcdef
TARGET_RELEASE="/srv/akl/releases/${TARGET_SHA}"
test "$(awk -F= '$1 == "state" {print $2}' /srv/akl/state/applied-runtime.env)" = verified
test "$(awk -F= '$1 == "phase" {print $2}' /srv/akl/state/applied-runtime.env)" = verified
"${TARGET_RELEASE}/scripts/bootstrap_docker_home_target.sh" \
  --sha "$TARGET_SHA" \
  --transition-existing-current
```

Samotné vytvoření a ověření `TARGET_RELEASE`, povinný owner/no-follow trust
model, kontrola ancestry a self-contained mirroru bez alternates/grafts/
symlinked refs či objects, one-time omezení a recovery větve jsou
normativně popsány v sekci `One-Time Upgrade From An Existing Immutable
current` v `docs/OPERATIONS/immutable-docker-home-release.md`. Transition mód
nevolá `prepare` ani deploy ze starého `current`; target orchestrátor po
privátním env snapshotu získá standardní lock a všechny state-sensitive guardy
zopakuje před buildem, stopem writeru a migrací. Po `verified` crashi lze stejný
target pouze reconciliovat. Po `applying`/`failed` stavu se recovery spouští z
přesného selhaného target release přes descendant forward-fix, nikdy ze starého
`current`.

- ověří SHA vůči bare mirroru a vytvoří read-only
  `/srv/akl/releases/<full-sha>`; celý strom a jeho parent před publikací
  fsyncne,
- při prvním přechodu ani později nepřehlédne Registry predecessor v restart
  gap: enumeruje jej přes `docker ps -a`, zachytí container, image
  ID/reference, Compose labely a původní running/restarting state; dirty `/srv/akl/repo`
  nemění a nikdy jej nepoužije jako build context nebo runtime release,
- pokud je dotčen Registry, před buildem ověří exact lokální PostgreSQL tool
  image, zaznamená jeho image ID i verze klientů a třikrát po sobě ověří
  writable primary i přesnou shodu `current_database()`/`current_user`,
- bezprostředně před buildem trvale vytvoří
  `/srv/akl/state/burned-shas/<full-sha>` a nastaví descendant-only retry;
  existující cílový tag SHA také trvale spálí,
- sestaví jen dotčené `registry-api`, `rag-retrieval-service` a `web`; pokud je
  dotčen sdílený produkční Compose soubor, workflow fail-closed vyžádá
  koordinovaný full-platform release. Po buildu durable zaznamená tag→image ID
  a ověří SHA/project/service labely; stejnou identitu znovu ověří před
  Alembic, před restartem, po recreate a po všech smoke testech těsně před
  verified markerem. Reconciliation načte původní ID ze strict deployment
  recordu pojmenovaného marker deployment ID a nikdy nepovýší aktuální mutable
  tag na nové očekávané evidence. Alembic i `compose up` dotčených služeb
  se spouští přímo s durable `sha256:<image-id>`, ne s tagem. Pokud je
  dotčen Registry, po buildu a zachycení predecessoru znovu třikrát ověří
  writable primary bezprostředně před stop boundary,
- trvale zaznamená, že stop writeru může začít, explicitně vydá Compose `stop`
  i pro již zastavený predecessor, ověří nulový počet běžících Registry writerů
  a zapíše privátní quiescence evidence svázané s deployment lockem a přesným
  predecessor ID; nulový writer znovu ověří před dumpem i migrací
  a přes stejný exact lokální
  PostgreSQL tool image s `--pull never`, host network a minimálními bindy
  poté vytvoří custom dump, SHA-256, `pg_restore --list` a inventory s plnou
  jedinou Alembic revizí, kritickými row counts a identitou/verzemi nástrojů v `/srv/akl/backups`;
  všechny artefakty a adresáře fsyncne před markerem,
- pgpass ukládá pouze do privátního
  `/srv/akl/state/postgres-credentials`; SIGKILL pozůstatek další release
  zablokuje a lze jej odstranit jen přes přesný validovaný cleanup postup z
  hlavního runbooku,
- do inventory zapíše skutečnou backend adresu a port z PostgreSQL, pokud jsou
  dostupné. Jde o HA routing evidence, nikoli privilegovaný cluster ID; aplikační
  účet jej nemusí umět číst,
- po backupu a kontrole jediného Alembic head zopakuje tři writable-primary
  kontroly bezprostředně před markerem a migrací; read-only, recovery, chyba
  spojení, DB URL query/fragment routing override nebo změna image ID jsou
  fail-closed a migrace se nespustí,
- po migraci vyžaduje právě jeden kanonický výstup `alembic current`, který se
  přesně rovná jedinému target head; multi-head stav je fail-closed,
- před migrací nebo startem zapíše atomický forward-only marker
  `/srv/akl/state/applied-runtime.env`,
- vyžaduje shodu plného SHA tagu, image ID, release/Compose labelů a health
  každé dotčené služby a dále readiness a fail-closed public smoke,
- těsně před možným `compose up` trvale zapíše start boundary. Při obsloužené
  chybě před verified markerem ověří u každé dotčené služby přesný Compose
  project/service, non-one-off stav, full-SHA image reference, release labely a
  cílový Compose soubor, poté cílový container force-remove a prokáže, že žádný
  odpovídající container nezůstal. Výsledek karantény zaznamená po službách;
  při neprokazatelné identitě, chybě odstranění nebo chybě durable evidence
  ponechá deployment lock pro řízené incident recovery,
- až poté atomicky a trvale přepne `/srv/akl/current`. Pokud výpadek nastane
  mezi verified markerem a tímto přepnutím, opakování stejného SHA pouze znovu
  ověří runtime a dokončí aktivaci bez rebuildu či migrace. Pokud výpadek
  nastane až po fsync `current`, ale před finálním success recordem, stejné SHA
  bez forward-fix kontextu znovu ověří již aktivní release a zapíše
  `reconciled_verified_success` bez opakování přepnutí.

Při chybě se symlink nepřepne. Marker posledního potenciálně aplikovaného SHA
ale zůstane ve stavu `failed`; obyčejný deploy ani nepříbuzný SHA jej nesmí
obejít. Přesný starý Registry container se automaticky obnoví jen při chybě
před runtime markerem a migrací a jen tehdy, pokud byl před quiesce skutečně
running nebo restarting. Predecessor zachycený jako stopped zůstane stopped. Pokud už byl image
restartován nebo migrace provedena, nepouštět starý image ani Alembic downgrade.
Při běžně zachycené chybě po startu musí deployment record potvrdit karanténu
všech dotčených target služeb. Pokud některé `target_*_quarantine_failed=true`
nebo `deploy_lock_preserved=true`, lock se nesmí smazat bez ověření mrtvého PID,
neexistence release procesu a přesné identity zbývajících target containerů;
container name samotný není důkaz. Starý image se po migraci neobnovuje.
Připravit schválený potomek přesně označeného chybného SHA a použít forward-fix:

Pre-stop gate selže ještě před buildem, takže po odstranění přechodné příčiny
lze zkusit stejné schválené SHA. Jakmile ale build mohl začít, deployment record
obsahuje `target_build_may_have_started=true` a
`retry_requires_descendant_sha=true` a vznikne durable
`state/burned-shas/<full-sha>`. Tento marker je autoritativní i když build selhal
před tagem nebo tag později zmizel; nemaže se a nasazuje se schválený potomek,
i když `migration_started=false`. Pre-quiesce DB gate je po buildu: při jeho
selhání se writer ještě nezastaví, ale spálené SHA už vyžaduje potomka.

```bash
/srv/akl/current/scripts/rollback_docker_home_release.sh \
  --failed-sha 0123456789abcdef0123456789abcdef01234567 \
  --forward-fix-sha 89abcdef0123456789abcdef0123456789abcdef
```

Pokud první immutable pokus selže až po zápisu markeru a `/srv/akl/current`
ještě neexistuje, stejný wrapper se spustí z
`/srv/akl/releases/<failed-sha>/scripts/`; dirty checkout se ani pro recovery
nepoužije jako release.

Detailní povinný postup, backup kontrola a recovery jsou v
`docs/OPERATIONS/immutable-docker-home-release.md`.

## 8. Smoke Testy Po Nasazení

Minimální smoke:

```bash
curl -fsS https://stratos.zeleznalady.cz/akb/api/health
curl -fsS https://stratos.zeleznalady.cz/akb/api/ready
```

Funkční smoke:

1. Přihlášení přes STRATOS realm.
2. Otevření registru dokumentů.
3. Upload testovacího dokumentu.
4. Ingestion job dokončený bez chyby.
5. Dokument je dohledatelný v registru.
6. Chat odpoví jen s citacemi.
7. Citace otevře konkrétní viewer dokumentu.
8. STRATOS adapter zavolá `POST /api/v1/external-documents/upsert`.

## 9. Backup A Obnova

Zálohovat:

- PostgreSQL databáze,
- SeaweedFS prostor `akl-documents`,
- Qdrant kolekci `akl_document_chunks`,
- Keycloak realm export `stratos`,
- `/srv/akl/env` bez publikace do GitHubu,
- release commit SHA.

Obnova se provádí z ověřeného immutable release SHA, obnovy DB/object
storage/Qdrant a importu Keycloak realm. Běžný rollback po neúspěšném release je
forward-fix; žádný release skript automatickou obnovu DB neprovádí.

## 10. Blokery Před Produkčním Go-Live

- Importovat připravený `infra/keycloak/realm-stratos.json` a namountovat `infra/keycloak/themes/stratos`.
- Rozhodnout, zda SeaweedFS bude připojený přes S3 gateway nebo filesystem mount. Pro dlouhodobý provoz preferovat S3 adapter.
- Nasadit přes připravený standalone compose profil `infra/docker-compose/docker-compose.docker-home.yml`.
- Ověřit, že `apps/web/pnpm-lock.yaml` ukazuje `@voldzi/stratos-ui` na veřejný npm tarball.
- Doplnit reálné hodnoty OIDC produkční konfigurace do `/srv/akl/env/akl.prod.env` včetně `AKL_WEB_PUBLIC_BASE_URL` a `AKL_WEB_SESSION_SECRET`.
- Připravit monitoring a log retention pro `/srv/akl/data/logs`.
