# Deployment Plan: docker.home.cz

Tento plán popisuje první produkční nasazení AKL / AI KnowledgeBase jako součásti STRATOS aplikací na `docker.home.cz`. Produkční databáze se zakládá prázdná; migrace historických dat není součástí nasazení.

## Cílový Stav

- AKL běží z větve `main` stažené z GitHubu do `/srv/akl`.
- PostgreSQL je jediná produkční relační databáze. SQLite se v produkci nepoužívá.
- Dokumentové binární zdroje jsou oddělené od databáze a ukládají se do dedikovaného AKL prostoru nad SeaweedFS.
- Keycloak používá STRATOS realm a STRATOS login theme. AKL je klient v tomto realm.
- STRATOS aplikace nevolají AKL z browseru přímo. Volají serverový STRATOS adapter podle `docs/integration/STRATOS_EXTERNAL_DOCUMENTS_API.md`.
- Build webu používá `@stratos/ui` přes GitHub Packages a read-only `read:packages` token uložený jen jako serverový secret.

## 0. Bezpečnostní Předpoklady

1. Rotovat každý GitHub token, který byl někdy vložený do chatu, logu nebo shell historie.
2. Vytvořit nový read-only token pouze pro GitHub Packages:
   - scope: `read:packages`,
   - bez zápisu do repozitářů,
   - uložit mimo Git, například `/srv/akl/secrets/npmrc`.
3. Pro build nepoužívat `.npmrc` v repozitáři. Použít Docker BuildKit secret:

```bash
docker compose build --secret id=npmrc,src=/srv/akl/secrets/npmrc web
```

## 1. Serverová Struktura

Na `docker.home.cz` připravit:

```text
/srv/akl/
  repo/                  # checkout AI-KnowledgeBase z main
  env/
    akl.prod.env          # produkční env, bez commitu
  secrets/
    npmrc                 # GitHub Packages read-only token
    keycloak-admin.env    # pouze lokální admin parametry pro bootstrap
  data/
    qdrant/
    logs/
  backups/
```

Checkout:

```bash
mkdir -p /srv/akl
git clone https://github.com/voldzi/AI-KnowledgeBase.git /srv/akl/repo
cd /srv/akl/repo
git checkout main
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
  - `akl_reviewer`
  - `akl_reader`
  - `akl_auditor`
  - `akl_stratos_service`
- AKL zároveň v tokenu zachovává kanonické role `admin`, `document_manager`, `reader`, `auditor` a servisní role bez prefixu, protože aktuální Registry API autorizuje přes tento kontrakt.
- `akl-web` a `stratos-akl-adapter` mají audience mapper na `akl-api`; Registry API v produkci validuje `AKL_OIDC_AUDIENCE=akl-api`.

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
  - /srv/akl/repo/infra/keycloak/themes/stratos:/opt/keycloak/themes/stratos:ro
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

## 6. Reverse Proxy A DNS

Navržené endpointy:

- AKL web: `https://akl.zeleznalady.cz`
- Registry API interně: `http://registry-api:8080`
- RAG API interně: `http://rag-retrieval-service:8080`
- Keycloak issuer: `https://login.zeleznalady.cz/realms/stratos`

Veřejně vystavit jen web a případné bezpečně chráněné API endpointy pro STRATOS adapter. Interní service API ponechat v Docker síti.

## 7. Nasazovací Postup

1. Připravit `/srv/akl/repo` z `main`.
2. Připravit `/srv/akl/env/akl.prod.env`.
3. Připravit `/srv/akl/secrets/npmrc`.
4. Vytvořit Keycloak STRATOS realm a theme.
5. Vytvořit prázdné PostgreSQL databáze.
6. Připravit SeaweedFS prostor `akl-documents`.
7. Spustit preflight:

```bash
cd /srv/akl/repo
AKL_PROD_ENV_FILE=/srv/akl/env/akl.prod.env \
AKL_NPMRC_SECRET_FILE=/srv/akl/secrets/npmrc \
./scripts/docker_home_preflight.sh
```

8. Sestavit image:

```bash
cd /srv/akl/repo
DOCKER_BUILDKIT=1 docker compose \
  --env-file /srv/akl/env/akl.prod.env \
  -f infra/docker-compose/docker-compose.docker-home.yml \
  build --secret id=npmrc,src=/srv/akl/secrets/npmrc
```

9. Spustit DB migrace.
10. Spustit služby:

```bash
docker compose \
  --env-file /srv/akl/env/akl.prod.env \
  -f infra/docker-compose/docker-compose.docker-home.yml \
  up -d
```

11. Připojit reverse proxy.

## 8. Smoke Testy Po Nasazení

Minimální smoke:

```bash
curl -fsS https://akl.zeleznalady.cz/api/health
curl -fsS https://akl.zeleznalady.cz/api/ready
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

Obnova se provádí z prázdného checkoutu `main`, obnovy DB/object storage/Qdrant a importu Keycloak realm.

## 10. Blokery Před Produkčním Go-Live

- Importovat připravený `infra/keycloak/realm-stratos.json` a namountovat `infra/keycloak/themes/stratos`.
- Rozhodnout, zda SeaweedFS bude připojený přes S3 gateway nebo filesystem mount. Pro dlouhodobý provoz preferovat S3 adapter.
- Nasadit přes připravený standalone compose profil `infra/docker-compose/docker-compose.docker-home.yml`.
- Ověřit dostupnost `@stratos/ui` z GitHub Packages pomocí read-only tokenu.
- Doplnit reálné hodnoty OIDC produkční konfigurace do `/srv/akl/env/akl.prod.env` včetně `AKL_WEB_PUBLIC_BASE_URL` a `AKL_WEB_SESSION_SECRET`.
- Připravit monitoring a log retention pro `/srv/akl/data/logs`.
