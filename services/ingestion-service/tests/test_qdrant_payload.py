from __future__ import annotations

import httpx
import pytest

from app.config import load_settings
from app.errors import IngestionError
from app.schemas import AnalystSearchRequest, Classification, DocumentChunk, EntityRelationshipRequest, EntitySearchRequest
from embeddings.client import EmbeddingClient
from indexers.factory import create_indexer
from indexers.opensearch import (
    CompositeIndexer,
    OpenSearchIndexer,
    _authorization_key,
    _authorized_policy_filter,
    _index_definition,
)
from indexers.qdrant import QdrantIndexer, _colbert_vectors, _v2_collection_vector_config


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
        organization_id="org_stratos",
        policy_binding_id="pol_testbinding01",
        policy_version="information-policy-2.0.0",
        policy_hash="sha256:" + "c" * 64,
        policy_summary={
            "handlingClass": "INTERNAL",
            "legalClassification": "NONE",
            "obligations": ["AUDIT_ACCESS"],
            "audience": {"organizationId": "org_stratos", "scopeType": "organization"},
        },
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
        metadata={
            "intelligence": {
                "entity_extraction_profile": "rule_based_v1",
                "entity_count": 2,
                "entity_types": ["document_number", "email"],
                "entity_values": ["RMO12/2024", "ops@example.cz"],
                "entity_pairs": ["document_number:RMO12/2024", "email:ops@example.cz"],
                "entities": [],
            }
        },
    )


def _authorized_document(
    *,
    document_id: str = "doc_allowed",
    document_version_id: str = "ver_1",
    policy_hash: str = "sha256:" + "c" * 64,
) -> dict[str, str]:
    return {
        "document_id": document_id,
        "document_version_id": document_version_id,
        "policy_hash": policy_hash,
    }


def test_indexer_promotes_rag_filter_and_citation_fields(tmp_path) -> None:
    settings = _settings(tmp_path)
    point = QdrantIndexer(settings)._point(_chunk(), [0.1, 0.2], embedding_model="mock-embedding")
    payload = point["payload"]

    assert payload["chunk_id"] == "chunk_test"
    assert payload["document_title"] == "Directive"
    assert payload["version_label"] == "1.0"
    assert payload["document_type"] == "directive"
    assert payload["policy_binding_id"] == "pol_testbinding01"
    assert payload["policy_hash"] == "sha256:" + "c" * 64
    assert payload["policy_summary"]["obligations"] == ["AUDIT_ACCESS"]
    assert payload["status"] == "valid"
    assert payload["tags"] == ["phase02"]
    assert payload["source_file_uri"] == "s3://akl-documents/doc_test/ver_test/source.md"
    assert payload["source_file_name"] == "source.md"
    assert payload["source_mime_type"] == "text/markdown"
    assert payload["source_size_bytes"] == 1234
    assert payload["entity_types"] == ["document_number", "email"]
    assert payload["entity_values"] == ["RMO12/2024", "ops@example.cz"]
    assert payload["entity_pairs"] == ["document_number:RMO12/2024", "email:ops@example.cz"]


def test_v2_point_uses_named_dense_vector_and_preserves_hashes(tmp_path) -> None:
    settings = _settings(tmp_path, {"AKL_RAG_V2_INDEX_MODE": "shadow"})
    point = QdrantIndexer(settings)._v2_point(
        _chunk(),
        [0.1, 0.2],
        embedding_model="bge-m3",
    )

    assert point["vector"] == {"dense_bge_m3": [0.1, 0.2]}
    assert point["payload"]["rag_index_version"] == "v2"
    assert point["payload"]["colbert_status"] == "pending_backfill"
    assert point["payload"]["text_hash"] == "sha256:" + "a" * 64


def test_v2_point_accepts_valid_colbert_multivector(tmp_path) -> None:
    settings = _settings(
        tmp_path,
        {
            "AKL_RAG_V2_INDEX_MODE": "shadow",
            "AKL_QDRANT_COLBERT_VECTOR_SIZE": "2",
        },
    )
    point = QdrantIndexer(settings)._v2_point(
        _chunk(),
        [0.1, 0.2],
        embedding_model="bge-m3",
        colbert_vector=[[0.1, 0.2], [0.3, 0.4]],
    )

    assert point["vector"]["colbert"] == [[0.1, 0.2], [0.3, 0.4]]
    assert point["payload"]["colbert_status"] == "indexed"


