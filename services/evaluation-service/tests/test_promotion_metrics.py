from __future__ import annotations

from app.schemas import (
    Citation,
    ChunkCitation,
    EvalCase,
    ExpectedCitation,
    RagAnswer,
    RetrieveResponse,
    RetrievedChunk,
)
from runners.evaluator import _citation_metrics, _evaluate_success, _summarize


def _chunk(index: int, document_id: str) -> RetrievedChunk:
    return RetrievedChunk(
        chunk_id=f"chunk_{index}",
        score=max(0.1, 1 - index / 100),
        retrieval_method="hybrid",
        text=f"Evaluation text {index}",
        citation=ChunkCitation(
            document_id=document_id,
            document_version_id=f"version_{document_id}",
            document_title=f"Document {document_id}",
            version_label="1.0",
        ),
    )


def test_recall_cutoffs_and_router_accuracy_are_reported_independently() -> None:
    chunks = [_chunk(index, "noise") for index in range(11)]
    chunks.append(_chunk(11, "target"))
    chunks.extend(_chunk(index, "noise") for index in range(12, 50))
    case = EvalCase(
        case_id="promotion_recall",
        query="365/2000 Sb.",
        answer_mode="retrieve_only",
        expected_relevant_document_ids=["target"],
        expected_retrieval_profile="exact",
        retrieval_cutoffs=[8, 50],
    )
    response = RetrieveResponse(
        query_id="query_1",
        chunks=chunks,
        retrieval_profile="exact",
        retrieval_diagnostics={"exact_document_scope_applied": False},
    )

    result = _evaluate_success(
        case=case,
        retrieve_response=response,
        answer=None,
        pass_threshold=0.75,
        answer_excerpt_chars=0,
        latency_ms=10,
        retrieval_latency_ms=10,
        answer_latency_ms=0,
    )
    summary = _summarize([result])

    assert result.retrieval_metrics.recall_at_k == {"8": 0.0, "50": 1.0}
    assert result.router_correct is True
    assert result.retrieval_metrics.retrieved_count == 8
    assert summary.retrieval_recall_at_8 == 0.0
    assert summary.retrieval_recall_at_50 == 1.0
    assert summary.router_accuracy == 1.0


def test_supported_claim_and_false_answer_rates_are_reported() -> None:
    case = EvalCase(
        case_id="promotion_no_answer",
        query="Nezodpověditelný dotaz",
        expected_no_answer=True,
        expected_retrieval_profile="semantic",
    )
    response = RetrieveResponse(
        query_id="query_2",
        chunks=[],
        retrieval_profile="semantic",
    )
    answer = RagAnswer(
        query_id="query_2",
        answer="Nepodložená odpověď.",
        confidence="high",
        citations=[],
        claims=[{"text": "Nepodložená odpověď.", "supported": True}],
        evidence_status="supported",
    )

    result = _evaluate_success(
        case=case,
        retrieve_response=response,
        answer=answer,
        pass_threshold=0.75,
        answer_excerpt_chars=0,
        latency_ms=20,
        retrieval_latency_ms=5,
        answer_latency_ms=15,
    )
    summary = _summarize([result])

    assert result.answer_metrics.supported_claim_rate == 1.0
    assert result.answer_metrics.no_answer_correctness == 0.0
    assert summary.supported_claim_rate == 1.0
    assert summary.false_answer_rate == 1.0
    assert summary.claim_evaluated_cases == 1
    assert summary.no_answer_evaluated_cases == 1


def test_multiple_chunk_citations_from_expected_document_keep_full_purity() -> None:
    case = EvalCase(
        case_id="document_citation_purity",
        query="Co upravuje zákon?",
        expected_citations=[
            ExpectedCitation(document_id="doc_law", document_version_id="ver_law")
        ],
    )
    answer = RagAnswer(
        query_id="query_law",
        answer="Podložená odpověď.",
        confidence="high",
        citations=[
            Citation(
                document_id="doc_law",
                document_version_id="ver_law",
                document_title="Zákon",
                version_label="1",
                chunk_id=f"chunk_{index}",
            )
            for index in range(3)
        ],
    )

    metrics = _citation_metrics(case, answer)

    assert metrics.matched_citation_count == 1
    assert metrics.precision == 1.0
    assert metrics.recall == 1.0
    assert metrics.correctness == 1.0
