from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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

    stratos_auth_me_url: str | None = Field(default=None, alias="AKL_STRATOS_AUTH_ME_URL")
    stratos_policy_bindings_url: str | None = Field(
        default=None, alias="AKL_STRATOS_POLICY_BINDINGS_URL"
    )
    stratos_policy_decisions_url: str | None = Field(
        default=None, alias="AKL_STRATOS_POLICY_DECISIONS_URL"
    )
    stratos_policy_service_token: str | None = Field(
        default=None, alias="AKL_STRATOS_POLICY_SERVICE_TOKEN"
    )
    stratos_access_timeout_seconds: float = Field(
        default=3.0, gt=0, alias="AKL_STRATOS_ACCESS_TIMEOUT_SECONDS"
    )
    stratos_access_cache_ttl_seconds: float = Field(
        default=0.0, ge=0, alias="AKL_STRATOS_ACCESS_CACHE_TTL_SECONDS"
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

        if self.env == "production":
            missing_governance = [
                name
                for name, value in {
                    "AKL_STRATOS_AUTH_ME_URL": self.stratos_auth_me_url,
                    "AKL_STRATOS_POLICY_BINDINGS_URL": self.stratos_policy_bindings_url,
                    "AKL_STRATOS_POLICY_DECISIONS_URL": self.stratos_policy_decisions_url,
                    "AKL_STRATOS_POLICY_SERVICE_TOKEN": self.stratos_policy_service_token,
                }.items()
                if not value
            ]
            if missing_governance:
                raise ValueError(
                    f"Production access governance requires: {', '.join(missing_governance)}"
                )

        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