def test_colbert_response_requires_one_multivector_per_text() -> None:
    assert _colbert_vectors(
        {"vectors": [[[0.1, 0.2]], [[0.3, 0.4]]]},
        expected_count=2,
    ) == [[[0.1, 0.2]], [[0.3, 0.4]]]
    with pytest.raises(IngestionError, match="invalid batch"):
        _colbert_vectors({"vectors": [[[0.1, 0.2]]]}, expected_count=2)


def test_v2_collection_config_reads_named_vectors() -> None:
    assert _v2_collection_vector_config(
        {
            "result": {
                "config": {
                    "params": {
                        "vectors": {
                            "dense_bge_m3": {"size": 1024, "distance": "Cosine"},
                            "colbert": {
                                "size": 128,
                                "distance": "Cosine",
                                "multivector_config": {"comparator": "max_sim"},
                            },
                        }
                    }
                }
            }
        }
    ) == ((1024, "cosine"), (128, "cosine", "max_sim"))


def test_dual_indexer_mode_builds_composite_indexer(tmp_path) -> None:
    settings = _settings(tmp_path, {"AKL_INGESTION_INDEXER_MODE": "qdrant,opensearch"})

    indexer = create_indexer(settings)

    assert settings.indexer_targets == ("qdrant", "opensearch")
    assert isinstance(indexer, CompositeIndexer)


def test_opensearch_document_contains_search_text_and_citation_fields(tmp_path) -> None:
    settings = _settings(tmp_path, {"AKL_INGESTION_INDEXER_MODE": "qdrant,opensearch"})
    document = OpenSearchIndexer(settings)._document(_chunk(), embedding_model="mock-embedding")

    assert document["chunk_id"] == "chunk_test"
    assert document["document_title"] == "Directive"
    assert document["document_type"] == "directive"
    assert document["source_file_uri"] == "s3://akl-documents/doc_test/ver_test/source.md"
    assert document["embedding_model"] == "mock-embedding"
    assert document["entity_types"] == ["document_number", "email"]
    assert document["entity_values"] == ["RMO12/2024", "ops@example.cz"]
    assert document["entity_pairs"] == ["document_number:RMO12/2024", "email:ops@example.cz"]
    assert document["authorization_key"] == _authorization_key(
        "doc_test",
        "ver_test",
        "sha256:" + "c" * 64,
    )
    assert "Directive" in document["search_text"]
    assert "Exception approvals" in document["search_text"]
    assert "RMO12/2024" in document["search_text"]
    assert "document_number:RMO12/2024" in document["search_text"]


def test_opensearch_authorization_filter_binds_document_to_current_policy_hash() -> None:
    policy_hash = "sha256:" + "c" * 64
    result = _authorized_policy_filter(
        AnalystSearchRequest(
            query="directive",
            allowed_document_ids=["doc_allowed", "doc_without_policy"],
            allowed_policy_hashes={
                "doc_allowed": [policy_hash],
                "doc_other": ["sha256:" + "d" * 64],
                "doc_without_policy": ["invalid"],
            },
            authorized_documents=[_authorized_document(policy_hash=policy_hash)],
        )
    )

    assert result == {
        "terms": {
            "authorization_key": [
                _authorization_key("doc_allowed", "ver_1", policy_hash)
            ]
        }
    }
def test_opensearch_index_definition_uses_czech_analyzer() -> None:
    definition = _index_definition()

    analyzer = definition["settings"]["analysis"]["analyzer"]["akb_czech"]
    assert "asciifolding" in analyzer["filter"]
    assert "akb_czech_stemmer" in analyzer["filter"]
    assert definition["mappings"]["properties"]["search_text"]["analyzer"] == "akb_czech"
    assert definition["mappings"]["properties"]["entity_types"]["type"] == "keyword"
    assert definition["mappings"]["properties"]["entity_values"]["type"] == "keyword"
    assert definition["mappings"]["properties"]["entity_pairs"]["type"] == "keyword"
    assert definition["mappings"]["properties"]["authorization_key"]["type"] == "keyword"


