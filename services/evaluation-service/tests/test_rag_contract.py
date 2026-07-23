from __future__ import annotations

import httpx
import pytest

from app.config import load_settings
from app.errors import EvaluationError
from app.http_utils import request_json_with_retry
from app.schemas import RagAnswer, RetrieveResponse


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


def test_rag_answer_accepts_information_policy_citation_metadata() -> None:
    answer = RagAnswer.model_validate(
        {
            "query_id": "query_contract",
            "answer": "Supported answer",
            "confidence": "high",
            "citations": [
                {
                    "document_id": "doc_contract",
                    "document_version_id": "ver_contract",
                    "document_title": "Contract document",
                    "version_label": "1.0",
                    "chunk_id": "chunk_contract",
                    "policy_binding_id": "pol_contract",
                    "policy_version": "information-policy-2.0.0",
                    "policy_hash": f"sha256:{'a' * 64}",
                    "policy_summary": {
                        "policyBindingId": "pol_contract",
                        "policyVersion": "information-policy-2.0.0",
                        "handlingClass": "PUBLIC",
                        "legalClassification": "NONE",
                        "tlp": "TLP:CLEAR",
                        "pap": "PAP:CLEAR",
                        "obligations": ["AUDIT_ACCESS"],
                        "contentCategories": ["OFFICIAL_PUBLIC_REFERENCE"],
                        "audience": {
                            "organizationId": "org_stratos",
                            "scopeType": "public",
                            "scopeIds": [],
                            "recipientSubjectIds": [],
                        },
                    },
                    "policy_summary_hash": f"sha256:{'b' * 64}",
                    "document_context_tags": ["official-public-reference"],
                }
            ],
        }
    )

    assert answer.citations[0].policy_binding_id == "pol_contract"
    assert answer.citations[0].document_context_tags == ["official-public-reference"]


@pytest.mark.asyncio
async def test_read_timeout_does_not_retry_long_running_retrieval(monkeypatch) -> None:
    calls = 0

    class FakeClient:
        def __init__(self, *, timeout):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return False

        async def request(self, *args, **kwargs):
            nonlocal calls
            calls += 1
            request = httpx.Request("POST", "http://rag/api/v1/rag/retrieve")
            raise httpx.ReadTimeout("still processing", request=request)

    monkeypatch.setattr("app.http_utils.httpx.AsyncClient", FakeClient)
    settings = load_settings(
        {
            "AKL_ENV": "test",
            "AKL_AUTH_MODE": "disabled",
            "AKL_EVAL_RETRY_ATTEMPTS": "2",
        }
    )

    with pytest.raises(EvaluationError) as exc_info:
        await request_json_with_retry(
            dependency="rag-retrieval-service",
            settings=settings,
            method="POST",
            url="http://rag/api/v1/rag/retrieve",
            json_body={"query": "redacted"},
        )

    assert exc_info.value.code == "UPSTREAM_TIMEOUT"
    assert calls == 1
