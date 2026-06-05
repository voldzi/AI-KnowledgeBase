from __future__ import annotations

from retrievers.qdrant import _point_to_chunk


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