def test_opensearch_client_uses_ca_and_basic_auth(tmp_path, monkeypatch) -> None:
    password_file = tmp_path / "opensearch.password"
    password_file.write_text("writer-secret\n", encoding="utf-8")
    ca_file = tmp_path / "opensearch-ca.pem"
    ca_file.write_text("test-ca\n", encoding="utf-8")
    settings = _settings(
        tmp_path,
        {
            "AKL_INGESTION_INDEXER_MODE": "opensearch",
            "AKL_OPENSEARCH_USERNAME": "writer",
            "AKL_OPENSEARCH_PASSWORD_FILE": str(password_file),
            "AKL_OPENSEARCH_CA_FILE": str(ca_file),
        },
    )
    captured: dict = {}
    sentinel = object()

    monkeypatch.setattr(
        "indexers.opensearch._opensearch_tls_verifier",
        lambda value: sentinel if value == ca_file else None,
    )
    monkeypatch.setattr(
        "indexers.opensearch.httpx.AsyncClient",
        lambda **kwargs: captured.update(kwargs) or object(),
    )

    OpenSearchIndexer(settings)._client()

    assert captured["verify"] is sentinel
    assert isinstance(captured["auth"], httpx.BasicAuth)


@pytest.mark.asyncio
async def test_opensearch_readiness_fails_closed_for_bad_tls_or_auth(
    tmp_path,
    monkeypatch,
) -> None:
    settings = _settings(
        tmp_path,
        {"AKL_INGESTION_INDEXER_MODE": "opensearch"},
    )
    monkeypatch.setattr(
        "indexers.opensearch._opensearch_tls_verifier",
        lambda _value: (_ for _ in ()).throw(OSError("bad ca")),
    )
    assert await OpenSearchIndexer(settings).readiness() == "not_ready"

    fake_client = _FakeAsyncClient(get_responses=[_FakeResponse(401)])
    monkeypatch.setattr(
        "indexers.opensearch.OpenSearchIndexer._client",
        lambda _self: fake_client,
    )
    assert await OpenSearchIndexer(settings).readiness() == "not_ready"


@pytest.mark.asyncio
async def test_opensearch_existing_index_ensures_entity_mapping(tmp_path, monkeypatch) -> None:
    settings = _settings(tmp_path, {"AKL_INGESTION_INDEXER_MODE": "qdrant,opensearch"})
    fake_client = _FakeAsyncClient(
        get_responses=[_FakeResponse(200)],
        put_responses=[_FakeResponse(200)],
    )
    monkeypatch.setattr("indexers.opensearch.httpx.AsyncClient", lambda **_: fake_client)

    await OpenSearchIndexer(settings)._ensure_index()

    assert len(fake_client.put_calls) == 1
    call = fake_client.put_calls[0]
    assert call["url"] == "http://localhost:9200/akl_document_chunks/_mapping"
    properties = call["json"]["properties"]
    assert properties["entity_types"] == {"type": "keyword"}
    assert properties["entity_values"] == {"type": "keyword"}
    assert properties["entity_pairs"] == {"type": "keyword"}
    assert properties["authorization_key"] == {"type": "keyword"}
    assert properties["policy_binding_id"] == {"type": "keyword"}
    assert properties["policy_summary"]["properties"]["obligations"] == {"type": "keyword"}


@pytest.mark.asyncio
async def test_opensearch_entity_facets_aggregate_paired_values(tmp_path, monkeypatch) -> None:
    settings = _settings(tmp_path, {"AKL_INGESTION_INDEXER_MODE": "qdrant,opensearch"})
    fake_client = _FakeAsyncClient(
        get_responses=[_FakeResponse(200)],
        put_responses=[_FakeResponse(200)],
        post_responses=[
            _FakeResponse(
                200,
                {
                    "hits": {"total": {"value": 5}},
                    "aggregations": {
                        "chunks_with_entities": {"doc_count": 3},
                        "entity_types": {
                            "buckets": [
                                {"key": "document_number", "doc_count": 2},
                                {"key": "email", "doc_count": 1},
                            ]
                        },
                        "entity_pairs": {
                            "buckets": [
                                {"key": "document_number:RMO12/2024", "doc_count": 2},
                                {"key": "email:ops@example.cz", "doc_count": 1},
                            ]
                        },
                    },
                },
            )
        ],
    )
    monkeypatch.setattr("indexers.opensearch.httpx.AsyncClient", lambda **_: fake_client)

    report = await OpenSearchIndexer(settings).entity_facets(
        limit=8,
        value_limit=4,
        authorized_documents=[_authorized_document()],
    )

    assert report.status == "ready"
    assert report.total_chunks == 5
    assert report.chunks_with_entities == 3
    assert report.entity_types[0].key == "document_number"
    assert report.entity_groups[0].entity_type == "document_number"
    assert report.entity_groups[0].values[0].key == "RMO12/2024"
    assert fake_client.post_calls[0]["url"] == "http://localhost:9200/akl_document_chunks/_search"
    assert fake_client.post_calls[0]["json"]["query"] == _authorized_policy_filter(
        EntitySearchRequest(authorized_documents=[_authorized_document()])
    )


