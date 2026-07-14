from __future__ import annotations

import asyncio

import httpx
import pytest

import app.registry_client as registry_client_module
from app.config import load_settings
from app.errors import IngestionError
from app.registry_client import RegistryClient
from app.security import AuthContext
from embeddings.client import EmbeddingClient


def _http_registry_settings(tmp_path):
    secret_file = tmp_path / "svc-ingestion-client-secret"
    secret_file.write_text("registry-client-secret\n", encoding="utf-8")
    return load_settings(
        {
            "AKL_ENV": "test",
            "AKL_AUTH_MODE": "oidc",
            "AKL_OIDC_ISSUER": "https://login.example/realms/stratos",
            "AKL_OIDC_AUDIENCE": "akl-api",
            "AKL_OIDC_JWKS_URL": "https://login.example/realms/stratos/certs",
            "AKL_SERVICE_ACCOUNT_SUBJECT": "svc-ingestion",
            "AKL_SERVICE_ACCOUNT_ROLES": "service_ingestion",
            "AKL_INGESTION_REGISTRY_CLIENT_MODE": "http",
            "AKL_REGISTRY_API_BASE_URL": "https://registry.example",
            "AKL_REGISTRY_SERVICE_TOKEN_URL": "https://login.example/token",
            "AKL_REGISTRY_SERVICE_CLIENT_ID": "svc-ingestion",
            "AKL_REGISTRY_SERVICE_CLIENT_SECRET_FILE": str(secret_file),
            "AKL_INGESTION_OBJECT_STORAGE_MODE": "local",
            "AKL_OBJECT_STORAGE_ROOT": str(tmp_path),
            "AKL_INGESTION_EMBEDDING_CLIENT_MODE": "mock",
            "AKL_INGESTION_INDEXER_MODE": "mock",
            "AKL_INGESTION_JOB_STORE_PATH": str(tmp_path / "jobs"),
        }
    )


def test_registry_headers_never_reuse_caller_bearer(tmp_path) -> None:
    settings = _http_registry_settings(tmp_path)
    auth_context = AuthContext(
        subject_id="service-account-aiip-service",
        roles=("service_aiip",),
        groups=(),
        bearer_token="aiip-caller-token",
        service_identity=True,
    )

    headers = RegistryClient(settings)._headers(
        auth_context,
        registry_service_token="ingestion-registry-token",
    )

    assert headers["Authorization"] == "Bearer ingestion-registry-token"
    assert "aiip-caller-token" not in headers.values()
    assert "X-AKL-Subject" not in headers
    assert "X-AKL-Roles" not in headers
    assert "X-STRATOS-Capabilities" not in headers


