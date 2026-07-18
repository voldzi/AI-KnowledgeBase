# AKL Keycloak

`realm-akl.json` defines the standalone local AKL realm, baseline roles, public web client, and service account clients.

`realm-stratos.json` defines the production STRATOS realm shape shared by AKL, Budget & Contract, ProjectFlow, and ARCHFLOW. It includes:

- public web OIDC clients for STRATOS applications,
- confidential service clients for application APIs,
- confidential `stratos-akl-adapter` service client,
- shared STRATOS roles (`stratos_admin`, `stratos_user`, `stratos_auditor`),
- AKL-prefixed roles for STRATOS identity administration,
- AKL canonical roles consumed by the current Registry API authorization model,
- `loginTheme=stratos`.

The STRATOS login theme lives in `themes/stratos` and follows the same Keycloak theme structure as the COP reference application.

No client secrets are stored in this repository. For real deployments, generate confidential client secrets in Keycloak or inject them through a secret manager and service-specific environment variables.

The roles mirror `docs/CONTRACTS/06_SECURITY_AUTHZ_MODEL.md`:

- `admin`
- `document_manager`
- `document_owner`
- `reviewer`
- `reader`
- `auditor`
- `service_ingestion`
- `service_aiip`
- `service_rag`
- `service_llm_gateway`
- `service_evaluation`
- `service_governance`

## Local OIDC profile

The dev compose stack imports realm `akl` and exposes Keycloak on `http://localhost:8081`.
Inside the compose network, services use `http://keycloak:8080`.

Registry API validates JWTs in `AKL_AUTH_MODE=oidc` with:

```text
AKL_OIDC_ISSUER=http://keycloak:8080/realms/akl
AKL_OIDC_AUDIENCE=akl-registry-api
AKL_OIDC_JWKS_URL=http://keycloak:8080/realms/akl/protocol/openid-connect/certs
```

RAG Retrieval, Ingestion, and LLM Gateway support `AKL_AUTH_MODE=oidc` as a
bearer-required mode. Ingestion never propagates its inbound caller bearer to
Registry or LLM Gateway. Registry calls use a dedicated short-lived
`svc-ingestion` client-credentials bearer; caller subject survives only in
delegated authz/audit context. Registry API remains the document authorization
enforcement point for `/authz/check` and `/authz/filter-documents`.

## Remaining baseline gaps

- RAG Retrieval and LLM Gateway retain their documented token boundaries;
  Ingestion locally validates OIDC JWT signatures and keeps inbound and
  outbound service credentials separate.
- Service account secrets are intentionally absent from this repository and must be injected by local shell, compose env file, or a secret manager.

## STRATOS production profile

On `docker.home.cz`, Keycloak is a shared STRATOS service. AKL does not start its own Keycloak container. Import `realm-stratos.json` into the shared Keycloak instance and mount the theme directory into the Keycloak container:

```text
/srv/akl/repo/infra/keycloak/themes/stratos:/opt/keycloak/themes/stratos:ro
```

The STRATOS production issuer is expected to be:

```text
https://login.zeleznalady.cz/realms/stratos
```

AKL web uses the authorization code flow through `akl-web` and stores an encrypted HTTP-only session cookie. Required production web variables:

```text
AKL_WEB_OIDC_ISSUER=https://login.zeleznalady.cz/realms/stratos
AKL_WEB_OIDC_CLIENT_ID=akl-web
AKL_WEB_PUBLIC_BASE_URL=https://stratos.zeleznalady.cz/akb
AKL_WEB_SESSION_SECRET=<long random value>
```

`akl-web` and `stratos-akl-adapter` include an `akl-api` audience mapper because Registry API validates bearer tokens with `AKL_OIDC_AUDIENCE=akl-api`.

The standalone chat uses the dedicated public client `akb-chat-web` with
Authorization Code + PKCE. Existing production realms must reconcile it with
`update-stratos-public-routing.sh`; importing the realm export is not required:

```text
redirect URI: https://chat.zeleznalady.cz/api/auth/callback
post logout URI: https://chat.zeleznalady.cz/*
web origin: https://chat.zeleznalady.cz
```

The reconciliation is idempotent. It creates the client and its `akl-api`
audience mapper when absent and otherwise restores the exact public-client,
flow, PKCE and URI settings. It does not modify users, roles, groups or other
client secrets.

Interactive administration uses the Keycloak administrator password. On the
production host, the supported non-interactive alternative creates a random,
short-lived bootstrap administration client, performs the reconciliation and
removes that temporary client before exit:

```bash
KEYCLOAK_USE_BOOTSTRAP_ADMIN_SERVICE=true \
  ./infra/keycloak/update-stratos-public-routing.sh
```

Provision the confidential `aiip-service` client, its single application role,
and the `akb-api` audience with:

```bash
./scripts/ensure_aiip_service_client.sh
```

The script writes the generated secret to
`/srv/akl/env/aiip-service.client-secret` with mode `0600` and never prints the
secret. The file is handed to AIIP through the production secret-management
process; it is not consumed by AKB containers and must not be committed.

The production RAG service additionally needs a separate short-lived-token
identity for Registry calls. Provision it with the same helper using
`AIIP_CLIENT_ID=akb-rag-service`, `AIIP_ROLE=service_rag`,
`AIIP_AUDIENCE=akl-api`, and
`AIIP_SECRET_FILE=/srv/akl/env/akb-rag-service.client-secret`. This secret is
mounted read-only only into the RAG container.

Provision the independent ingestion-to-Registry identity with the same helper:

```bash
AIIP_CLIENT_ID=svc-ingestion \
AIIP_ROLE=service_ingestion \
AIIP_AUDIENCE=akl-api \
AIIP_SECRET_FILE=/srv/akl/env/svc-ingestion.client-secret \
SERVICE_CLIENT_NAME="AKB Ingestion Registry Client" \
./scripts/ensure_aiip_service_client.sh
```

Mount that file read-only only into `ingestion-service`. Configure Registry
with trusted client `svc-ingestion` and exact grants
`authz|audit|documents-read|ingestion-status`; never add those grants to
`aiip-service`.

Provision the separate AKB web-to-ingestion transport identity as well:

```bash
AIIP_CLIENT_ID=svc-akb-web-ingestion \
AIIP_ROLE=service_akb_web_ingestion \
AIIP_AUDIENCE=akl-api \
AIIP_SECRET_FILE=/srv/akl/env/svc-akb-web-ingestion.client-secret \
SERVICE_CLIENT_NAME="AKB Web Ingestion Transport" \
./scripts/ensure_aiip_service_client.sh
```

Mount this secret read-only only into the AKB web container. The ingestion
service validates the exact `azp`, service-account username, audience and role;
this client receives no Registry route grants and cannot list global jobs,
read reports, cancel jobs, reindex, or call intelligence endpoints.

The target STRATOS public routing model is documented in `docs/deployment/stratos-public-routing-and-docker-home.md`. The `akl.zeleznalady.cz` standalone domain can remain as a temporary Keycloak redirect alias during migration, but the target public AKB URL is `/akb` under `https://stratos.zeleznalady.cz`.