def test_opensearch_authorization_filter_requires_exact_version_and_policy_coordinate() -> None:
    policy_hash = "sha256:" + "c" * 64
    result = _authorized_policy_filter(
        EntitySearchRequest(
            query="directive",
            allowed_document_ids=["doc_allowed", "doc_stale"],
            allowed_policy_hashes={
                "doc_allowed": ["sha256:" + "d" * 64],
                "doc_stale": [policy_hash],
            },
            authorized_documents=[
                _authorized_document(
                    document_id="doc_allowed",
                    document_version_id="ver_current",
                    policy_hash=policy_hash,
                )
            ],
        )
    )

    assert result == {
        "terms": {
            "authorization_key": [
                _authorization_key("doc_allowed", "ver_current", policy_hash)
            ]
        }
    }
    assert "doc_stale" not in str(result)
    assert ("sha256:" + "d" * 64) not in str(result)


def test_opensearch_authorization_filter_uses_one_bounded_terms_clause() -> None:
    policy_hash = "sha256:" + "c" * 64
    authorized_documents = [
        _authorized_document(
            document_id=f"doc_{index:04d}",
            document_version_id=f"ver_{index:04d}",
            policy_hash=policy_hash,
        )
        for index in range(500)
    ]

    result = _authorized_policy_filter(
        EntitySearchRequest(authorized_documents=authorized_documents)
    )

    assert list(result) == ["terms"]
    assert len(result["terms"]["authorization_key"]) == 500
    assert "bool" not in result


@pytest.mark.asyncio
async def test_opensearch_entity_search_filters_authorized_documents_and_entity_pair(tmp_path, monkeypatch) -> None:
    settings = _settings(tmp_path, {"AKL_INGESTION_INDEXER_MODE": "qdrant,opensearch"})
    fake_client = _FakeAsyncClient(
        get_responses=[_FakeResponse(200)],
        put_responses=[_FakeResponse(200)],
        post_responses=[
            _FakeResponse(
                200,
                {
                    "hits": {
                        "total": {"value": 1},
                        "hits": [
                            {
                                "_score": 7.25,
                                "_source": {
                                    "chunk_id": "chunk_1",
                                    "document_id": "doc_allowed",
                                    "document_version_id": "ver_1",
                                    "document_title": "Directive",
                                    "version_label": "1.0",
                                    "document_type": "directive",
                                    "classification": "internal",
                                    "status": "valid",
                                    "text": "RMO 12/2024 assigns the action owner.",
                                    "page_number": 2,
                                    "section_title": "Article 4",
                                    "section_path": ["Chapter 1", "Article 4"],
                                    "source_file_name": "directive.pdf",
                                    "entity_types": ["document_number"],
                                    "entity_values": ["RMO12/2024"],
                                    "entity_pairs": ["document_number:RMO12/2024"],
                                },
                                "highlight": {"text": ["RMO 12/2024 assigns the action owner."]},
                            }
                        ],
                    }
                },
            )
        ],
    )
    monkeypatch.setattr("indexers.opensearch.httpx.AsyncClient", lambda **_: fake_client)

    report = await OpenSearchIndexer(settings).entity_search(
        EntitySearchRequest(
            query="action owner",
            entity_type="document_number",
            entity_value="RMO12/2024",
            allowed_document_ids=["doc_allowed", "doc_allowed"],
            authorized_documents=[_authorized_document()],
        )
    )

    assert report.status == "ready"
    assert report.total_hits == 1
    assert report.hits[0].chunk_id == "chunk_1"
    assert report.hits[0].document_id == "doc_allowed"
    assert report.hits[0].snippet == "RMO 12/2024 assigns the action owner."
    search_query = fake_client.post_calls[0]["json"]
    filters = search_query["query"]["bool"]["filter"]
    assert _authorized_policy_filter(
        EntitySearchRequest(
            query="action owner",
            authorized_documents=[_authorized_document()],
        )
    ) in filters
    assert {"term": {"entity_pairs": "document_number:RMO12/2024"}} in filters
    assert search_query["size"] == 12


