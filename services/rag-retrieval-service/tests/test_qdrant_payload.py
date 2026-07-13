from __future__ import annotations

import asyncio

import httpx

from app.config import load_settings
from app.errors import RetrievalError
from app.schemas import RagQueryFilters
from retrievers.qdrant import (
    OpenSearchFullTextClient,
    QdrantHybridRetriever,
    _fuse_ranked_chunks,
    _opensearch_filter,
    _opensearch_hits_to_chunks,
    _opensearch_query,
    _point_to_chunk,
    _points_to_lexical_chunks,
    _qdrant_filter,
)


def test_missing_qdrant_collection_is_an_empty_retrieval_result(monkeypatch) -> None:
    settings = load_settings({"AKL_RAG_DEPENDENCY_MODE": "http"})
    retriever = QdrantHybridRetriever(settings)

    async def fake_request(**kwargs):
        raise RetrievalError(
            "UPSTREAM_ERROR",
            "qdrant returned an error",
            status_code=502,
            details={"dependency": "qdrant", "status_code": 404},
        )

    import retrievers.qdrant as qdrant_module

    monkeypatch.setattr(qdrant_module, "request_json_with_retry", fake_request)

    chunks = asyncio.run(
        retriever.retrieve(
            query="old document",
            filters=RagQueryFilters(document_ids=["doc_removed"]),
            limit=5,
        )
    )

    assert chunks == []
    assert asyncio.run(retriever.readiness()) == "ready"


def test_missing_opensearch_index_is_an_empty_retrieval_result(monkeypatch) -> None:
    settings = load_settings(
        {
            "AKL_RAG_DEPENDENCY_MODE": "http",
            "AKL_RAG_FULLTEXT_MODE": "opensearch",
            "AKL_OPENSEARCH_BASE_URL": "http://opensearch.test:9200",
        }
    )
    client = OpenSearchFullTextClient(settings)

    class FakeAsyncClient:
        def __init__(self, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback) -> None:
            pass

        async def get(self, *args, **kwargs) -> httpx.Response:
            return httpx.Response(404, json={})

        async def post(self, *args, **kwargs) -> httpx.Response:
            return httpx.Response(404, json={})

    import retrievers.qdrant as qdrant_module

    monkeypatch.setattr(qdrant_module.httpx, "AsyncClient", FakeAsyncClient)

    chunks = asyncio.run(
        client.retrieve(
            query="old document",
            filters=RagQueryFilters(document_ids=["doc_removed"]),
            limit=5,
        )
    )

    assert chunks == []
    assert asyncio.run(client.readiness()) == "ready"


def test_opensearch_server_error_is_not_treated_as_empty(monkeypatch) -> None:
    settings = load_settings(
        {
            "AKL_RAG_DEPENDENCY_MODE": "http",
            "AKL_RAG_FULLTEXT_MODE": "opensearch",
            "AKL_OPENSEARCH_BASE_URL": "http://opensearch.test:9200",
        }
    )
    client = OpenSearchFullTextClient(settings)

    class FakeAsyncClient:
        def __init__(self, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback) -> None:
            pass

        async def post(self, *args, **kwargs) -> httpx.Response:
            return httpx.Response(500, json={})

    import retrievers.qdrant as qdrant_module

    monkeypatch.setattr(qdrant_module.httpx, "AsyncClient", FakeAsyncClient)

    try:
        asyncio.run(
            client.retrieve(
                query="old document",
                filters=RagQueryFilters(document_ids=["doc_removed"]),
                limit=5,
            )
        )
    except RetrievalError as exc:
        assert exc.details == {"dependency": "opensearch", "status_code": 500}
    else:
        raise AssertionError("OpenSearch 500 must remain an upstream error")


