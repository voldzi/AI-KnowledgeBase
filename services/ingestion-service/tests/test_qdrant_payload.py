from __future__ import annotations

import pytest

from app.config import load_settings
from app.errors import IngestionError
from app.schemas import Classification, DocumentChunk
from embeddings.client import EmbeddingClient
from indexers.qdrant import QdrantIndexer


def _settings(tmp_path, extra: dict[str, str] | None = None):
    settings = load_settings(
        {
            "AKL_ENV": "test",
            "AKL_AUTH_MODE": "disabled",
            "AKL_INGESTION_REGISTRY_CLIENT_MODE": "mock",
            "AKL_INGESTION_OBJECT_STORAGE_MODE": "local",
            "AKL_OBJECT_STORAGE_ROOT": str(tmp_path),
            "AKL_INGESTION_EMBEDDING_CLIENT_MODE": "mock",
            "AKL_INGESTION_INDEXER_MODE": "mock",
            "AKL_INGESTION_JOB_STORE_PATH": str(tmp_path / "jobs"),
            **(extra or {}),
        }
    )

    return settings


def _chunk() -> DocumentChunk:
    return DocumentChunk(
        chunk_id="chunk_test",
        document_id="doc_test",
        document_version_id="ver_test",
        document_title="Directive",
        version_label="1.0",
        document_type="directive",
        text="The owner approves the exception.",
        normalized_text="the owner approves the exception.",
        page_number=1,
        section_path=["Article 4"],
        section_title="Exception approvals",
        article_number="4",
        paragraph_number=None,
        source_file_uri="s3://akl-documents/doc_test/ver_test/source.md",
        source_file_name="source.md",
        source_mime_type="text/markdown",
        source_size_bytes=1234,
        source_sha256="sha256:" + "b" * 64,
        char_start=0,
        char_end=33,
        text_hash="sha256:" + "a" * 64,
        classification=Classification.internal,
        tags=["phase02"],
        valid_from=None,
        valid_to=None,
        status="valid",
        access_scope=["role:reader"],
        metadata={},
    )


def test_indexer_promotes_rag_filter_and_citation_fields(tmp_path) -> None:
    settings = _settings(tmp_path)
    point = QdrantIndexer(settings)._point(_chunk(), [0.1, 0.2], embedding_model="mock-embedding")
    payload = point["payload"]

    assert payload["chunk_id"] == "chunk_test"
    assert payload["document_title"] == "Directive"
    assert payload["version_label"] == "1.0"
    assert payload["document_type"] == "directive"
    assert payload["status"] == "valid"
    assert payload["tags"] == ["phase02"]
    assert payload["source_file_uri"] == "s3://akl-documents/doc_test/ver_test/source.md"
    assert payload["source_file_name"] == "source.md"
    assert payload["source_mime_type"] == "text/markdown"
    assert payload["source_size_bytes"] == 1234


@pytest.mark.asyncio
async def test_qdrant_indexer_creates_missing_collection_with_phase_02_vector_config(tmp_path, monkeypatch) -> None:
    settings = _settings(
        tmp_path,
        {
            "AKL_INGESTION_INDEXER_MODE": "qdrant",
            "AKL_QDRANT_VECTOR_SIZE": "1024",
            "AKL_QDRANT_DISTANCE": "Cosine",
        },
    )
    fake_client = _FakeAsyncClient(
        get_responses=[_FakeResponse(404)],
        put_responses=[_FakeResponse(200)],
    )
    monkeypatch.setattr("indexers.qdrant.httpx.AsyncClient", lambda **_: fake_client)

    await QdrantIndexer(settings)._ensure_collection(1024)

    assert fake_client.put_calls == [
        {
            "url": "http://localhost:6333/collections/akl_document_chunks",
            "json": {"vectors": {"size": 1024, "distance": "Cosine"}},
        }
    ]


