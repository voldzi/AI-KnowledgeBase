# AKL Keycloak

`realm-akl.json` defines the AKL realm, baseline roles, public web client, and service account clients.

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

- The browser OIDC login flow is not implemented yet.
- RAG Retrieval, Ingestion, and LLM Gateway do not locally validate JWT signatures; they require and forward bearer tokens.
- Service account secrets are intentionally absent from this repository and must be injected by local shell, compose env file, or a secret manager.
