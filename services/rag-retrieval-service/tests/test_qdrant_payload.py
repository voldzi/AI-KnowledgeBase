from __future__ import annotations

import asyncio

from app.config import load_settings
from retrievers.qdrant import QdrantHybridRetriever, _fuse_ranked_chunks, _point_to_chunk, _points_to_lexical_chunks


def test_qdrant_payload_metadata_fallback_builds_citation() -> None:
    chunk = _point_to_chunk(
        {
            "chunk_id": "chunk_real",
            "document_id": "doc_real",
            "document_version_id": "ver_real",
            "text": "The owner approves the exception.",
            "classification": "internal",
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
