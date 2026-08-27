"""Strict STRATOS managed identity boundary; no authorization from token claims."""
from __future__ import annotations

from functools import lru_cache
import re
import threading
import time
from urllib.parse import urlsplit

import httpx
import jwt
from opentelemetry.context import attach, detach, set_value
from opentelemetry.instrumentation.utils import _SUPPRESS_INSTRUMENTATION_KEY

USER_AUDIENCES = {"akl-api", "stratos-access-api"}
USER_FORBIDDEN = {"stratos_service", "stratos_service_roles", "realm_access", "resource_access", "role", "roles"}
SERVICE_FORBIDDEN = {"stratos_roles", "realm_access", "resource_access", "role", "roles", "identity_source", "identity_audience", "stratos_remember_device", "stratos_session_started_at", "email", "preferred_username", "name", "groups", "auth_time"}
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


class ManagedIdentityInvalid(ValueError):
    pass


class ManagedIdentityUnavailable(RuntimeError):
    pass


def approved_issuer(issuer: str | None, approved: str | None) -> str:
    url = urlsplit(issuer or "")
    if not issuer or issuer != approved or url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment or issuer.endswith("/"):
        raise ValueError("Managed identity requires an explicitly approved HTTPS issuer")
    return issuer


def exact_values(value: object, expected: set[str]) -> bool:
    return isinstance(value, list) and len(value) == len(expected) and all(isinstance(item, str) for item in value) and set(value) == expected


def validate_user(claims: dict) -> None:
    if (
        not exact_values(claims.get("aud"), USER_AUDIENCES)
        or not UUID.fullmatch(str(claims.get("sub", "")))
        or not exact_values(claims.get("stratos_roles"), {"stratos_user"})
        or USER_FORBIDDEN.intersection(claims)
        or claims.get("identity_audience") not in ("employees", "external")
        or not isinstance(claims.get("identity_source"), str)
        or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,159}", claims["identity_source"])
        or not isinstance(claims.get("stratos_remember_device"), bool)
    ):
        raise ManagedIdentityInvalid("Invalid managed user claims")


def validate_rules_service(claims: dict) -> None:
    aud = claims.get("aud")
    aud = [aud] if isinstance(aud, str) else aud
    client_id = "svc-budget-controlled-rules"
    if not exact_values(aud, {"akl-api"}) or claims.get("stratos_service") is not True or claims.get("client_id") != client_id or claims.get("azp", client_id) != client_id or claims.get("scope") != "controlled-rules-read" or not exact_values(claims.get("stratos_service_roles"), {"service_budget_rules_read"}) or SERVICE_FORBIDDEN.intersection(claims):
        raise ManagedIdentityInvalid("Invalid managed service claims")


class ManagedOidcVerifier:
    def __init__(self, issuer: str, approved: str):
        self.issuer = approved_issuer(issuer, approved)
        self._lock = threading.Lock()
        self._keys: list[jwt.PyJWK] = []
        self._loaded_at = 0.0

    def _json(self, url: str) -> dict:
        context_token = attach(set_value(_SUPPRESS_INSTRUMENTATION_KEY, True))
        try:
            with httpx.Client(timeout=5, follow_redirects=False) as client:
                with client.stream("GET", url, headers={"Accept": "application/json"}) as response:
                    if response.status_code != 200:
                        raise ManagedIdentityUnavailable("Identity endpoint is unavailable")
                    data = bytearray()
                    for chunk in response.iter_bytes():
                        data.extend(chunk)
                        if len(data) > 65536:
                            raise ManagedIdentityUnavailable("Identity response exceeds limit")
                    import json
                    body = json.loads(data)
                    if not isinstance(body, dict):
                        raise ValueError()
                    return body
        except (httpx.HTTPError, ValueError) as exc:
            raise ManagedIdentityUnavailable("Identity endpoint is unavailable or invalid") from exc
        finally:
            detach(context_token)

    def _load_keys(self, now: float) -> None:
        metadata = self._json(self.issuer + "/.well-known/openid-configuration")
        if metadata.get("issuer") != self.issuer:
            raise ManagedIdentityInvalid("Discovery issuer mismatch")
        endpoint = metadata.get("jwks_uri")
        if not isinstance(endpoint, str):
            raise ManagedIdentityInvalid("Invalid discovery JWKS endpoint")
        base, target = urlsplit(self.issuer), urlsplit(endpoint)
        if target.scheme != "https" or target.netloc != base.netloc or not target.path.startswith(base.path + "/") or target.username or target.password or target.query or target.fragment:
            raise ManagedIdentityInvalid("Invalid discovery JWKS endpoint")
        body = self._json(endpoint)
        keys = body.get("keys")
        if not isinstance(keys, list) or not 1 <= len(keys) <= 32:
            raise ManagedIdentityInvalid("Invalid identity key set")
        try:
            self._keys = jwt.PyJWKSet.from_dict(body).keys
        except (jwt.PyJWTError, ValueError, TypeError) as exc:
            raise ManagedIdentityInvalid("Invalid identity key set") from exc
        self._loaded_at = now

    def verify(self, token: str) -> dict:
        if len(token) > 16384:
            raise ManagedIdentityInvalid("Token exceeds limit")
        try:
            header = jwt.get_unverified_header(token)
            if header.get("alg") != "RS256" or not isinstance(header.get("kid"), str) or not 1 <= len(header["kid"]) <= 160:
                raise ManagedIdentityInvalid("Invalid token header")
            now = time.time()
            with self._lock:
                if not self._keys or now - self._loaded_at >= 300:
                    self._load_keys(now)
                keys = [key for key in self._keys if key.key_id == header["kid"] and key.algorithm_name == "RS256" and key.public_key_use in (None, "sig")]
                if not keys and now - self._loaded_at >= 30:
                    self._load_keys(now)
                    keys = [key for key in self._keys if key.key_id == header["kid"] and key.algorithm_name == "RS256" and key.public_key_use in (None, "sig")]
            if len(keys) != 1:
                raise ManagedIdentityInvalid("Unknown or ambiguous signing key")
            claims = jwt.decode(token, keys[0].key, algorithms=["RS256"], issuer=self.issuer, audience="akl-api", options={"require": ["sub", "iss", "aud", "iat", "exp"]})
            issued, expires = claims["iat"], claims["exp"]
            if type(issued) is not int or type(expires) is not int or expires <= now or issued > now or not 0 < expires - issued <= 300:
                raise ManagedIdentityInvalid("Invalid token lifetime")
            return claims
        except jwt.PyJWTError as exc:
            raise ManagedIdentityInvalid("Invalid managed bearer token") from exc


@lru_cache(maxsize=8)
def managed_verifier(issuer: str, approved: str) -> ManagedOidcVerifier:
    return ManagedOidcVerifier(issuer, approved)
