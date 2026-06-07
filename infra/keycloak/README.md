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

RAG Retrieval, Ingestion, and LLM Gateway support `AKL_AUTH_MODE=oidc` as a bearer-required mode. RAG and Ingestion propagate caller tokens for document authz and LLM calls; Registry audit writes can use service-account token fallback. Registry API remains the document authorization enforcement point for `/authz/check` and `/authz/filter-documents`.

## Remaining baseline gaps

- RAG Retrieval, Ingestion, and LLM Gateway do not locally validate JWT signatures; they require and forward bearer tokens.
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
AKL_WEB_PUBLIC_BASE_URL=https://akl.zeleznalady.cz
AKL_WEB_SESSION_SECRET=<long random value>
```

`akl-web` and `stratos-akl-adapter` include an `akl-api` audience mapper because Registry API validates bearer tokens with `AKL_OIDC_AUDIENCE=akl-api`.