def test_registry_pipeline_transport_uses_cached_internal_service_identity(
    tmp_path,
    monkeypatch,
) -> None:
    settings = _http_registry_settings(tmp_path)
    token_calls = 0
    registry_calls: list[dict[str, object]] = []

    class Response:
        def __init__(self, payload: dict[str, object], status_code: int = 200) -> None:
            self._payload = payload
            self.status_code = status_code

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return self._payload

    class Client:
        def __init__(self, **_kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, url, **kwargs):
            nonlocal token_calls
            if url == settings.registry_service_token_url:
                token_calls += 1
                assert kwargs["data"] == {
                    "grant_type": "client_credentials",
                    "client_id": "svc-ingestion",
                    "client_secret": "registry-client-secret",
                }
                return Response(
                    {"access_token": "ingestion-registry-token", "expires_in": 300}
                )
            registry_calls.append({"method": "POST", "url": url, **kwargs})
            if url.endswith("/api/v1/authz/check"):
                return Response({"allowed": True, "reason": "allowed"})
            return Response({"audit_event_id": "audit-ingestion-1"}, status_code=201)

        async def get(self, url, **kwargs):
            registry_calls.append({"method": "GET", "url": url, **kwargs})
            if url.endswith("/ready"):
                return Response({"status": "ready"})
            if url.endswith("/versions/ver-aiip-1"):
                return Response(
                    {
                        "version_label": "AIIP v1",
                        "status": "valid",
                        "organization_id": "org_stratos",
                        "policy_binding_id": "pb_aiip_12345678",
                        "policy_version": "information-policy-2.0.0",
                        "policy_hash": "sha256:" + "a" * 64,
                        "policy_summary": {"handlingClass": "INTERNAL"},
                    }
                )
            return Response(
                {
                    "title": "AIIP request",
                    "document_type": "ai_intake",
                    "status": "valid",
                    "classification": "internal",
                    "tags": ["aiip"],
                    "metadata": {
                        "external": {
                            "tenant_id": "org_stratos",
                            "external_system": "STRATOS_AIIP",
                            "external_ref": "aiip:idea:1:requirement-card",
                        }
                    },
                    "access_policies": [],
                }
            )

        async def patch(self, url, **kwargs):
            registry_calls.append({"method": "PATCH", "url": url, **kwargs})
            return Response({"document_id": "doc-aiip-1", "updated": 1, "items": []})

    monkeypatch.setattr(registry_client_module.httpx, "AsyncClient", Client)
    caller = AuthContext(
        subject_id="service-account-aiip-service",
        roles=("service_aiip",),
        groups=(),
        bearer_token="aiip-caller-token",
        service_identity=True,
    )
    client = RegistryClient(settings)

    async def exercise_pipeline_registry_calls() -> None:
        assert await client.readiness() == "ready"
        await client.require_authorized(
            subject_id=caller.subject_id,
            action="document.ingest",
            document_id="doc-aiip-1",
            document_version_id="ver-aiip-1",
            auth_context=caller,
        )
        metadata = await client.get_document_metadata(
            "doc-aiip-1",
            "ver-aiip-1",
            auth_context=caller,
        )
        assert metadata.external_system == "STRATOS_AIIP"
        await client.update_external_document_current(
            document_id="doc-aiip-1",
            document_version_id="ver-aiip-1",
            ingestion_job_id="ing-aiip-1",
            ingestion_status="INDEXED",
            auth_context=caller,
        )
        await client.write_audit_event(
            actor_id=caller.subject_id,
            event_type="ingestion.job.completed",
            resource_id="ing-aiip-1",
            auth_context=caller,
        )

    asyncio.run(exercise_pipeline_registry_calls())

    assert token_calls == 1
    assert len(registry_calls) == 6
    assert all(
        call["headers"]["Authorization"] == "Bearer ingestion-registry-token"  # type: ignore[index]
        for call in registry_calls
    )
    assert "aiip-caller-token" not in repr(registry_calls)

    authz_call = next(call for call in registry_calls if str(call["url"]).endswith("/authz/check"))
    assert authz_call["json"]["subject_id"] == caller.subject_id  # type: ignore[index]
    assert "roles" not in authz_call["json"]  # type: ignore[operator]
    assert "capabilities" not in authz_call["json"]  # type: ignore[operator]

    status_call = next(call for call in registry_calls if call["method"] == "PATCH")
    assert status_call["json"] == {
        "current_document_version_id": "ver-aiip-1",
        "current_ingestion_job_id": "ing-aiip-1",
        "current_ingestion_status": "INDEXED",
    }
    audit_call = next(call for call in registry_calls if str(call["url"]).endswith("/audit/events"))
    assert audit_call["json"]["actor_id"] == caller.subject_id  # type: ignore[index]


def test_registry_service_identity_failure_never_falls_back_to_caller(
    tmp_path,
    monkeypatch,
) -> None:
    settings = _http_registry_settings(tmp_path)
    attempted_urls: list[str] = []

    class Client:
        def __init__(self, **_kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, url, **_kwargs):
            attempted_urls.append(url)
            raise httpx.ConnectError("offline", request=httpx.Request("POST", url))

    monkeypatch.setattr(registry_client_module.httpx, "AsyncClient", Client)
    caller = AuthContext(
        subject_id="service-account-aiip-service",
        roles=("service_aiip",),
        groups=(),
        bearer_token="aiip-caller-token",
        service_identity=True,
    )
    client = RegistryClient(settings)

    with pytest.raises(IngestionError) as exc_info:
        asyncio.run(
            client.require_authorized(
                subject_id=caller.subject_id,
                action="document.ingest",
                document_id="doc-aiip-1",
                auth_context=caller,
            )
        )

    assert exc_info.value.code == "REGISTRY_SERVICE_AUTH_UNAVAILABLE"
    assert attempted_urls == [settings.registry_service_token_url]
    assert asyncio.run(client.readiness()) == "not_ready"