@pytest.mark.asyncio
async def test_opensearch_entity_search_without_authorized_documents_returns_empty(tmp_path, monkeypatch) -> None:
    settings = _settings(tmp_path, {"AKL_INGESTION_INDEXER_MODE": "qdrant,opensearch"})
    fake_client = _FakeAsyncClient()
    monkeypatch.setattr("indexers.opensearch.httpx.AsyncClient", lambda **_: fake_client)

    report = await OpenSearchIndexer(settings).entity_search(
        EntitySearchRequest(query="anything", allowed_document_ids=[])
    )

    assert report.status == "ready"
    assert report.total_hits == 0
    assert report.hits == []
    assert report.warnings[0].code == "NO_AUTHORIZED_DOCUMENTS"
    assert fake_client.post_calls == []


@pytest.mark.asyncio
async def test_opensearch_analyst_search_rewrites_field_aliases_and_filters_authz(tmp_path, monkeypatch) -> None:
    settings = _settings(tmp_path, {"AKL_INGESTION_INDEXER_MODE": "qdrant,opensearch"})
    fake_client = _FakeAsyncClient(
        get_responses=[_FakeResponse(200)],
        put_responses=[_FakeResponse(200)],
        post_responses=[
            _FakeResponse(
                200,
                {
                    "hits": {
                        "total": {"value": 1},
                        "hits": [
                            {
                                "_score": 11.5,
                                "_source": {
                                    "chunk_id": "chunk_1",
                                    "document_id": "doc_allowed",
                                    "document_version_id": "ver_1",
                                    "document_title": "Directive",
                                    "version_label": "1.0",
                                    "document_type": "directive",
                                    "classification": "internal",
                                    "status": "valid",
                                    "text": "RMO 12/2024 assigns the action owner.",
                                    "section_path": ["Chapter 1"],
                                    "entity_pairs": ["document_number:RMO12/2024"],
                                },
                                "highlight": {"text": ["RMO 12/2024 assigns the action owner."]},
                            }
                        ],
                    }
                },
            )
        ],
    )
    monkeypatch.setattr("indexers.opensearch.httpx.AsyncClient", lambda **_: fake_client)

    report = await OpenSearchIndexer(settings).analyst_search(
        AnalystSearchRequest(
            query="title:Directive AND entity:RMO12/2024",
            query_mode="fielded",
            search_fields=["title", "entity"],
            allowed_document_ids=["doc_allowed", "doc_allowed"],
            authorized_documents=[_authorized_document()],
        )
    )

    assert report.status == "ready"
    assert report.query_mode == "fielded"
    assert report.total_hits == 1
    assert report.hits[0].document_id == "doc_allowed"
    search_query = fake_client.post_calls[0]["json"]
    filters = search_query["query"]["bool"]["filter"]
    assert _authorized_policy_filter(
        AnalystSearchRequest(
            query="directive",
            authorized_documents=[_authorized_document()],
        )
    ) in filters
    query_string = search_query["query"]["bool"]["must"][0]["query_string"]
    assert query_string["query"] == "document_title:Directive AND entity_values:RMO12/2024"
    assert query_string["fields"] == ["document_title^4", "entity_values^4", "entity_pairs^4", "entity_types"]


@pytest.mark.asyncio
async def test_opensearch_analyst_search_without_authorized_documents_returns_empty(tmp_path, monkeypatch) -> None:
    settings = _settings(tmp_path, {"AKL_INGESTION_INDEXER_MODE": "qdrant,opensearch"})
    fake_client = _FakeAsyncClient()
    monkeypatch.setattr("indexers.opensearch.httpx.AsyncClient", lambda **_: fake_client)

    report = await OpenSearchIndexer(settings).analyst_search(
        AnalystSearchRequest(query="anything", allowed_document_ids=[])
    )

    assert report.status == "ready"
    assert report.total_hits == 0
    assert report.hits == []
    assert report.warnings[0].code == "NO_AUTHORIZED_DOCUMENTS"
    assert fake_client.post_calls == []


