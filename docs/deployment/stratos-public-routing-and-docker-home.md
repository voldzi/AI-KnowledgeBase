# STRATOS Public Routing And docker.home.cz Deployment

Tento dokument je predavaci kontrakt pro STRATOS aplikace: Budget & Contract, AKB, ProjectFlow a ArchFlow. Popisuje spolecne verejne adresy, Keycloak realm, topbar app switcher a hranici mezi `docker.home.cz` a `dmz.home.cz`.

## Cílový Veřejný Model

Jedna verejna adresa reprezentuje cele portfolio STRATOS:

```text
https://stratos.zeleznalady.cz/
```

Route kontrakt:

```text
https://stratos.zeleznalady.cz/          Budget & Contract / hlavni STRATOS aplikace
https://stratos.zeleznalady.cz/akb       AKB / AI KnowledgeBase
https://stratos.zeleznalady.cz/project   ProjectFlow
https://stratos.zeleznalady.cz/arch      ArchFlow
```

Pozor na preklep: pouzivat `stratos.zeleznalady.cz`, ne `startos.zeleznalady.cz`.

## Odpovědnosti Serverů

`docker.home.cz`:

- provozuje aplikacni kontejnery,
- provozuje AKB stack v `/srv/akl`,
- pouziva PostgreSQL pres `haproxy.home.cz:5000`,
- pouziva sdileny Keycloak realm `stratos`,
- vystavuje interni nebo pilotni aplikační porty, napr. AKB na `3220`.

`dmz.home.cz`:

- publikuje verejnou HTTPS adresu do internetu,
- terminace TLS pro `https://stratos.zeleznalady.cz`,
- hlavni nginx/reverse proxy routing podle cest,
- smeruje jednotlive path prefixy na odpovidajici aplikacni porty na `docker.home.cz`.

DMZ nginx se nastavuje samostatne. Aplikace nemaji predpokladat, ze samy vlastni verejnou domenu.

## DMZ Reverse Proxy Kontrakt

Minimalni routovani:

```text
/          -> Budget & Contract upstream
/akb/      -> AKB upstream, aktualne docker.home.cz:3220
/project/  -> ProjectFlow upstream
/arch/     -> ArchFlow upstream
```

Proxy musi predavat standardni forwarded headers:

```text
X-Forwarded-Proto
X-Forwarded-Host
X-Forwarded-For
X-Real-IP
```

Pro aplikace bez nativni podpory path base je nutne pred nasazenim doplnit podporu `basePath` nebo equivalentni konfiguraci asset prefixu. Browser assety, callbacky a API cesty nesmi odkazovat na root `/`, pokud aplikace bezi pod `/akb`, `/project` nebo `/arch`.

## Keycloak STRATOS Realm

Sdileny issuer:

```text
https://login.zeleznalady.cz/realms/stratos
```

Realm:

```text
stratos
```

Login theme:

```text
stratos
```

Public web clients:

```text
akl-web
budget-web
projectflow-web
archflow-web
stratos-shell
```

Service/API clients:

```text
akl-api
budget-api
projectflow-api
archflow-api
stratos-akl-adapter
```

Redirect URI kontrakt:

```text
akl-web:         https://stratos.zeleznalady.cz/akb/*
budget-web:      https://stratos.zeleznalady.cz/*
projectflow-web: https://stratos.zeleznalady.cz/project/*
archflow-web:    https://stratos.zeleznalady.cz/arch/*
stratos-shell:   https://stratos.zeleznalady.cz/*
```

Pro plynulou migraci jsou v realmu docasne ponechane i starsi samostatne domeny:

```text
https://akl.zeleznalady.cz/*
https://budget.zeleznalady.cz/*
https://contracts.zeleznalady.cz/*
https://projectflow.zeleznalady.cz/*
https://archflow.zeleznalady.cz/*
```

Tyto aliasy nejsou cilovy stav. Po migraci vsech aplikaci pod `stratos.zeleznalady.cz` je lze odstranit.

## Aplikační Env Kontrakt

Kazda aplikace musi mit verejnou base URL odpovidajici sve ceste:

```env
STRATOS_PUBLIC_BASE_URL=https://stratos.zeleznalady.cz
```

AKB:

```env
AKL_WEB_PUBLIC_BASE_URL=https://stratos.zeleznalady.cz/akb
AKL_WEB_OIDC_ISSUER=https://login.zeleznalady.cz/realms/stratos
AKL_WEB_OIDC_CLIENT_ID=akl-web
```