def test_registry_service_identity_rejects_expired_token_response(
    tmp_path,
    monkeypatch,
) -> None:
    settings = _http_registry_settings(tmp_path)

    class Response:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {"access_token": "already-expired-token", "expires_in": 0}

    class Client:
        def __init__(self, **_kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, _url, **_kwargs):
            return Response()

    monkeypatch.setattr(registry_client_module.httpx, "AsyncClient", Client)

    with pytest.raises(IngestionError) as exc_info:
        asyncio.run(RegistryClient(settings)._registry_service_token())

    assert exc_info.value.code == "REGISTRY_SERVICE_AUTH_INVALID"


def test_local_registry_headers_keep_caller_only_as_on_behalf_of_context(tmp_path) -> None:
    settings = load_settings(
        {
            "AKL_ENV": "test",
            "AKL_AUTH_MODE": "mock",
            "AKL_SERVICE_ACCOUNT_SUBJECT": "svc-ingestion",
            "AKL_SERVICE_ACCOUNT_ROLES": "service_ingestion",
            "AKL_INGESTION_REGISTRY_CLIENT_MODE": "http",
            "AKL_INGESTION_OBJECT_STORAGE_MODE": "local",
            "AKL_OBJECT_STORAGE_ROOT": str(tmp_path),
            "AKL_INGESTION_EMBEDDING_CLIENT_MODE": "mock",
            "AKL_INGESTION_INDEXER_MODE": "mock",
            "AKL_INGESTION_JOB_STORE_PATH": str(tmp_path / "jobs"),
        }
    )
    auth_context = AuthContext(
        subject_id="service-account-aiip-service",
        roles=("service_aiip",),
        groups=(),
        bearer_token="aiip-caller-token",
        service_identity=True,
    )

    headers = RegistryClient(settings)._headers(auth_context)

    assert "Authorization" not in headers
    assert headers["X-AKL-Subject"] == "service-account-svc-ingestion"
    assert headers["X-AKL-Service-Client-ID"] == "svc-ingestion"
    assert headers["X-AKL-Roles"] == "service_ingestion"
    assert headers["X-AKL-On-Behalf-Of"] == auth_context.subject_id


def test_embedding_headers_use_gateway_service_identity_instead_of_caller_token(tmp_path) -> None:
    settings = load_settings(
        {
            "AKL_ENV": "test",
            "AKL_AUTH_MODE": "oidc",
            "AKL_SERVICE_ACCOUNT_SUBJECT": "svc-ingestion",
            "AKL_SERVICE_ACCOUNT_ROLES": "service_ingestion,document_manager",
            "AKL_LLM_GATEWAY_TOKEN": "gateway-token",
            "AKL_LLM_GATEWAY_AUDIENCE": "llm-gateway-service",
            "AKL_INGESTION_REGISTRY_CLIENT_MODE": "mock",
            "AKL_INGESTION_OBJECT_STORAGE_MODE": "local",
            "AKL_OBJECT_STORAGE_ROOT": str(tmp_path),
            "AKL_INGESTION_EMBEDDING_CLIENT_MODE": "http",
            "AKL_INGESTION_INDEXER_MODE": "mock",
            "AKL_INGESTION_JOB_STORE_PATH": str(tmp_path / "jobs"),
        }
    )
    caller = AuthContext(
        subject_id="aiip-service",
        roles=("stratos_service",),
        groups=(),
        bearer_token="caller-oidc-token",
    )

    headers = EmbeddingClient(settings)._headers(caller)

    assert headers["Authorization"] == "Bearer gateway-token"
    assert headers["X-AKL-Subject"] == "svc-ingestion"
    assert headers["X-AKL-Roles"] == "service_ingestion,document_manager"
    assert headers["X-AKL-Audience"] == "llm-gateway-service"
    assert headers["X-AKL-On-Behalf-Of"] == "aiip-service"
