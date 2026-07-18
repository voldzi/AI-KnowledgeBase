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
- AKB běží z ověřeného read-only `/srv/akl/releases/<full-sha>` a poslední
  plně ověřený release označuje `/srv/akl/current`; produkční env zůstává v
  `/srv/akl/env/akl.prod.env` mimo Git.

`dmz.home.cz`:

- publikuje verejnou HTTPS adresu do internetu,
- terminace TLS pro `https://stratos.zeleznalady.cz`,
- hlavni nginx/reverse proxy routing podle cest,
- smeruje jednotlive path prefixy na odpovidajici aplikacni porty na `docker.home.cz`.

DMZ nginx se nastavuje samostatne. Aplikace nemaji predpokladat, ze samy vlastni verejnou domenu.

## DMZ Reverse Proxy Kontrakt

Minimalni routovani:

```text
/          -> Budget & Contract upstream, docker.home.cz:3230
/akb       -> AKB upstream, docker.home.cz:3220
/akb/      -> AKB upstream, docker.home.cz:3220
/project/  -> ProjectFlow upstream, docker.home.cz:3231
/arch/     -> ArchFlow upstream, docker.home.cz:3232
```

Samostatný chatový klient používá vlastní host route bez path prefixu:

```text
chat.zeleznalady.cz/ -> AKB chat-web, docker.home.cz:3221
```

Tato instance používá stejný AKB Registry/RAG/datový stack jako hlavní AKB
web. Liší se pouze build profilem, OIDC klientem a host-only session secret.
DNS záznam `chat.zeleznalady.cz` musí směřovat na stejný veřejný DMZ endpoint
jako hlavní STRATOS doména. Samostatný TLS server blok předává celý host bez
path prefixu:

```nginx
server {
    listen 443 ssl http2;
    server_name chat.zeleznalady.cz;

    # TLS certifikát a společné bezpečnostní include spravuje DMZ provoz.

    location / {
        proxy_pass http://docker.home.cz:3221;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;
        proxy_read_timeout 300s;
    }
}
```

Před reloadem se vždy provede `nginx -t`; po publikaci musí z DMZ projít
`/api/health`, `/api/ready` a `/manifest.webmanifest`. Management API, například
`/api/documents`, musí na chat hostu vrátit `403
CHAT_PROFILE_ROUTE_FORBIDDEN`.

Proxy musi predavat standardni forwarded headers:

```text
X-Forwarded-Proto
X-Forwarded-Host
X-Forwarded-For
X-Real-IP
```

Pro aplikace bez nativni podpory path base je nutne pred nasazenim doplnit podporu `basePath` nebo equivalentni konfiguraci asset prefixu. Browser assety, callbacky a API cesty nesmi odkazovat na root `/`, pokud aplikace bezi pod `/akb`, `/project` nebo `/arch`.

### Nginx Příkaz Pro dmz.home.cz

STRATOS verejny nginx se nesmi dlouhodobe spravovat jako jeden sdileny soubor, do ktereho soucasne zasahuji vsechny aplikace. Stabilni model je:

```text
/etc/nginx/sites-available/stratos.zeleznalady.cz     # pouze server/TLS kostra
/etc/nginx/stratos-locations.d/10-akb.conf            # vlastni AKB tym
/etc/nginx/stratos-locations.d/20-projectflow.conf    # vlastni ProjectFlow tym
/etc/nginx/stratos-locations.d/30-archflow.conf       # vlastni ArchFlow tym
/etc/nginx/stratos-locations.d/90-budget-contract.conf # vlastni Budget & Contract tym, root fallback
```

Pravidla vlastnictvi:

- aplikace smi menit pouze vlastni soubor v `stratos-locations.d`,
- nikdo mimo provozni spravu nemeni hlavni `sites-available/stratos.zeleznalady.cz`,
- po kazde zmene se spousti `sudo nginx -t && sudo systemctl reload nginx`,
- root fallback `location /` musi zustat posledni, proto ma prefix `90-`.

HTTP bootstrap bez TLS pro prvni vydani certifikatu:

```bash
sudo mkdir -p /etc/nginx/stratos-locations.d

sudo tee /etc/nginx/sites-available/stratos.zeleznalady.cz >/dev/null <<'EOF'
server {
    listen 80;
    listen [::]:80;

    server_name stratos.zeleznalady.cz;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/stratos.zeleznalady.cz /etc/nginx/sites-enabled/stratos.zeleznalady.cz
sudo nginx -t
sudo systemctl reload nginx
```

Let's Encrypt:

```bash
sudo certbot certonly --webroot -w /var/www/html -d stratos.zeleznalady.cz
```

AKB location soubor vlastneny AKB:

```bash
sudo tee /etc/nginx/stratos-locations.d/10-akb.conf >/dev/null <<'EOF'
location = /akb {
    proxy_pass http://docker.home.cz:3220;
    proxy_http_version 1.1;

    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Prefix /akb;
    proxy_set_header X-Forwarded-Port $server_port;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    proxy_request_buffering off;
    proxy_buffering off;
}

location /akb/ {
    proxy_pass http://docker.home.cz:3220;
    proxy_http_version 1.1;

    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Prefix /akb;
    proxy_set_header X-Forwarded-Port $server_port;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    proxy_request_buffering off;
    proxy_buffering off;
}
EOF

sudo nginx -t
sudo systemctl reload nginx
```

ProjectFlow location soubor vlastneny ProjectFlow:

```bash
sudo tee /etc/nginx/stratos-locations.d/20-projectflow.conf >/dev/null <<'EOF'
location = /project {
    return 308 /project/;
}

location /project/ {
    proxy_pass http://docker.home.cz:3231;
    proxy_http_version 1.1;

    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Prefix /project;
    proxy_set_header X-Forwarded-Port $server_port;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    proxy_request_buffering off;
    proxy_buffering off;
}
EOF

sudo nginx -t
sudo systemctl reload nginx
```

ArchFlow location soubor vlastneny ArchFlow:

```bash
sudo tee /etc/nginx/stratos-locations.d/30-archflow.conf >/dev/null <<'EOF'
location = /arch {
    return 308 /arch/;
}

location /arch/ {
    proxy_pass http://docker.home.cz:3232;
    proxy_http_version 1.1;

    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Prefix /arch;
    proxy_set_header X-Forwarded-Port $server_port;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    proxy_request_buffering off;
    proxy_buffering off;
}
EOF

sudo nginx -t
sudo systemctl reload nginx
```

Budget & Contract root fallback soubor vlastneny Budget & Contract:

```bash
sudo tee /etc/nginx/stratos-locations.d/90-budget-contract.conf >/dev/null <<'EOF'
location / {
    proxy_pass http://docker.home.cz:3230/;
    proxy_http_version 1.1;

    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Prefix /;
    proxy_set_header X-Forwarded-Port $server_port;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    proxy_request_buffering off;
    proxy_buffering off;
}
EOF

sudo nginx -t
sudo systemctl reload nginx
```

Jednorazovy prikaz pro migraci ze stareho monolitickeho souboru na include model:

