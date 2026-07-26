import base64
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

import pytest

from app.content_security import (
    ContentSecurityAttestationError,
    verify_content_security_attestation,
)


SECRET = "document-intake-test-secret-with-more-than-32-characters"


def _receipt(**overrides) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "schema_version": "akb-document-intake-receipt-1",
        "upload_token_sha256": f"sha256:{'1' * 64}",
        "session_id": "upl_test",
        "document_id": "doc_test",
        "bucket": "akl-documents",
        "object_key": "doc_test/source.pdf",
        "source_file_uri": "s3://akl-documents/doc_test/source.pdf",
        "file_name": "source.pdf",
        "file_size": 128,
        "file_type": "application/pdf",
        "sha256": f"sha256:{'a' * 64}",
        "persisted_at": now.isoformat(),
        "expires_at": (now + timedelta(minutes=15)).isoformat(),
        "content_security": {
            "status": "clean",
            "engine": "clamav",
            "engine_version": "1.4.3",
            "signature_version": "27632",
            "scanned_at": now.isoformat(),
            "duration_ms": 42,
        },
    }
    payload.update(overrides)
    encoded = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode("utf-8")
    ).decode("ascii").rstrip("=")
    signature = base64.urlsafe_b64encode(
        hmac.new(
            SECRET.encode("utf-8"),
            f"akl-upload-receipt-1:{encoded}".encode("utf-8"),
            hashlib.sha256,
        ).digest()
    ).decode("ascii").rstrip("=")
    return f"{encoded}.{signature}"


def _verify(receipt: str | None, **overrides):
    claims = {
        "signing_secret": SECRET,
        "required": True,
        "document_id": "doc_test",
        "source_file_uri": "s3://akl-documents/doc_test/source.pdf",
        "filename": "source.pdf",
        "mime_type": "application/pdf",
        "size_bytes": 128,
        "sha256": f"sha256:{'a' * 64}",
    }
    claims.update(overrides)
    return verify_content_security_attestation(receipt, **claims)


def test_accepts_exact_clean_signed_attestation():
    receipt = _receipt()
    result = _verify(receipt)

    assert result is not None
    assert result.status == "clean"
    assert result.engine == "clamav"
    assert result.engine_version == "1.4.3"
    assert result.signature_version == "27632"
    assert result.receipt_sha256 == (
        "sha256:" + hashlib.sha256(receipt.encode("utf-8")).hexdigest()
    )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("document_id", "doc_other"),
        ("source_file_uri", "s3://akl-documents/doc_other/source.pdf"),
        ("filename", "other.pdf"),
        ("mime_type", "text/plain"),
        ("size_bytes", 129),
        ("sha256", f"sha256:{'b' * 64}"),
    ],
)
def test_rejects_attestation_bound_to_different_file(field, value):
    with pytest.raises(ContentSecurityAttestationError, match="does not match"):
        _verify(_receipt(), **{field: value})


def test_rejects_tampered_signature_and_non_clean_result():
    receipt = _receipt()
    with pytest.raises(ContentSecurityAttestationError, match="signature"):
        _verify(receipt[:-1] + ("x" if receipt[-1] != "x" else "y"))

    unsafe = _receipt(
        content_security={
            "status": "not_performed",
            "engine": "disabled",
            "engine_version": None,
            "signature_version": None,
            "scanned_at": datetime.now(timezone.utc).isoformat(),
            "duration_ms": 0,
        }
    )
    with pytest.raises(ContentSecurityAttestationError, match="not confirmed clean"):
        _verify(unsafe)


def test_allows_missing_attestation_only_before_required_rollout():
    assert _verify(None, required=False) is None
    with pytest.raises(ContentSecurityAttestationError, match="required"):
        _verify(None)
