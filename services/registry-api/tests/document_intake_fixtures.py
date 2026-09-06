"""Explicit signed intake receipts for local tests, without scanner/authority bypass."""
import base64
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

INTAKE_SECRET = "budget-replay-test-intake-secret-more-than-32-characters"


def _intake_receipt(document_id: str, payload: dict, *, session: str) -> str:
    now = datetime.now(timezone.utc)
    receipt = {
        "schema_version": "akb-document-intake-receipt-1",
        "document_id": document_id,
        "session_id": session,
        "source_file_uri": payload["source_file_uri"],
        "file_name": payload["file"]["filename"],
        "file_type": payload["file"]["mime_type"],
        "file_size": payload["file"]["size_bytes"],
        "sha256": payload["file"]["sha256"],
        "expires_at": (now + timedelta(minutes=15)).isoformat(),
        "content_security": {
            "status": "clean", "engine": "clamav", "engine_version": "1.4.3",
            "signature_version": "27632", "scanned_at": now.isoformat(),
        },
    }
    encoded = base64.urlsafe_b64encode(json.dumps(receipt).encode()).decode().rstrip("=")
    signature = base64.urlsafe_b64encode(hmac.new(
        INTAKE_SECRET.encode(), f"akl-upload-receipt-1:{encoded}".encode(), hashlib.sha256
    ).digest()).decode().rstrip("=")
    return f"{encoded}.{signature}"