```bash
sudo mkdir -p /etc/nginx/stratos-locations.d

sudo tee /etc/nginx/sites-available/stratos.zeleznalady.cz >/dev/null <<'EOF'
server {
    listen 80;
    listen [::]:80;

    server_name stratos.zeleznalady.cz;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;

    server_name stratos.zeleznalady.cz;

    ssl_certificate     /etc/letsencrypt/live/stratos.zeleznalady.cz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/stratos.zeleznalady.cz/privkey.pem;

    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    client_max_body_size 350m;
    send_timeout 120s;
    proxy_read_timeout 300s;
    proxy_connect_timeout 300s;
    proxy_send_timeout 300s;

    include /etc/nginx/stratos-locations.d/*.conf;
}
EOF

sudo tee /etc/nginx/stratos-locations.d/10-akb.conf >/dev/null <<'EOF'
location = /akb {
    proxy_pass http://docker.home.cz:3220;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Prefix /akb;
    proxy_set_header X-Forwarded-Port $server_port;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_request_buffering off;
    proxy_buffering off;
}

location /akb/ {
    proxy_pass http://docker.home.cz:3220;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Prefix /akb;
    proxy_set_header X-Forwarded-Port $server_port;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_request_buffering off;
    proxy_buffering off;
}
EOF

sudo tee /etc/nginx/stratos-locations.d/20-projectflow.conf >/dev/null <<'EOF'
location = /project { return 308 /project/; }
location /project/ {
    proxy_pass http://docker.home.cz:3231;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Prefix /project;
    proxy_set_header X-Forwarded-Port $server_port;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_request_buffering off;
    proxy_buffering off;
}
EOF

sudo tee /etc/nginx/stratos-locations.d/30-archflow.conf >/dev/null <<'EOF'
location = /arch { return 308 /arch/; }
location /arch/ {
    proxy_pass http://docker.home.cz:3232;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Prefix /arch;
    proxy_set_header X-Forwarded-Port $server_port;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_request_buffering off;
    proxy_buffering off;
}
EOF

sudo tee /etc/nginx/stratos-locations.d/90-budget-contract.conf >/dev/null <<'EOF'
location / {
    proxy_pass http://docker.home.cz:3230/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Prefix /;
    proxy_set_header X-Forwarded-Port $server_port;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_request_buffering off;
    proxy_buffering off;
}
EOF

sudo ln -sf /etc/nginx/sites-available/stratos.zeleznalady.cz /etc/nginx/sites-enabled/stratos.zeleznalady.cz
sudo nginx -t
sudo systemctl reload nginx
```

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
AKL_WEB_BASE_PATH=/akb
AKL_WEB_OIDC_ISSUER=https://login.zeleznalady.cz/realms/stratos
AKL_WEB_OIDC_CLIENT_ID=akl-web
```

AKB web is built with the Next.js `basePath=/akb`. The AKB-owned Caddy
reverse proxy therefore removes an incoming `X-Forwarded-Prefix` header at the
request level and again on the upstream proxy request before forwarding
`/akb/*` requests to the web container. Public nginx may still set
`X-Forwarded-Prefix` for other STRATOS routing concerns, but AKB must not pass
that header through to Next.js because it can make protected routes resolve as
a static 404 instead of the expected OIDC redirect.

The docker-home compose profile defaults `AKL_WEB_BASE_PATH` to `/akb` for the
web build and runtime environment. Keep the explicit value in
`/srv/akl/env/akl.prod.env` for operational clarity, but a missing env value
must not rebuild the Next.js image without the `/akb` base path.

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

Vsechny aplikace pouzivaji centralni katalog z `@voldzi/stratos-ui`. AKB
predava `GlobalTopbar` pouze `currentAppId="akb"` a URL overrides pro dane
prostredi. Nazvy, ikony, poradi a stav ProcessForge se neskladaji lokalne.

Aktualni aplikace AI KnowledgeBase zustava v triggeru switcheru a z rozbalene
nabidky cilu se automaticky vynecha. Ostatni nakonfigurovane aplikace jsou
klikatelne; dostupnost a disabled duvody ridi sdileny katalog a volitelna
role/environment availability.

## AKB Stav Na docker.home.cz

Aktualni pilot:

- release: `/srv/akl/current` -> `/srv/akl/releases/<full-sha>`,
- release Git mirror: `/srv/akl/git/AI-KnowledgeBase.git`,
- env: `/srv/akl/env/akl.prod.env`,
- compose: `/srv/akl/current/infra/docker-compose/docker-compose.docker-home.yml`,
- AKB proxy port: `3220`,
- Docker subnets: `10.246.240.0/24` az `10.246.244.0/24`,
- PostgreSQL: `haproxy.home.cz:5000`,
- Ollama: preferovany endpoint `http://192.168.200.3:11434`, rizeny failover
  na `192.168.200.2` a `192.168.1.176`,
- object storage bridge: `/srv/seaweedfs/akl`.

AKB web derives signed source-download URLs from `NEXT_PUBLIC_AKL_BASE_PATH`
by default. For `/akb` deployments the generated source endpoint is
`/akb/api/documents/source/content`; `AKL_WEB_DOWNLOAD_PUBLIC_BASE_PATH` is
only an explicit override.

The exact `/akb` path redirects to `/akb/dashboard`, not `/akb/chat`; the web
shell owns the initial route and starts on the first AKB menu item for users
with workspace access. The edge redirect is marked `Cache-Control: no-store` so
clients do not retain stale route bootstrap responses.

## Povinné Porty Na docker.home.cz

Porty byly overene jako volne na `docker.home.cz` a jsou rezervovane pro STRATOS public routing. Aplikace je musi pouzit pro sve verejne/pilotni reverse-proxy vstupy:

```text
3220  AKB / AI KnowledgeBase
3221  AKB Chat PWA
3230  Budget & Contract
3231  ProjectFlow
3232  ArchFlow
```

Obsazene porty v okoli pri kontrole:

```text
3218  stratos-web
3219  stratos-project-control
3220  AKB
```

Ostatni STRATOS aplikace nesmi bez dohody pouzit `3218`, `3219`, `3220`, `3230`, `3231` ani `3232`.

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
curl -fsS http://127.0.0.1:3221/api/health
curl -fsS http://127.0.0.1:3221/api/ready
curl -fsS http://127.0.0.1:3221/manifest.webmanifest
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
/srv/akl/current/infra/keycloak/update-stratos-public-routing.sh
```

Skript se pta na Keycloak admin heslo a upravuje pouze:

- `redirectUris` a `webOrigins` existujicich STRATOS klientu,
- samostatny public klient `akb-chat-web`, jeho PKCE nastaveni a `akl-api`
  audience mapper.

Pokud `akb-chat-web` chybi, skript jej idempotentne vytvori. Nemaze uzivatele,
role, skupiny ani client secrets.
