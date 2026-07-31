from __future__ import annotations

import pytest

from app import rag_client as rag_module
from app.config import load_settings
from app.errors import GovernanceError
from app.rag_client import HttpRagClient
from app.schemas import RagQueryFilters


def _settings():
    return load_settings(
        {
            "AKL_ENV": "test",
            "AKL_GOVERNANCE_DEPENDENCY_MODE": "http",
        }
    )


@pytest.mark.asyncio
async def test_http_rag_client_accepts_current_opensearch_retrieval_contract(monkeypatch) -> None:
    async def retrieve_payload(**_kwargs):
        return {
            "query_id": "qry_contract",
            "chunks": [
                {
                    "chunk_id": "chunk_contract",
                    "score": 0.94,
                    "retrieval_method": "opensearch",
                    "text": "Platne pravidlo s casovou pusobnosti.",
                    "citation": {
                        "document_id": "doc_law",
                        "document_version_id": "ver_law_2026",
                        "document_title": "Kontrolni predpis",
                        "version_label": "2026-01-06-d9ae2843bcab",
                        "document_version": "2026-01-06-d9ae2843bcab",
                        "page_number": 1,
                        "section_path": ["Cast prvni", "Cl. 1"],
                        "article_number": "1",
                        "paragraph_number": "1",
                        "valid_from": "2026-07-17",
                        "valid_to": None,
                    },
                    "metadata": {
                        "document_type": "regulation",
                        "classification": "public",
                        "status": "valid",
                    },
                }
            ],
            "warnings": [],
            "retrieval_profile": "hybrid",
            "retrieval_diagnostics": {},
        }

    monkeypatch.setattr(rag_module, "request_json_with_retry", retrieve_payload)

    chunks = await HttpRagClient(_settings()).retrieve(
        subject_id="user_123",
        query="platna pravidla",
        filters=RagQueryFilters(),
        max_chunks=8,
    )

    assert len(chunks) == 1
    assert chunks[0].retrieval_method == "opensearch"
    assert chunks[0].citation.document_version == "2026-01-06-d9ae2843bcab"
    assert chunks[0].citation.valid_from.isoformat() == "2026-07-17"
    assert chunks[0].citation.valid_to is None


@pytest.mark.asyncio
async def test_http_rag_client_fails_closed_on_unknown_retrieval_contract(monkeypatch) -> None:
    async def incompatible_payload(**_kwargs):
        return {
            "chunks": [
                {
                    "chunk_id": "chunk_contract",
                    "score": 0.94,
                    "retrieval_method": "future-backend",
                    "text": "Kontrolni text.",
                    "citation": {
                        "document_id": "doc_law",
                        "document_version_id": "ver_law_2026",
                        "document_title": "Kontrolni predpis",
                        "version_label": "1.0",
                    },
                    "metadata": {},
                }
            ]
        }

    monkeypatch.setattr(rag_module, "request_json_with_retry", incompatible_payload)

    with pytest.raises(GovernanceError) as captured:
        await HttpRagClient(_settings()).retrieve(
            subject_id="user_123",
            query="platna pravidla",
            filters=RagQueryFilters(),
            max_chunks=8,
        )

    assert captured.value.status_code == 502
    assert captured.value.code == "RAG_RESPONSE_CONTRACT_MISMATCH"
    assert captured.value.details == {
        "dependency": "rag-retrieval-service",
        "reason": "response_contract_mismatch",
    }
