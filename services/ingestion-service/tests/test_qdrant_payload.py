from __future__ import annotations

from app.config import load_settings
from app.schemas import Classification, DocumentChunk
from embeddings.client import EmbeddingClient
from indexers.qdrant import QdrantIndexer


def test_indexer_promotes_rag_filter_and_citation_fields(tmp_path) -> None:
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
        }
    )
    chunk = DocumentChunk(
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

    point = QdrantIndexer(settings)._point(chunk, [0.1, 0.2], embedding_model="mock-embedding")
    payload = point["payload"]

    assert payload["chunk_id"] == "chunk_test"
    assert payload["document_title"] == "Directive"
    assert payload["version_label"] == "1.0"
    assert payload["document_type"] == "directive"
    assert payload["status"] == "valid"
    assert payload["tags"] == ["phase02"]


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
