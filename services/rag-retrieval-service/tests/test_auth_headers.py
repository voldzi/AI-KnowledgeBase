from __future__ import annotations

from app.config import load_settings
from app.http_utils import outgoing_headers
from app.security import AuthContext


def test_outgoing_headers_prefer_upstream_token_for_audit() -> None:
    settings = load_settings(
        {
            "AKL_ENV": "test",
            "AKL_AUTH_MODE": "oidc",
            "AKL_UPSTREAM_BEARER_TOKEN": "svc-token",
            "AKL_SERVICE_ACCOUNT_SUBJECT": "svc-rag",
            "AKL_SERVICE_ACCOUNT_ROLES": "service_rag",
            "AKL_RAG_DEPENDENCY_MODE": "mock",
        }
    )
    auth_context = AuthContext(
        subject_id="user_123",
        roles=("reader",),
        groups=(),
        bearer_token="user-token",
    )

    headers = outgoing_headers(settings, auth_context, prefer_upstream_token=True)

    assert headers["Authorization"] == "Bearer svc-token"
    assert headers["X-AKL-Subject"] == "svc-rag"
    assert headers["X-AKL-Roles"] == "service_rag"