ProjectFlow:

```env
PROJECTFLOW_PUBLIC_BASE_URL=https://stratos.zeleznalady.cz/project
PROJECTFLOW_OIDC_ISSUER=https://login.zeleznalady.cz/realms/stratos
PROJECTFLOW_OIDC_CLIENT_ID=projectflow-web
```

ArchFlow:

```env
ARCHFLOW_PUBLIC_BASE_URL=https://stratos.zeleznalady.cz/arch
ARCHFLOW_OIDC_ISSUER=https://login.zeleznalady.cz/realms/stratos
ARCHFLOW_OIDC_CLIENT_ID=archflow-web
```

Budget & Contract:

```env
BUDGET_PUBLIC_BASE_URL=https://stratos.zeleznalady.cz
BUDGET_OIDC_ISSUER=https://login.zeleznalady.cz/realms/stratos
BUDGET_OIDC_CLIENT_ID=budget-web
```

## Topbar App Switcher

Vsechny aplikace musi v levem hornim app switcheru pouzivat stejne polozky a stejne adresy:

```json
[
  {
    "id": "budget-contract",
    "label": "Budget & Contract",
    "shortLabel": "BC",
    "href": "https://stratos.zeleznalady.cz/"
  },
  {
    "id": "akb",
    "label": "AKB",
    "shortLabel": "AK",
    "href": "https://stratos.zeleznalady.cz/akb"
  },
  {
    "id": "projectflow",
    "label": "ProjectFlow",
    "shortLabel": "PF",
    "href": "https://stratos.zeleznalady.cz/project"
  },
  {
    "id": "archflow",
    "label": "ArchFlow",
    "shortLabel": "AF",
    "href": "https://stratos.zeleznalady.cz/arch"
  }
]
```

Aktivni aplikace oznaci svuj zaznam `active: true`. Ostatni aplikace musi byt klikatelne, ne disabled, pokud uz maji cilovy verejny route kontrakt.

## AKB Stav Na docker.home.cz

Aktualni pilot:

- checkout: `/srv/akl/repo`,
- env: `/srv/akl/env/akl.prod.env`,
- compose: `infra/docker-compose/docker-compose.docker-home.yml`,
- AKB proxy port: `3220`,
- Docker subnets: `10.246.240.0/24` az `10.246.244.0/24`,
- PostgreSQL: `haproxy.home.cz:5000`,
- Ollama pilot: `http://192.168.200.2:11434` pres VPN notebook,
- object storage bridge: `/srv/seaweedfs/akl`.

Health kontroly z `docker.home.cz`:

```bash
curl -fsS http://127.0.0.1:3220/health
curl -fsS http://127.0.0.1:3220/ready
curl -fsS http://127.0.0.1:3220/registry/health
curl -fsS http://127.0.0.1:3220/ingestion/health
curl -fsS http://127.0.0.1:3220/rag/health
curl -fsS http://127.0.0.1:3220/llm-gateway/health
curl -fsS http://127.0.0.1:3220/governance/health
curl -fsS http://127.0.0.1:3220/evaluation/health
```

## Postup Pro Ostatní Aplikace

1. Pridat podporu behu pod vlastnim path prefixem.
2. Nastavit public base URL podle route kontraktu.
3. Nastavit OIDC issuer `https://login.zeleznalady.cz/realms/stratos`.
4. Pouzit spravny Keycloak public client.
5. Pouzit jednotny topbar app switcher seznam.
6. Na `docker.home.cz` vystavit pouze interni/pilotni port.
7. Na `dmz.home.cz` doplnit verejny nginx route.
8. Otestovat login callback a assety pod verejnou cestou.

## Keycloak Aktualizace

Repo obsahuje:

```text
infra/keycloak/realm-stratos.json
infra/keycloak/update-stratos-public-routing.sh
```

`realm-stratos.json` je zdrojovy export realmu. Pro existujici produkcni realm se redirecty aktualizuji bezpecne skriptem:

```bash
cd /srv/akl/repo
./infra/keycloak/update-stratos-public-routing.sh
```

Skript se pta na Keycloak admin heslo a upravuje pouze:

- `redirectUris`,
- `webOrigins`.

Nemaze uzivatele, role, skupiny ani client secrets.