def test_qdrant_payload_metadata_fallback_builds_citation() -> None:
    chunk = _point_to_chunk(
        {
            "chunk_id": "chunk_real",
            "document_id": "doc_real",
            "document_version_id": "ver_real",
            "text": "The owner approves the exception.",
            "classification": "internal",
            "policy_binding_id": "pol_testbinding01",
            "policy_version": "information-policy-2.0.0",
            "policy_hash": "sha256:" + "c" * 64,
            "policy_summary": {"handlingClass": "INTERNAL", "obligations": ["AUDIT_ACCESS"]},
            "page_number": 2,
            "section_path": ["Article 4", "Paragraph 2"],
            "metadata": {
                "document_title": "Real Directive",
                "version_label": "1.0",
                "document_type": "directive",
                "status": "valid",
                "tags": ["phase02"],
            },
        },
        score=0.9,
        dense_score=0.8,
        sparse_score=1.0,
    )

    assert chunk.chunk_id == "chunk_real"
    assert chunk.retrieval_method == "qdrant"
    assert chunk.citation.document_title == "Real Directive"
    assert chunk.citation.version_label == "1.0"
    assert chunk.metadata["document_type"] == "directive"
    assert chunk.metadata["status"] == "valid"
    assert chunk.metadata["tags"] == ["phase02"]
    assert chunk.metadata["policy_binding_id"] == "pol_testbinding01"
    assert chunk.metadata["policy_hash"] == "sha256:" + "c" * 64


def test_qdrant_payload_preserves_parser_quality_metadata() -> None:
    chunk = _point_to_chunk(
        {
            "chunk_id": "chunk_ocr",
            "document_id": "doc_ocr",
            "document_version_id": "ver_ocr",
            "text": "OCR text from scanned source.",
            "metadata": {
                "document_title": "Scanned Directive",
                "version_label": "1.0",
                "parser_name": "ocr_ocrmypdf",
                "parser_engine": "ocrmypdf",
                "ocr_used": True,
                "quality_tier": "review",
                "requires_review": True,
                "parser_quality": {
                    "quality_score": 0.62,
                    "quality_tier": "review",
                    "requires_review": True,
                },
            },
        },
        score=0.8,
        dense_score=0.7,
        sparse_score=0.9,
    )

    assert chunk.metadata["parser_name"] == "ocr_ocrmypdf"
    assert chunk.metadata["parser_engine"] == "ocrmypdf"
    assert chunk.metadata["ocr_used"] is True
    assert chunk.metadata["quality_tier"] == "review"
    assert chunk.metadata["requires_review"] is True
    assert chunk.metadata["parser_quality"]["quality_score"] == 0.62


def test_qdrant_lexical_fallback_promotes_project_risk_chunks() -> None:
    points = [
        {
            "payload": {
                "chunk_id": "chunk_risk",
                "document_id": "doc_risk",
                "document_version_id": "ver_risk",
                "document_title": "Projektová rizika",
                "version_label": "1.0",
                "text": (
                    "Chybové scénáře: systém musí reagovat, když LLM Gateway není dostupná, "
                    "Qdrant není dostupný, OCR selže nebo dokument nelze parsovat."
                ),
                "classification": "internal",
                "document_type": "project_documentation",
                "status": "valid",
            }
        }
    ]

    chunks = _points_to_lexical_chunks(query="Jaká jsou největší rizika projektu?", points=points)

    assert chunks[0].chunk_id == "chunk_risk"
    assert chunks[0].score >= 0.35
    assert chunks[0].metadata["lexical_fallback"] is True


def test_opensearch_hits_convert_to_cited_chunks() -> None:
    payload = {
        "hits": {
            "max_score": 12.0,
            "hits": [
                {
                    "_score": 12.0,
                    "_source": {
                        "chunk_id": "chunk_os",
                        "document_id": "doc_os",
                        "document_version_id": "ver_os",
                        "document_title": "RMO 12/2024",
                        "version_label": "1.0",
                        "text": "Gestor odpovida za aktualizaci dokumentace.",
                        "classification": "internal",
                        "document_type": "directive",
                        "status": "valid",
                        "page_number": 3,
                    },
                }
            ],
        }
    }

    chunks = _opensearch_hits_to_chunks(query="RMO 12/2024 gestor", payload=payload)

    assert len(chunks) == 1
    assert chunks[0].chunk_id == "chunk_os"
    assert chunks[0].retrieval_method == "opensearch"
    assert chunks[0].citation.document_title == "RMO 12/2024"
    assert chunks[0].metadata["opensearch_score"] == 12.0
    assert chunks[0].metadata["lexical_fallback"] is True


