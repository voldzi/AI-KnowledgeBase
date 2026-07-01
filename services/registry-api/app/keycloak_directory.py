from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import httpx

from app.config import Settings
from app.errors import problem
from starlette import status


@dataclass(frozen=True)
class DirectoryUser:
    id: str
    subject: str
    provider: str
    name: str
    initials: str
    email: str | None
    username: str | None
    enabled: bool
    source: str = "keycloak"


class KeycloakDirectoryAdapter:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._access_token: str | None = None
        self._expires_at = 0.0

    def search_users(self, query: str, max_results: int = 20) -> list[DirectoryUser]:
        normalized = query.strip()
        if normalized and len(normalized) < 2:
            return []
        params = {
            "briefRepresentation": "true",
            "first": "0",
            "max": str(min(max_results, 50)),
        }
        if normalized:
            params["search"] = normalized
        response = self._request(
            "GET",
            f"/admin/realms/{self._settings.keycloak_realm}/users",
            params=params,
        )
        return [_directory_user_from_keycloak(item) for item in response.json()]

    def get_user(self, subject: str) -> DirectoryUser | None:
        response = self._request(
            "GET",
            f"/admin/realms/{self._settings.keycloak_realm}/users/{subject}",
            allow_not_found=True,
        )
        if response.status_code == status.HTTP_404_NOT_FOUND:
            return None
        return _directory_user_from_keycloak(response.json())

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        allow_not_found: bool = False,
    ) -> httpx.Response:
        self._require_config()
        with httpx.Client(timeout=self._settings.keycloak_directory_timeout_seconds) as client:
            response = client.request(
                method,
                f"{self._base_url()}{path}",
                params=params,
                headers={"Authorization": f"Bearer {self._token()}"},
            )
        if allow_not_found and response.status_code == status.HTTP_404_NOT_FOUND:
            return response
        if response.status_code >= 400:
            raise problem(
                status.HTTP_502_BAD_GATEWAY,
                "keycloak_directory_error",
                "Keycloak directory lookup failed",
                {"status_code": response.status_code},
            )
        return response

    def _token(self) -> str:
        if self._access_token and time.time() < self._expires_at:
            return self._access_token

        self._require_config()
        with httpx.Client(timeout=self._settings.keycloak_directory_timeout_seconds) as client:
            response = client.post(
                f"{self._base_url()}/realms/{self._settings.keycloak_realm}/protocol/openid-connect/token",
                data={
                    "grant_type": "client_credentials",
                    "client_id": self._settings.keycloak_directory_client_id,
                    "client_secret": self._settings.keycloak_directory_client_secret,
                },
            )
        if response.status_code >= 400:
            raise problem(
                status.HTTP_502_BAD_GATEWAY,
                "keycloak_directory_token_error",
                "Keycloak directory token request failed",
                {"status_code": response.status_code},
            )
        payload = response.json()
        token = str(payload.get("access_token") or "")
        if not token:
            raise problem(
                status.HTTP_502_BAD_GATEWAY,
                "keycloak_directory_token_missing",
                "Keycloak directory token response did not contain an access token",
            )
        expires_in = int(payload.get("expires_in") or 60)
        self._access_token = token
        self._expires_at = time.time() + max(30, expires_in - 20)
        return token

    def _base_url(self) -> str:
        return str(self._settings.keycloak_admin_base_url).rstrip("/")

    def _require_config(self) -> None:
        missing = [
            name
            for name, value in {
                "AKL_KEYCLOAK_ADMIN_BASE_URL": self._settings.keycloak_admin_base_url,
                "STRATOS_KEYCLOAK_DIRECTORY_CLIENT_ID": self._settings.keycloak_directory_client_id,
                "STRATOS_KEYCLOAK_DIRECTORY_CLIENT_SECRET": self._settings.keycloak_directory_client_secret,
            }.items()
            if not value
        ]
        if missing:
            raise problem(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "keycloak_directory_not_configured",
                "Keycloak directory reader is not configured",
                {"missing": missing},
            )


def _directory_user_from_keycloak(data: dict[str, Any]) -> DirectoryUser:
    subject = str(data.get("id") or "")
    username = _optional_str(data.get("username"))
    email = _optional_str(data.get("email"))
    first_name = _optional_str(data.get("firstName"))
    last_name = _optional_str(data.get("lastName"))
    full_name = " ".join(part for part in [first_name, last_name] if part).strip()
    name = full_name or username or email or subject
    return DirectoryUser(
        id=subject,
        subject=subject,
        provider="keycloak",
        name=name,
        initials=_initials(name),
        email=email,
        username=username,
        enabled=bool(data.get("enabled", False)),
    )


def _optional_str(value: Any) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _initials(name: str) -> str:
    parts = [part for part in name.replace(".", " ").split() if part]
    if not parts:
        return "?"
    return "".join(part[0] for part in parts[:2]).upper()
