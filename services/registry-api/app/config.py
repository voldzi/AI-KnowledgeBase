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


# Kept only for rolling upgrades: stale production configuration must not
# re-enable a retired integration route.
_RETIRED_SERVICE_ROUTES = frozenset({"aiip-upload"})


class Settings(BaseSettings):
    service_name: str = "registry-api"
    service_version: str = Field(default="dev", alias="AKL_SERVICE_VERSION")
    env: Literal["development", "test", "production"] = Field(
        default="development", alias="AKL_ENV"
    )
    auth_mode: Literal["mock", "oidc"] = Field(default="mock", alias="AKL_AUTH_MODE")
    identity_mode: Literal["external_oidc", "managed"] = Field(default="external_oidc", alias="AKL_IDENTITY_MODE")
    managed_identity_issuer: str | None = Field(default=None, alias="AKL_MANAGED_IDENTITY_ISSUER")
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
    web_session_store_secret: str | None = Field(
        default=None, alias="AKL_WEB_SESSION_STORE_SECRET"
    )
    web_session_store_secret_file: str | None = Field(
        default=None, alias="AKL_WEB_SESSION_STORE_SECRET_FILE"
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
    stratos_budget_akb_resources_url: str | None = Field(
        default=None, alias="AKL_STRATOS_BUDGET_AKB_RESOURCES_URL"
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
    assistant_conversation_default_retention_days: int = Field(
        default=180,
        ge=1,
        le=3650,
        alias="AKL_ASSISTANT_CONVERSATION_RETENTION_DAYS",
    )
    assistant_purge_enabled: bool = Field(
        default=False,
        alias="AKL_ASSISTANT_PURGE_ENABLED",
    )
    assistant_purge_interval_seconds: int = Field(
        default=3600,
        ge=60,
        le=86400,
        alias="AKL_ASSISTANT_PURGE_INTERVAL_SECONDS",
    )
    assistant_purge_batch_size: int = Field(
        default=500,
        ge=1,
        le=5000,
        alias="AKL_ASSISTANT_PURGE_BATCH_SIZE",
    )
    assistant_deletion_audit_retention_days: int = Field(
        default=730,
        ge=30,
        le=3650,
        alias="AKL_ASSISTANT_DELETION_AUDIT_RETENTION_DAYS",
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
    content_security_required: bool = Field(
        default=False,
        alias="STRATOS_CONTENT_SECURITY_REQUIRED",
    )
    content_security_attestation_secret: str | None = Field(
        default=None,
        alias="AKL_WEB_UPLOAD_SIGNING_SECRET",
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
        parsed = parse_service_client_mapping(
            self.service_client_route_grants,
            variable_name="AKL_SERVICE_CLIENT_ROUTE_GRANTS",
        )
        return {
            client_id: frozenset(route for route in routes if route not in _RETIRED_SERVICE_ROUTES)
            for client_id, routes in parsed.items()
        }

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

    @property
    def web_session_store_signing_secret(self) -> str:
        if self.web_session_store_secret:
            return self.web_session_store_secret
        if self.web_session_store_secret_file:
            try:
                value = Path(self.web_session_store_secret_file).read_text(
                    encoding="utf-8"
                ).strip()
            except OSError as exc:
                raise ValueError(
                    "AKL_WEB_SESSION_STORE_SECRET_FILE could not be read"
                ) from exc
            if value:
                return value
        if self.env != "production":
            return "akb-development-web-session-store-secret-v1"
        raise ValueError("Web session store signing secret is unavailable")

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
                    **({"AKL_OIDC_JWKS_URL": self.oidc_jwks_url} if self.identity_mode != "managed" else {}),
                }.items()
                if not value
            ]
            if missing:
                raise ValueError(f"OIDC auth mode requires: {', '.join(missing)}")

        if self.identity_mode == "managed":
            from app.managed_identity import approved_issuer
            approved_issuer(self.oidc_issuer, self.managed_identity_issuer)
            if self.auth_mode != "oidc" or self.oidc_audience != "akl-api" or self.stratos_access_cache_ttl_seconds != 0:
                raise ValueError("Managed identity requires OIDC, akl-api and uncached access projection")
            from urllib.parse import urlsplit
            projection = urlsplit(self.stratos_auth_me_url or "")
            if projection.scheme != "https" or not projection.hostname or projection.username or projection.password or projection.query or projection.fragment:
                raise ValueError("Managed identity requires an approved HTTPS access projection endpoint")
            grants = self.service_route_grants.get("svc-budget-controlled-rules", frozenset())
            if grants and grants != frozenset({"controlled-rules-read"}):
                raise ValueError("Managed Budget rules identity must have only the controlled-rules-read route")

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
                "stratos-budget-upload",
                "controlled-rules-read",
                "ingestion-status",
            }
        }
        if invalid_routes:
            raise ValueError(
                "AKL_SERVICE_CLIENT_ROUTE_GRANTS contains unsupported routes: "
                + ", ".join(sorted(invalid_routes))
            )

        if self.env == "production":
            if bool(self.web_session_store_secret) == bool(
                self.web_session_store_secret_file
            ):
                raise ValueError(
                    "Production Registry requires exactly one of "
                    "AKL_WEB_SESSION_STORE_SECRET or AKL_WEB_SESSION_STORE_SECRET_FILE"
                )
            if len(self.web_session_store_signing_secret) < 32:
                raise ValueError("The web session store signing secret must contain at least 32 characters")
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
            if self.content_security_required and (
                not self.content_security_attestation_secret
                or len(self.content_security_attestation_secret) < 32
            ):
                raise ValueError(
                    "Required Document Intake verification needs "
                    "AKL_WEB_UPLOAD_SIGNING_SECRET with at least 32 characters"
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
            if "stratos-akb-service" not in trusted_service_clients:
                raise ValueError(
                    "Production Registry requires trusted client stratos-akb-service"
                )
            if route_grants.get("stratos-akb-service") != frozenset(
                {"stratos-budget-upload"}
            ):
                raise ValueError(
                    "Production stratos-akb-service grant must be exactly "
                    "stratos-budget-upload"
                )
            if "svc-budget-controlled-rules" not in trusted_service_clients:
                raise ValueError(
                    "Production Registry requires trusted client "
                    "svc-budget-controlled-rules"
                )
            if route_grants.get("svc-budget-controlled-rules") != frozenset(
                {"controlled-rules-read"}
            ):
                raise ValueError(
                    "Production svc-budget-controlled-rules grant must be "
                    "exactly controlled-rules-read"
                )
            if "svc-akb-director-copilot" not in trusted_service_clients:
                raise ValueError(
                    "Production Registry requires trusted client "
                    "svc-akb-director-copilot"
                )
            if route_grants.get("svc-akb-director-copilot") != frozenset(
                {"audit"}
            ):
                raise ValueError(
                    "Production svc-akb-director-copilot grant must be "
                    "exactly audit"
                )
            budget_upload_clients = {
                client_id
                for client_id, routes in route_grants.items()
                if "stratos-budget-upload" in routes
            }
            if budget_upload_clients != {"stratos-akb-service"}:
                raise ValueError(
                    "Production stratos-budget-upload route must be granted only "
                    "to stratos-akb-service"
                )
            controlled_rule_clients = {
                client_id
                for client_id, routes in route_grants.items()
                if "controlled-rules-read" in routes
            }
            if controlled_rule_clients != {"svc-budget-controlled-rules"}:
                raise ValueError(
                    "Production controlled-rules-read route must be granted only "
                    "to svc-budget-controlled-rules"
                )
            missing_governance = [
                name
                for name, value in {
                    "AKL_STRATOS_AUTH_ME_URL": self.stratos_auth_me_url,
                    "AKL_STRATOS_POLICY_BINDINGS_URL": self.stratos_policy_bindings_url,
                    "AKL_STRATOS_POLICY_DECISIONS_URL": self.stratos_policy_decisions_url,
                    "AKL_STRATOS_SERVICE_POLICY_BINDING_ID": self.stratos_service_policy_binding_id,
                    "AKL_STRATOS_INFORMATION_RESOURCES_URL": self.stratos_information_resources_url,
                    "AKL_STRATOS_BUDGET_AKB_RESOURCES_URL": self.stratos_budget_akb_resources_url,
                    "AKL_STRATOS_INFORMATION_PUBLICATIONS_URL": self.stratos_information_publications_url,
                    "AKL_STRATOS_PUBLIC_DECISIONS_URL": self.stratos_public_decisions_url,
                    "AKB_POLICY_SERVICE_TOKEN": self.stratos_policy_service_token,
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
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