def test_opensearch_query_contains_weighted_fields_and_filters() -> None:
    query = _opensearch_query(
        query="RMO 12/2024 gestor",
        filters=RagQueryFilters(document_types=["directive"], tags=["logistika"], only_valid=True),
        limit=20,
    )

    assert query["size"] == 20
    bool_query = query["query"]["bool"]
    assert bool_query["minimum_should_match"] == 1
    assert any("document_title^6" in clause["multi_match"]["fields"] for clause in bool_query["should"])
    expanded_clause = next(
        clause["multi_match"]
        for clause in bool_query["should"]
        if clause.get("multi_match", {}).get("boost") == 1.4
    )
    assert "rozkaz ministra obrany" in expanded_clause["query"]
    assert any(
        clause.get("multi_match", {}).get("query") == "rmo 12/2024"
        and clause["multi_match"].get("boost") == 5
        for clause in bool_query["should"]
    )
    assert any("wildcard" in clause and clause["wildcard"]["document_title.keyword"]["value"] == "*rmo 12/2024*" for clause in bool_query["should"])
    assert {"terms": {"document_type": ["directive"]}} in bool_query["filter"]
    assert {"terms": {"tags": ["logistika"]}} in bool_query["filter"]
    assert {"term": {"status": "valid"}} in bool_query["filter"]


def test_opensearch_filter_limits_classification() -> None:
    filters = _opensearch_filter(RagQueryFilters(classification_max="restricted"))

    assert {"terms": {"classification": ["public", "internal", "restricted"]}} in filters


def test_aiip_tenant_filters_apply_to_both_retrieval_indexes() -> None:
    filters = RagQueryFilters(
        tenant_id="tenant-aiip",
        external_system="STRATOS_AIIP",
    )

    assert {"key": "tenant_id", "match": {"value": "tenant-aiip"}} in _qdrant_filter(filters)["must"]
    assert {"key": "external_system", "match": {"value": "STRATOS_AIIP"}} in _qdrant_filter(filters)["must"]
    assert {"term": {"tenant_id": "tenant-aiip"}} in _opensearch_filter(filters)
    assert {"term": {"external_system": "STRATOS_AIIP"}} in _opensearch_filter(filters)


def test_document_version_filters_apply_to_both_retrieval_indexes() -> None:
    filters = RagQueryFilters(
        document_ids=["doc_contract"],
        document_version_ids=["ver_contract_1"],
        only_valid=False,
    )

    assert {"key": "document_id", "match": {"any": ["doc_contract"]}} in _qdrant_filter(filters)["must"]
    assert {
        "key": "document_version_id",
        "match": {"any": ["ver_contract_1"]},
    } in _qdrant_filter(filters)["must"]
    assert {"terms": {"document_id": ["doc_contract"]}} in _opensearch_filter(filters)
    assert {"terms": {"document_version_id": ["ver_contract_1"]}} in _opensearch_filter(filters)


def test_qdrant_valid_filter_allows_missing_valid_from_for_valid_documents() -> None:
    qdrant_filter = _qdrant_filter(RagQueryFilters(only_valid=True))

    assert {"key": "status", "match": {"value": "valid"}} in qdrant_filter["must"]
    min_should = [condition["min_should"] for condition in qdrant_filter["must"] if "min_should" in condition]
    assert len(min_should) == 1
    assert min_should[0]["min_count"] == 1
    assert {"is_empty": {"key": "valid_from"}} in min_should[0]["conditions"]
    assert any(
        condition.get("key") == "valid_from" and "lte" in condition.get("range", {})
        for condition in min_should[0]["conditions"]
    )


def test_qdrant_fusion_keeps_best_score_for_duplicate_chunk() -> None:
    weak_vector = _point_to_chunk(
        {
            "chunk_id": "chunk_same",
            "document_id": "doc_same",
            "document_version_id": "ver_same",
            "text": "Slabý dense kandidát.",
        },
        score=0.1,
        dense_score=0.1,
        sparse_score=0.0,
    )
    strong_lexical = weak_vector.model_copy(update={"score": 0.45, "metadata": {"sparse_score": 0.45}})

    fused = _fuse_ranked_chunks([weak_vector], [strong_lexical])

    assert len(fused) == 1
    assert fused[0].score == 0.45
    # appears in both rankings at rank 1 -> RRF = 2 / (60 + 1)
    assert fused[0].metadata["rrf_score"] == round(2.0 / 61.0, 6)


