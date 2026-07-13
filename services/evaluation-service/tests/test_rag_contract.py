from __future__ import annotations

import pytest

from app.schemas import RetrieveResponse


@pytest.mark.parametrize("retrieval_method", ["opensearch", "qdrant"])
def test_retrieve_response_accepts_production_retrieval_contract(retrieval_method: str) -> None:
    response = RetrieveResponse.model_validate(
        {
            "query_id": "query_contract",
            "chunks": [
                {
                    "chunk_id": "chunk_contract",
                    "score": 0.91,
                    "retrieval_method": retrieval_method,
                    "text": "Contract fixture",
                    "citation": {
                        "document_id": "doc_contract",
                        "document_version_id": "ver_contract",
                        "document_title": "Contract document",
                        "version_label": "1.0",
                        "document_version": "source-20260710",
                        "page_number": 1,
                        "section_path": [],
                    },
                    "metadata": {},
                }
            ],
            "warnings": [],
        }
    )

    assert response.chunks[0].retrieval_method == retrieval_method
    assert response.chunks[0].citation.document_version == "source-20260710"