@pytest.mark.asyncio
async def test_qdrant_indexer_rejects_existing_collection_with_wrong_vector_size(tmp_path, monkeypatch) -> None:
    settings = _settings(tmp_path, {"AKL_INGESTION_INDEXER_MODE": "qdrant"})
    fake_client = _FakeAsyncClient(
        get_responses=[
            _FakeResponse(
                200,
                {
                    "result": {
                        "config": {
                            "params": {
                                "vectors": {
                                    "size": 8,
                                    "distance": "Cosine",
                                }
                            }
                        }
                    }
                },
            )
        ],
    )
    monkeypatch.setattr("indexers.qdrant.httpx.AsyncClient", lambda **_: fake_client)

    with pytest.raises(IngestionError) as exc:
        await QdrantIndexer(settings)._ensure_collection(1024)

    assert exc.value.code == "QDRANT_COLLECTION_VECTOR_SIZE_MISMATCH"
    assert exc.value.details["existing_vector_size"] == 8
    assert exc.value.details["configured_vector_size"] == 1024


@pytest.mark.asyncio
async def test_qdrant_indexer_rejects_mock_embedding_dimension_in_real_profile(tmp_path) -> None:
    settings = _settings(tmp_path, {"AKL_INGESTION_INDEXER_MODE": "qdrant"})

    with pytest.raises(IngestionError) as exc:
        await QdrantIndexer(settings).index(
            chunks=[_chunk()],
            vectors=[[0.1] * 8],
            embedding_model="mock-embedding",
        )

    assert exc.value.code == "QDRANT_VECTOR_SIZE_MISMATCH"
    assert exc.value.details["configured_vector_size"] == 1024
    assert exc.value.details["actual_vector_sizes"] == [8]
    assert exc.value.details["embedding_model"] == "mock-embedding"


def test_embedding_client_accepts_llm_gateway_api_base_url(tmp_path) -> None:
    settings = load_settings(
        {
            "AKL_ENV": "test",
            "AKL_AUTH_MODE": "disabled",
            "AKL_INGESTION_REGISTRY_CLIENT_MODE": "mock",
            "AKL_INGESTION_OBJECT_STORAGE_MODE": "local",
            "AKL_OBJECT_STORAGE_ROOT": str(tmp_path),
            "AKL_INGESTION_EMBEDDING_CLIENT_MODE": "mock",
            "AKL_INGESTION_INDEXER_MODE": "mock",
            "AKL_INGESTION_JOB_STORE_PATH": str(tmp_path / "jobs"),
            "AKL_LLM_GATEWAY_BASE_URL": "http://llm-gateway-service:8080/api/v1",
        }
    )

    client = EmbeddingClient(settings)

    assert client._api_base_url() == "http://llm-gateway-service:8080/api/v1"
    assert client._service_base_url() == "http://llm-gateway-service:8080"


def test_embedding_profile_dimensions_map_is_parsed(tmp_path) -> None:
    settings = _settings(
        tmp_path,
        {
            "AKL_INGESTION_DEFAULT_EMBEDDING_MODEL": "qwen3-embedding:8b",
            "AKL_INGESTION_DEFAULT_EMBEDDING_DIMENSIONS": "1024",
            "AKL_INGESTION_EMBEDDING_PROFILE_MODEL_MAP": '{"qwen3_enterprise":"qwen3-embedding:8b"}',
            "AKL_INGESTION_EMBEDDING_PROFILE_DIMENSIONS_MAP": '{"qwen3_enterprise":1024}',
        },
    )
    client = EmbeddingClient(settings)

    assert settings.default_embedding_dimensions == 1024
    assert client._model_for_profile("qwen3_enterprise") == "qwen3-embedding:8b"
    assert client._dimensions_for_profile("qwen3_enterprise") == 1024


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict | None = None) -> None:
        self.status_code = status_code
        self._payload = payload or {}

    def json(self) -> dict:
        return self._payload


class _FakeAsyncClient:
    def __init__(
        self,
        *,
        get_responses: list[_FakeResponse] | None = None,
        put_responses: list[_FakeResponse] | None = None,
    ) -> None:
        self.get_responses = get_responses or []
        self.put_responses = put_responses or []
        self.put_calls: list[dict] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def get(self, *_args, **_kwargs) -> _FakeResponse:
        return self.get_responses.pop(0)

    async def put(self, url: str, *, json: dict, **_kwargs) -> _FakeResponse:
        self.put_calls.append({"url": url, "json": json})
        return self.put_responses.pop(0)
