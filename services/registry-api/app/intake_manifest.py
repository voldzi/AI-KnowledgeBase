"""Signed expiry evidence shared with the web intake writer and operator CLI."""
import base64
import hashlib
import hmac
import json
import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

DOMAIN = b"akb-intake-manifest-1\0"
MAX_MANIFEST_BYTES = 16384


class IntakeManifest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    schema_version: str
    kid: str = Field(pattern=r"^[a-f0-9]{16}$")
    session_id: str = Field(pattern=r"^upl_[a-f0-9]{32}$")
    document_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,160}$")
    bucket: str = Field(pattern=r"^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$")
    object_key: str = Field(min_length=1, max_length=1000)
    source_file_uri: str = Field(min_length=1, max_length=1024)
    file_name: str = Field(pattern=r"^[A-Za-z0-9_-][A-Za-z0-9._-]*$", max_length=512)
    file_size: int = Field(gt=0, le=1073741824)
    sha256: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    expires_at: str

    @field_validator("expires_at")
    @classmethod
    def expiry_is_aware(cls, value):
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError("Manifest expiry requires a timezone")
        return value

    @model_validator(mode="after")
    def coordinates(self):
        prefix = f"{self.document_id}/draft/"
        suffix = f"/{self.session_id}/{self.file_name}"
        if (self.schema_version != "akb-intake-manifest-1"
            or not self.object_key.startswith(prefix) or not self.object_key.endswith(suffix)
            or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", self.object_key[len(prefix):-len(suffix)])
            or self.source_file_uri != f"s3://{self.bucket}/{self.object_key}"):
            raise ValueError("Manifest coordinates do not describe the exact intake object")
        return self

    @property
    def expiry(self):
        return datetime.fromisoformat(self.expires_at.replace("Z", "+00:00"))


def signing_keys(current_secret: str | None, retired_keys_json: str | None = None):
    keys = {}
    if retired_keys_json:
        parsed = json.loads(retired_keys_json)
        if not isinstance(parsed, dict) or len(parsed) > 16:
            raise ValueError("Invalid intake manifest verification keyring")
        for kid, secret in parsed.items():
            if not isinstance(secret, str) or len(secret) < 32 or key_id(secret) != kid:
                raise ValueError("Invalid intake manifest verification key")
            keys[kid] = secret
    if current_secret:
        if len(current_secret) < 32:
            raise ValueError("Intake manifest signing key must have at least 32 characters")
        keys[key_id(current_secret)] = current_secret
    if not keys:
        raise ValueError("Intake manifest verification is not configured")
    return keys


def key_id(secret):
    return hashlib.sha256(secret.encode()).hexdigest()[:16]


def _no_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate manifest field")
        result[key] = value
    return result


def verify_manifest(token: str, keys: dict[str, str]) -> IntakeManifest:
    if len(token) > MAX_MANIFEST_BYTES or not re.fullmatch(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}", token):
        raise ValueError("Malformed intake manifest")
    encoded, signature = token.split(".")
    data = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
    payload = json.loads(data, object_pairs_hook=_no_duplicate_keys)
    if not isinstance(payload, dict) or payload.get("kid") not in keys:
        raise ValueError("Intake manifest signing key is unknown")
    expected = base64.urlsafe_b64encode(hmac.digest(keys[payload["kid"]].encode(), DOMAIN + encoded.encode(), "sha256")).decode().rstrip("=")
    if not hmac.compare_digest(expected, signature):
        raise ValueError("Intake manifest signature is invalid")
    return IntakeManifest.model_validate(payload)


def manifest_digest(token):
    return hashlib.sha256(token.encode()).hexdigest()
