from __future__ import annotations

from app.quality import _percentile
from app.schemas import AnswerMetrics, CitationMetrics, EvalCase, RetrievalMetrics
from runners.evaluator import _failure_stage


def test_quality_gate_uses_interpolated_percentile() -> None:
    assert _percentile([100, 200, 300, 400], 0.95) == 385


def test_low_precision_is_reported_as_retrieval_relevance_failure() -> None:
    case = EvalCase(
        case_id="precision_case",
        subject_id="user_123",
        query="Exact document title",
        answer_mode="retrieve_only",
        expected_relevant_document_ids=["doc_expected"],
    )
    retrieval = RetrievalMetrics(
        expected_relevant_count=0,
        retrieved_count=10,
        relevant_retrieved_count=1,
        precision=0.1,
        recall=1,
        hit_rate=1,
        mrr=1,
        ndcg=1,
        expected_relevant_document_count=1,
        relevant_document_retrieved_count=1,
        zero_result=False,
        false_zero_result=False,
    )
    citations = CitationMetrics(
        expected_citation_count=0,
        actual_citation_count=0,
        matched_citation_count=0,
        precision=1,
        recall=1,
        correctness=1,
    )
    answer = AnswerMetrics(
        expected_term_count=0,
        matched_term_count=0,
        forbidden_term_violations=[],
        term_coverage=1,
        answer_correctness=1,
        faithfulness=1,
        no_answer_correctness=1,
    )

    assert (
        _failure_stage(
            case=case,
            retrieval_metrics=retrieval,
            citation_metrics=citations,
            answer_metrics=answer,
            retrieval_only=True,
        )
        == "retrieval_relevance"
    )
