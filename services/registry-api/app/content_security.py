from __future__ import annotations

import base64
import hashlib
import hmac
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


class ContentSecurityAttestationError(ValueError):
    pass


@dataclass(frozen=True)
class ContentSecurityAttestation:
    status: str
    engine: str
    engine_version: str | None
    signature_version: str | None
    scanned_at: datetime
    receipt_sha256: str


def verify_content_security_attestation(
    receipt: str | None,
    *,
    signing_secret: str | None,
    required: bool,
    document_id: str,
    source_file_uri: str,
    filename: str | None,
    mime_type: str | None,
    size_bytes: int | None,
    sha256: str | None,
) -> ContentSecurityAttestation | None:
    if not receipt:
        if required:
            raise ContentSecurityAttestationError(
                "A clean AKB Document Intake attestation is required"
            )
        return None
    if not signing_secret:
        raise ContentSecurityAttestationError(
            "The Document Intake attestation verifier is not configured"
        )

    encoded, separator, supplied_signature = receipt.partition(".")
    if not separator or not encoded or not supplied_signature:
        raise ContentSecurityAttestationError(
            "The Document Intake attestation format is invalid"
        )
    expected_signature = _base64url(
        hmac.new(
            signing_secret.encode("utf-8"),
            f"akl-upload-receipt-1:{encoded}".encode("utf-8"),
            hashlib.sha256,
        ).digest()
    )
    if not hmac.compare_digest(expected_signature, supplied_signature):
        raise ContentSecurityAttestationError(
            "The Document Intake attestation signature is invalid"
        )

    payload = _decode_payload(encoded)
    if payload.get("schema_version") != "akb-document-intake-receipt-1":
        raise ContentSecurityAttestationError(
            "A legacy upload receipt cannot attest content security"
        )
    expected_claims: dict[str, Any] = {
        "document_id": document_id,
        "source_file_uri": source_file_uri,
        "file_name": filename,
        "file_type": mime_type,
        "file_size": size_bytes,
        "sha256": sha256,
    }
    mismatches = [
        name
        for name, expected in expected_claims.items()
        if expected is None or payload.get(name) != expected
    ]
    if mismatches:
        raise ContentSecurityAttestationError(
            "The Document Intake attestation does not match the immutable file: "
            + ", ".join(sorted(mismatches))
        )

    expires_at = _parse_timestamp(payload.get("expires_at"), "expires_at")
    if expires_at <= datetime.now(timezone.utc):
        raise ContentSecurityAttestationError(
            "The Document Intake attestation has expired"
        )
    content_security = payload.get("content_security")
    if not isinstance(content_security, dict):
        raise ContentSecurityAttestationError(
            "The Document Intake attestation has no content security result"
        )
    status = content_security.get("status")
    engine = content_security.get("engine")
    if status not in {"clean", "not_performed"} or engine not in {
        "clamav",
        "disabled",
    }:
        raise ContentSecurityAttestationError(
            "The Document Intake content security result is invalid"
        )
    if required and (status != "clean" or engine != "clamav"):
        raise ContentSecurityAttestationError(
            "The document was not confirmed clean by the required scanner"
        )
    scanned_at = _parse_timestamp(content_security.get("scanned_at"), "scanned_at")
    return ContentSecurityAttestation(
        status=status,
        engine=engine,
        engine_version=_optional_string(content_security.get("engine_version")),
        signature_version=_optional_string(
            content_security.get("signature_version")
        ),
        scanned_at=scanned_at,
        receipt_sha256="sha256:" + hashlib.sha256(receipt.encode("utf-8")).hexdigest(),
    )


def _decode_payload(encoded: str) -> dict[str, Any]:
    try:
        padding = "=" * (-len(encoded) % 4)
        decoded = base64.urlsafe_b64decode(encoded + padding)
        payload = json.loads(decoded)
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ContentSecurityAttestationError(
            "The Document Intake attestation payload is invalid"
        ) from exc
    if not isinstance(payload, dict):
        raise ContentSecurityAttestationError(
            "The Document Intake attestation payload must be an object"
        )
    return payload


def _parse_timestamp(value: object, field: str) -> datetime:
    if not isinstance(value, str):
        raise ContentSecurityAttestationError(
            f"The Document Intake {field} timestamp is invalid"
        )
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ContentSecurityAttestationError(
            f"The Document Intake {field} timestamp is invalid"
        ) from exc
    if parsed.tzinfo is None:
        raise ContentSecurityAttestationError(
            f"The Document Intake {field} timestamp must include a timezone"
        )
    return parsed.astimezone(timezone.utc)


def _base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _optional_string(value: object) -> str | None:
    return value if isinstance(value, str) and value else None
