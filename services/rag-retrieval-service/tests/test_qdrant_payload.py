from __future__ import annotations

from retrievers.qdrant import _merge_ranked_chunks, _point_to_chunk, _points_to_lexical_chunks


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


def test_qdrant_merge_keeps_best_score_for_duplicate_chunk() -> None:
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

    merged = _merge_ranked_chunks([weak_vector, strong_lexical])

    assert len(merged) == 1
    assert merged[0].score == 0.45
