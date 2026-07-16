from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def parse_service_client_ids(value: str) -> frozenset[str]:
    return frozenset(item.strip() for item in value.split(",") if item.strip())


def parse_service_client_mapping(
    value: str,
    *,
    variable_name: str,
) -> dict[str, frozenset[str]]:
    mapping: dict[str, set[str]] = {}
    for raw_entry in value.split(","):
        entry = raw_entry.strip()
        if not entry:
            continue
        caller, separator, raw_namespaces = entry.partition("=")
        namespaces = {item.strip() for item in raw_namespaces.split("|") if item.strip()}
        if not separator or not caller.strip() or not namespaces:
            raise ValueError(
                f"{variable_name} must use caller=value1|value2 entries"
            )
        mapping.setdefault(caller.strip(), set()).update(namespaces)
    return {caller: frozenset(values) for caller, values in mapping.items()}


class Settings(BaseSettings):
    service_name: str = "registry-api"
    service_version: str = Field(default="dev", alias="AKL_SERVICE_VERSION")
    env: Literal["development", "test", "production"] = Field(
        default="development", alias="AKL_ENV"
    )
    auth_mode: Literal["mock", "oidc"] = Field(default="mock", alias="AKL_AUTH_MODE")
    database_url: str = Field(
        default="sqlite+pysqlite:///./registry.db", alias="AKL_DATABASE_URL"
    )
    auto_create_schema: bool = Field(default=False, alias="AKL_AUTO_CREATE_SCHEMA")

    mock_subject: str = Field(default="user_dev", alias="AKL_MOCK_SUBJECT")
    mock_roles: list[str] = Field(default_factory=lambda: ["admin"], alias="AKL_MOCK_ROLES")

    oidc_issuer: str | None = Field(default=None, alias="AKL_OIDC_ISSUER")
    oidc_audience: str | None = Field(default=None, alias="AKL_OIDC_AUDIENCE")
    oidc_jwks_url: str | None = Field(default=None, alias="AKL_OIDC_JWKS_URL")
    trusted_service_client_ids: str = Field(
        default="", alias="AKL_TRUSTED_SERVICE_CLIENT_IDS"
    )
    service_client_delegations: str = Field(
        default="", alias="AKL_SERVICE_CLIENT_DELEGATIONS"
    )
    service_client_route_grants: str = Field(
        default="", alias="AKL_SERVICE_CLIENT_ROUTE_GRANTS"
    )

    stratos_auth_me_url: str | None = Field(default=None, alias="AKL_STRATOS_AUTH_ME_URL")
    stratos_policy_bindings_url: str | None = Field(
        default=None, alias="AKL_STRATOS_POLICY_BINDINGS_URL"
    )
    stratos_policy_decisions_url: str | None = Field(
        default=None, alias="AKL_STRATOS_POLICY_DECISIONS_URL"
    )
    stratos_service_policy_binding_id: str | None = Field(
        default=None, alias="AKL_STRATOS_SERVICE_POLICY_BINDING_ID"
    )
    stratos_information_resources_url: str | None = Field(
        default=None, alias="AKL_STRATOS_INFORMATION_RESOURCES_URL"
    )
    stratos_aiip_akb_resources_url: str | None = Field(
        default=None, alias="AKL_STRATOS_AIIP_AKB_RESOURCES_URL"
    )
    stratos_information_publications_url: str | None = Field(
        default=None, alias="AKL_STRATOS_INFORMATION_PUBLICATIONS_URL"
    )
    stratos_public_decisions_url: str | None = Field(
        default=None, alias="AKL_STRATOS_PUBLIC_DECISIONS_URL"
    )
    stratos_policy_service_token: str | None = Field(
        default=None, alias="AKB_POLICY_SERVICE_TOKEN"
    )
    stratos_aiip_ingest_service_token: str | None = Field(
        default=None, alias="AKB_AIIP_INGEST_SERVICE_TOKEN"
    )
    public_delivery_internal_token: str | None = Field(
        default=None, alias="AKL_PUBLIC_DELIVERY_INTERNAL_TOKEN"
    )
    public_audit_window_seconds: int = Field(
        default=60, ge=10, le=3600, alias="AKL_PUBLIC_AUDIT_WINDOW_SECONDS"
    )
    public_audit_retention_days: int = Field(
        default=90, ge=1, le=3650, alias="AKL_PUBLIC_AUDIT_RETENTION_DAYS"
    )
    public_audit_prune_interval_seconds: int = Field(
        default=3600,
        ge=60,
        le=86400,
        alias="AKL_PUBLIC_AUDIT_PRUNE_INTERVAL_SECONDS",
    )
    registry_public_rate_window_ms: int = Field(
        default=60000,
        ge=1000,
        le=3600000,
        alias="AKL_REGISTRY_PUBLIC_RATE_WINDOW_MS",
    )
    registry_public_rate_per_client_slug: int = Field(
        default=600,
        ge=1,
        le=1000000,
        alias="AKL_REGISTRY_PUBLIC_RATE_PER_CLIENT_SLUG",
    )
    registry_public_rate_global: int = Field(
        default=1200,
        ge=1,
        le=10000000,
        alias="AKL_REGISTRY_PUBLIC_RATE_GLOBAL",
    )
    registry_public_concurrency_per_client: int = Field(
        default=32,
        ge=1,
        le=10000,
        alias="AKL_REGISTRY_PUBLIC_CONCURRENCY_PER_CLIENT",
    )
    registry_public_concurrency_global: int = Field(
        default=64,
        ge=1,
        le=100000,
        alias="AKL_REGISTRY_PUBLIC_CONCURRENCY_GLOBAL",
    )
    registry_public_limiter_max_keys: int = Field(
        default=10000,
        ge=1,
        le=1000000,
        alias="AKL_REGISTRY_PUBLIC_LIMITER_MAX_KEYS",
    )
    registry_public_trusted_proxy_hops: int = Field(
        default=0,
        ge=0,
        le=10,
        alias="AKL_REGISTRY_PUBLIC_TRUSTED_PROXY_HOPS",
    )
    public_client_key_secret: str | None = Field(
        default=None,
        alias="AKL_PUBLIC_CLIENT_KEY_SECRET",
    )
    stratos_access_timeout_seconds: float = Field(
        default=3.0, gt=0, alias="AKL_STRATOS_ACCESS_TIMEOUT_SECONDS"
    )
    stratos_access_cache_ttl_seconds: float = Field(
        default=0.0, ge=0, alias="AKL_STRATOS_ACCESS_CACHE_TTL_SECONDS"
    )
    ingestion_authorization_secret: str | None = Field(
        default=None,
        alias="AKL_INGESTION_AUTHORIZATION_SECRET",
    )
    ingestion_authorization_secret_file: str | None = Field(
        default=None,
        alias="AKL_INGESTION_AUTHORIZATION_SECRET_FILE",
    )
    ingestion_authorization_ttl_seconds: int = Field(
        default=60,
        ge=10,
        le=300,
        alias="AKL_INGESTION_AUTHORIZATION_TTL_SECONDS",
    )

    keycloak_admin_base_url: str | None = Field(default=None, alias="AKL_KEYCLOAK_ADMIN_BASE_URL")
    keycloak_realm: str = Field(default="stratos", alias="AKL_KEYCLOAK_REALM")
    keycloak_directory_client_id: str | None = Field(
        default=None, alias="STRATOS_KEYCLOAK_DIRECTORY_CLIENT_ID"
    )
    keycloak_directory_client_secret: str | None = Field(
        default=None, alias="STRATOS_KEYCLOAK_DIRECTORY_CLIENT_SECRET"
    )
    keycloak_directory_timeout_seconds: float = Field(
        default=10.0, alias="AKL_KEYCLOAK_DIRECTORY_TIMEOUT_SECONDS"
    )

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", populate_by_name=True)

    @property
    def trusted_service_clients(self) -> frozenset[str]:
        return parse_service_client_ids(self.trusted_service_client_ids)

    @property
    def service_namespace_delegations(self) -> dict[str, frozenset[str]]:
        return parse_service_client_mapping(
            self.service_client_delegations,
            variable_name="AKL_SERVICE_CLIENT_DELEGATIONS",
        )

    @property
    def service_route_grants(self) -> dict[str, frozenset[str]]:
        return parse_service_client_mapping(
            self.service_client_route_grants,
            variable_name="AKL_SERVICE_CLIENT_ROUTE_GRANTS",
        )

    @property
    def ingestion_authorization_signing_secret(self) -> str:
        if self.ingestion_authorization_secret:
            return self.ingestion_authorization_secret
        if self.ingestion_authorization_secret_file:
            try:
                value = Path(self.ingestion_authorization_secret_file).read_text(
                    encoding="utf-8"
                ).strip()
            except OSError as exc:
                raise ValueError(
                    "AKL_INGESTION_AUTHORIZATION_SECRET_FILE could not be read"
                ) from exc
            if value:
                return value
        if self.env != "production":
            return "akb-development-ingestion-authorization-secret-v1"
        raise ValueError("Ingestion authorization signing secret is unavailable")

    @model_validator(mode="after")
    def validate_security_mode(self) -> "Settings":
        if self.env == "production" and self.auth_mode == "mock":
            raise ValueError("AKL_AUTH_MODE=mock is not allowed when AKL_ENV=production")

        if self.auth_mode == "oidc":
            missing = [
                name
                for name, value in {
                    "AKL_OIDC_ISSUER": self.oidc_issuer,
                    "AKL_OIDC_AUDIENCE": self.oidc_audience,
                    "AKL_OIDC_JWKS_URL": self.oidc_jwks_url,
                }.items()
                if not value
            ]
            if missing:
                raise ValueError(f"OIDC auth mode requires: {', '.join(missing)}")

        trusted_service_clients = self.trusted_service_clients
        service_delegations = self.service_namespace_delegations
        route_grants = self.service_route_grants
        if self.env == "production" and not trusted_service_clients:
            raise ValueError(
                "Production OIDC requires AKL_TRUSTED_SERVICE_CLIENT_IDS"
            )
        unknown_service_clients = set(service_delegations).union(route_grants).difference(
            trusted_service_clients
        )
        if unknown_service_clients:
            raise ValueError(
                "Service client mapping contains untrusted callers: "
                + ", ".join(sorted(unknown_service_clients))
            )
        invalid_routes = {
            route
            for routes in route_grants.values()
            for route in routes
            if route not in {
                "authz",
                "audit",
                "audit-read",
                "idempotency",
                "documents-read",
                "documents-write",
                "external-documents-read",
                "external-documents-write",
                "extractions-read",
                "extractions-write",
                "workflow-read",
                "workflow-write",
                "intelligence-read",
                "intelligence-write",
                "assistant-read",
                "assistant-write",
                "directory-read",
                "directory-write",
                "access-admin-read",
                "access-admin-write",
                "profile-read",
                "profile-write",
                "aiip-upload",
                "ingestion-status",
            }
        }
        if invalid_routes:
            raise ValueError(
                "AKL_SERVICE_CLIENT_ROUTE_GRANTS contains unsupported routes: "
                + ", ".join(sorted(invalid_routes))
            )

        if self.env == "production":
            if bool(self.ingestion_authorization_secret) == bool(
                self.ingestion_authorization_secret_file
            ):
                raise ValueError(
                    "Production Registry requires exactly one of "
                    "AKL_INGESTION_AUTHORIZATION_SECRET or "
                    "AKL_INGESTION_AUTHORIZATION_SECRET_FILE"
                )
            if len(self.ingestion_authorization_signing_secret) < 32:
                raise ValueError(
                    "The ingestion authorization signing secret must contain at least 32 characters"
                )
            if not route_grants:
                raise ValueError(
                    "Production OIDC requires AKL_SERVICE_CLIENT_ROUTE_GRANTS"
                )
            required_ingestion_routes = frozenset(
                {"authz", "audit", "documents-read", "ingestion-status"}
            )
            if "svc-ingestion" not in trusted_service_clients:
                raise ValueError(
                    "Production Registry requires trusted client svc-ingestion"
                )
            if route_grants.get("svc-ingestion") != required_ingestion_routes:
                raise ValueError(
                    "Production svc-ingestion grants must be exactly "
                    "authz|audit|documents-read|ingestion-status"
                )
            if route_grants.get("aiip-document-service") != frozenset(
                {"aiip-upload"}
            ):
                raise ValueError(
                    "Production aiip-document-service grant must be exactly aiip-upload"
                )
            missing_governance = [
                name
                for name, value in {
                    "AKL_STRATOS_AUTH_ME_URL": self.stratos_auth_me_url,
                    "AKL_STRATOS_POLICY_BINDINGS_URL": self.stratos_policy_bindings_url,
                    "AKL_STRATOS_POLICY_DECISIONS_URL": self.stratos_policy_decisions_url,
                    "AKL_STRATOS_SERVICE_POLICY_BINDING_ID": self.stratos_service_policy_binding_id,
                    "AKL_STRATOS_INFORMATION_RESOURCES_URL": self.stratos_information_resources_url,
                    "AKL_STRATOS_AIIP_AKB_RESOURCES_URL": self.stratos_aiip_akb_resources_url,
                    "AKL_STRATOS_INFORMATION_PUBLICATIONS_URL": self.stratos_information_publications_url,
                    "AKL_STRATOS_PUBLIC_DECISIONS_URL": self.stratos_public_decisions_url,
                    "AKB_POLICY_SERVICE_TOKEN": self.stratos_policy_service_token,
                    "AKB_AIIP_INGEST_SERVICE_TOKEN": self.stratos_aiip_ingest_service_token,
                    "AKL_PUBLIC_DELIVERY_INTERNAL_TOKEN": self.public_delivery_internal_token,
                }.items()
                if not value
            ]
            if missing_governance:
                raise ValueError(
                    f"Production access governance requires: {', '.join(missing_governance)}"
                )
            if len(self.public_delivery_internal_token or "") < 32:
                raise ValueError(
                    "AKL_PUBLIC_DELIVERY_INTERNAL_TOKEN must contain at least 32 characters in production"
                )
            if self.stratos_aiip_ingest_service_token == self.stratos_policy_service_token:
                raise ValueError(
                    "AKB_AIIP_INGEST_SERVICE_TOKEN must be distinct from AKB_POLICY_SERVICE_TOKEN"
                )

        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