@pytest.mark.asyncio
async def test_opensearch_entity_relationships_builds_evidence_edges(tmp_path, monkeypatch) -> None:
    settings = _settings(tmp_path, {"AKL_INGESTION_INDEXER_MODE": "qdrant,opensearch"})
    fake_client = _FakeAsyncClient(
        get_responses=[_FakeResponse(200)],
        put_responses=[_FakeResponse(200)],
        post_responses=[
            _FakeResponse(
                200,
                {
                    "hits": {
                        "total": {"value": 2},
                        "hits": [
                            {
                                "_source": {
                                    "chunk_id": "chunk_1",
                                    "document_id": "doc_allowed",
                                    "document_version_id": "ver_1",
                                    "document_title": "Directive",
                                    "version_label": "1.0",
                                    "text": "RMO 12/2024 assigns aiip.office@example.cz as contact.",
                                    "page_number": 2,
                                    "section_title": "Article 4",
                                    "source_file_name": "directive.pdf",
                                    "entity_pairs": [
                                        "document_number:RMO12/2024",
                                        "email:aiip.office@example.cz",
                                    ],
                                }
                            },
                            {
                                "_source": {
                                    "chunk_id": "chunk_2",
                                    "document_id": "doc_allowed",
                                    "document_version_id": "ver_1",
                                    "document_title": "Directive",
                                    "version_label": "1.0",
                                    "text": "RMO 12/2024 references aiip.office@example.cz again.",
                                    "page_number": 3,
                                    "section_title": "Article 5",
                                    "source_file_name": "directive.pdf",
                                    "entity_pairs": [
                                        "document_number:RMO12/2024",
                                        "email:aiip.office@example.cz",
                                    ],
                                }
                            },
                        ],
                    }
                },
            )
        ],
    )
    monkeypatch.setattr("indexers.opensearch.httpx.AsyncClient", lambda **_: fake_client)

    report = await OpenSearchIndexer(settings).entity_relationships(
        EntityRelationshipRequest(
            entity_type="document_number",
            entity_value="RMO12/2024",
            allowed_document_ids=["doc_allowed", "doc_allowed"],
            authorized_documents=[_authorized_document()],
        )
    )

    assert report.status == "ready"
    assert report.total_edges == 1
    assert report.edges[0].relationship_type == "co_occurs"
    assert report.edges[0].source.entity_value == "RMO12/2024"
    assert report.edges[0].target.entity_value == "aiip.office@example.cz"
    assert report.edges[0].evidence_count == 2
    assert report.edges[0].document_count == 1
    assert len(report.edges[0].evidence) == 2
    search_query = fake_client.post_calls[0]["json"]
    filters = search_query["query"]["bool"]["filter"]
    assert _authorized_policy_filter(
        EntityRelationshipRequest(authorized_documents=[_authorized_document()])
    ) in filters
    assert {"exists": {"field": "entity_pairs"}} in filters
    assert {"term": {"entity_pairs": "document_number:RMO12/2024"}} in filters


@pytest.mark.asyncio
async def test_opensearch_entity_relationships_without_authorized_documents_returns_empty(tmp_path, monkeypatch) -> None:
    settings = _settings(tmp_path, {"AKL_INGESTION_INDEXER_MODE": "qdrant,opensearch"})
    fake_client = _FakeAsyncClient()
    monkeypatch.setattr("indexers.opensearch.httpx.AsyncClient", lambda **_: fake_client)

    report = await OpenSearchIndexer(settings).entity_relationships(
        EntityRelationshipRequest(allowed_document_ids=[])
    )

    assert report.status == "ready"
    assert report.total_edges == 0
    assert report.edges == []
    assert report.warnings[0].code == "NO_AUTHORIZED_DOCUMENTS"
    assert fake_client.post_calls == []


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
async def test_qdrant_indexer_creates_lookup_and_policy_payload_indexes(tmp_path, monkeypatch) -> None:
    settings = _settings(tmp_path, {"AKL_INGESTION_INDEXER_MODE": "qdrant"})
    fake_client = _FakeAsyncClient(put_responses=[_FakeResponse(200) for _ in range(17)])
    monkeypatch.setattr("indexers.qdrant.httpx.AsyncClient", lambda **_: fake_client)

    await QdrantIndexer(settings)._ensure_text_index()

    indexed_fields = {call["json"]["field_name"] for call in fake_client.put_calls}
    assert {
        "normalized_text",
        "metadata.chunk_index",
        "document_id",
        "document_version_id",
        "document_type",
        "classification",
        "status",
        "tags",
        "organization_id",
        "policy_binding_id",
        "policy_hash",
    }.issubset(indexed_fields)


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
        post_responses: list[_FakeResponse] | None = None,
    ) -> None:
        self.get_responses = get_responses or []
        self.put_responses = put_responses or []
        self.post_responses = post_responses or []
        self.put_calls: list[dict] = []
        self.post_calls: list[dict] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def get(self, *_args, **_kwargs) -> _FakeResponse:
        return self.get_responses.pop(0)

    async def put(self, url: str, *, json: dict, **_kwargs) -> _FakeResponse:
        self.put_calls.append({"url": url, "json": json})
        return self.put_responses.pop(0)

    async def post(self, url: str, *, json: dict, **_kwargs) -> _FakeResponse:
        self.post_calls.append({"url": url, "json": json})
        return self.post_responses.pop(0)