def test_qdrant_fusion_prefers_chunk_present_in_both_rankings() -> None:
    def _chunk(chunk_id: str, *, score: float, dense: float, sparse: float):
        return _point_to_chunk(
            {
                "chunk_id": chunk_id,
                "document_id": f"doc_{chunk_id}",
                "document_version_id": f"ver_{chunk_id}",
                "text": f"Text {chunk_id}.",
            },
            score=score,
            dense_score=dense,
            sparse_score=sparse,
        )

    both = _chunk("chunk_both", score=0.5, dense=0.6, sparse=0.5)
    dense_only = _chunk("chunk_dense", score=0.7, dense=0.9, sparse=0.0)
    lexical_only = _chunk("chunk_lex", score=0.6, dense=0.0, sparse=0.6)

    fused = _fuse_ranked_chunks([dense_only, both], [lexical_only, both])

    assert fused[0].chunk_id == "chunk_both"


def test_get_neighbors_returns_adjacent_chunk_texts(monkeypatch) -> None:
    settings = load_settings({"AKL_RAG_DEPENDENCY_MODE": "mock"})
    retriever = QdrantHybridRetriever(settings)

    chunk = _point_to_chunk(
        {
            "chunk_id": "chunk_mid",
            "document_id": "doc_n",
            "document_version_id": "ver_n",
            "text": "Prostredni cast.",
            "metadata": {"chunk_index": 5},
        },
        score=0.9,
        dense_score=0.9,
        sparse_score=0.9,
    )

    async def fake_scroll(*, dependency, settings, method, url, json_body=None, auth_context=None, prefer_upstream_token=False):
        assert "scroll" in url
        return {
            "result": {
                "points": [
                    {"payload": {"text": "Predchozi cast.", "metadata": {"chunk_index": 4}}},
                    {"payload": {"text": "Prostredni cast.", "metadata": {"chunk_index": 5}}},
                    {"payload": {"text": "Nasledujici cast.", "metadata": {"chunk_index": 6}}},
                ]
            }
        }

    import retrievers.qdrant as qdrant_module

    monkeypatch.setattr(qdrant_module, "request_json_with_retry", fake_scroll)
    before, after = asyncio.run(retriever.get_neighbors(chunk))

    assert before == "Predchozi cast."
    assert after == "Nasledujici cast."


def test_get_neighbors_without_chunk_index_returns_empty(monkeypatch) -> None:
    settings = load_settings({"AKL_RAG_DEPENDENCY_MODE": "mock"})
    retriever = QdrantHybridRetriever(settings)
    chunk = _point_to_chunk(
        {
            "chunk_id": "chunk_no_index",
            "document_id": "doc_n",
            "document_version_id": "ver_n",
            "text": "Bez indexu.",
        },
        score=0.9,
        dense_score=0.9,
        sparse_score=0.9,
    )

    before, after = asyncio.run(retriever.get_neighbors(chunk))

    assert before == ""
    assert after == ""


def test_get_neighbors_uses_configured_context_window(monkeypatch) -> None:
    settings = load_settings({"AKL_RAG_DEPENDENCY_MODE": "mock", "AKL_RAG_SOURCE_CONTEXT_WINDOW": "2"})
    retriever = QdrantHybridRetriever(settings)

    chunk = _point_to_chunk(
        {
            "chunk_id": "chunk_mid",
            "document_id": "doc_n",
            "document_version_id": "ver_n",
            "text": "Prostredni cast.",
            "metadata": {"chunk_index": 5},
        },
        score=0.9,
        dense_score=0.9,
        sparse_score=0.9,
    )

    async def fake_scroll(*, dependency, settings, method, url, json_body=None, auth_context=None, prefer_upstream_token=False):
        range_filter = json_body["filter"]["must"][1]["range"]
        assert range_filter == {"gte": 3, "lte": 7}
        return {
            "result": {
                "points": [
                    {"payload": {"text": "Cast 3.", "metadata": {"chunk_index": 3}}},
                    {"payload": {"text": "Cast 4.", "metadata": {"chunk_index": 4}}},
                    {"payload": {"text": "Cast 5.", "metadata": {"chunk_index": 5}}},
                    {"payload": {"text": "Cast 6.", "metadata": {"chunk_index": 6}}},
                    {"payload": {"text": "Cast 7.", "metadata": {"chunk_index": 7}}},
                ]
            }
        }

    import retrievers.qdrant as qdrant_module

    monkeypatch.setattr(qdrant_module, "request_json_with_retry", fake_scroll)
    before, after = asyncio.run(retriever.get_neighbors(chunk))

    assert before == "Cast 3.\n\nCast 4."
    assert after == "Cast 6.\n\nCast 7."
