from __future__ import annotations

import hashlib
import logging
import time
import unicodedata
import uuid
from datetime import datetime, timezone
from statistics import mean

from app.config import Settings
from app.errors import EvaluationError
from app.rag_client import RagClient
from app.schemas import (
    AnswerMetrics,
    Citation,
    CitationMetrics,
    EvalCase,
    EvaluationCaseResult,
    EvaluationDataset,
    EvaluationRun,
    EvaluationRunRequest,
    EvaluationSummary,
    ExpectedCitation,
    RagAnswer,
    RagQueryRequest,
    RetrievalMetrics,
    RetrieveRequest,
    RetrieveResponse,
)

logger = logging.getLogger(__name__)


class EvaluationRunner:
    def __init__(self, *, settings: Settings, rag_client: RagClient) -> None:
        self._settings = settings
        self._rag_client = rag_client

    async def run(self, dataset: EvaluationDataset, request: EvaluationRunRequest) -> EvaluationRun:
        selected_cases = _select_cases(dataset, request)
        started_at = datetime.now(timezone.utc)
        results = [await self._run_case(case, request) for case in selected_cases]
        finished_at = datetime.now(timezone.utc)
        summary = _summarize(results)
        status = "completed_with_errors" if summary.error_cases else "completed"
        return EvaluationRun(
            run_id=f"eval_run_{uuid.uuid4().hex[:12]}",
            dataset_id=dataset.dataset_id,
            dataset_name=dataset.name,
            status=status,
            started_at=started_at,
            finished_at=finished_at,
            summary=summary,
            cases=results,
            settings={
                "pass_threshold": self._settings.pass_threshold,
                "max_cases_per_run": self._settings.max_cases_per_run,
                "answer_excerpt_chars": self._settings.answer_excerpt_chars,
            },
        )

    async def _run_case(self, case: EvalCase, request: EvaluationRunRequest) -> EvaluationCaseResult:
        subject_id = request.subject_id_override or case.subject_id
        retrieve_payload = RetrieveRequest(
            subject_id=subject_id,
            query=case.query,
            filters=case.filters,
            max_chunks=case.max_chunks,
        )
        query_payload = RagQueryRequest(
            subject_id=subject_id,
            query=case.query,
            filters=case.filters,
            answer_mode=case.answer_mode,
            max_chunks=case.max_chunks,
        )

        started = time.perf_counter()
        try:
            retrieve_started = time.perf_counter()
            retrieve_response = await self._rag_client.retrieve(retrieve_payload)
            retrieval_latency_ms = _elapsed_ms(retrieve_started)

            answer_started = time.perf_counter()
            answer = await self._rag_client.query(query_payload)
            answer_latency_ms = _elapsed_ms(answer_started)

            return _evaluate_success(
                case=case,
                retrieve_response=retrieve_response,
                answer=answer,
                pass_threshold=self._settings.pass_threshold,
                answer_excerpt_chars=self._settings.answer_excerpt_chars,
                latency_ms=_elapsed_ms(started),
                retrieval_latency_ms=retrieval_latency_ms,
                answer_latency_ms=answer_latency_ms,
            )
        except EvaluationError as exc:
            logger.warning(
                "evaluation_case_failed case_id=%s error_code=%s query_text_logged=false",
                case.case_id,
                exc.code,
            )
            return _error_result(case=case, started=started, code=exc.code, message=exc.message)
        except Exception as exc:
            logger.exception("evaluation_case_failed case_id=%s query_text_logged=false", case.case_id)
            return _error_result(
                case=case,
                started=started,
                code="EVALUATION_CASE_FAILED",
                message=exc.__class__.__name__,
            )


def _select_cases(dataset: EvaluationDataset, request: EvaluationRunRequest) -> list[EvalCase]:
    cases = dataset.cases
    if request.case_ids:
        requested = set(request.case_ids)
        cases_by_id = {case.case_id: case for case in cases}
        missing = sorted(requested - set(cases_by_id))
        if missing:
            raise EvaluationError(
                "CASE_NOT_FOUND",
                "Requested evaluation case was not found",
                status_code=400,
                details={"case_ids": missing},
            )
        cases = [cases_by_id[case_id] for case_id in request.case_ids]

    limit = request.max_cases
    if limit is not None:
        cases = cases[:limit]

    return cases


def _evaluate_success(
    *,
    case: EvalCase,
    retrieve_response: RetrieveResponse,
    answer: RagAnswer,
    pass_threshold: float,
    answer_excerpt_chars: int,
    latency_ms: float,
    retrieval_latency_ms: float,
    answer_latency_ms: float,
) -> EvaluationCaseResult:
    retrieval_metrics = _retrieval_metrics(case, retrieve_response)
    citation_metrics = _citation_metrics(case, answer)
    answer_metrics = _answer_metrics(case, retrieve_response, answer)
    overall_score = _overall_score(
        retrieval_metrics=retrieval_metrics,
        citation_metrics=citation_metrics,
        answer_metrics=answer_metrics,
        expected_no_answer=case.expected_no_answer,
    )
    status = "passed" if overall_score >= pass_threshold else "failed"
    warnings = sorted(set(retrieve_response.warnings + answer.warnings))
    return EvaluationCaseResult(
        case_id=case.case_id,
        query_id=answer.query_id or retrieve_response.query_id,
        status=status,
        overall_score=overall_score,
        latency_ms=latency_ms,
        retrieval_latency_ms=retrieval_latency_ms,
        answer_latency_ms=answer_latency_ms,
        confidence=answer.confidence,
        retrieval_metrics=retrieval_metrics,
        citation_metrics=citation_metrics,
        answer_metrics=answer_metrics,
        retrieved_chunk_ids=[chunk.chunk_id for chunk in retrieve_response.chunks],
        used_chunks=answer.used_chunks,
        actual_citations=answer.citations,
        warnings=warnings,
        answer_excerpt=_excerpt(answer.answer, answer_excerpt_chars),
        answer_sha256=hashlib.sha256(answer.answer.encode("utf-8")).hexdigest(),
    )


def _retrieval_metrics(case: EvalCase, retrieve_response: RetrieveResponse) -> RetrievalMetrics:
    expected = set(case.expected_relevant_chunk_ids)
    retrieved = [chunk.chunk_id for chunk in retrieve_response.chunks]
    retrieved_set = set(retrieved)
    matched = expected & retrieved_set

    if expected:
        precision = len(matched) / len(retrieved) if retrieved else 0.0
        recall = len(matched) / len(expected)
        hit_rate = 1.0 if matched else 0.0
        mrr = _mrr(retrieved, expected)
    else:
        precision = 1.0 if not retrieved else 0.0
        recall = 1.0
        hit_rate = 1.0 if not retrieved else 0.0
        mrr = 1.0 if not retrieved else 0.0

    return RetrievalMetrics(
        expected_relevant_count=len(expected),
        retrieved_count=len(retrieved),
        relevant_retrieved_count=len(matched),
        precision=_round(precision),
        recall=_round(recall),
        hit_rate=_round(hit_rate),
        mrr=_round(mrr),
    )


def _citation_metrics(case: EvalCase, answer: RagAnswer) -> CitationMetrics:
    expected = case.expected_citations
    actual = answer.citations
    matched = _matched_citations(expected, actual)

    if expected:
        precision = matched / len(actual) if actual else 0.0
        recall = matched / len(expected)
    else:
        precision = 1.0 if not actual else 0.0
        recall = 1.0

    correctness = (precision + recall) / 2
    return CitationMetrics(
        expected_citation_count=len(expected),
        actual_citation_count=len(actual),
        matched_citation_count=matched,
        precision=_round(precision),
        recall=_round(recall),
        correctness=_round(correctness),
    )


def _answer_metrics(case: EvalCase, retrieve_response: RetrieveResponse, answer: RagAnswer) -> AnswerMetrics:
    normalized_answer = _normalize(answer.answer)
    matched_terms = [term for term in case.expected_answer_terms if _normalize(term) in normalized_answer]
    forbidden = [term for term in case.forbidden_answer_terms if _normalize(term) in normalized_answer]
    term_coverage = len(matched_terms) / len(case.expected_answer_terms) if case.expected_answer_terms else 1.0

    if case.expected_no_answer:
        no_answer_correctness = _no_answer_correctness(case, answer)
        answer_correctness = no_answer_correctness
    else:
        no_answer_correctness = _no_answer_correctness(case, answer)
        penalty = len(forbidden) / len(case.forbidden_answer_terms) if case.forbidden_answer_terms else 0.0
        answer_correctness = max(0.0, term_coverage - penalty)

    faithfulness = _faithfulness(case, retrieve_response, answer, no_answer_correctness)
    return AnswerMetrics(
        expected_term_count=len(case.expected_answer_terms),
        matched_term_count=len(matched_terms),
        forbidden_term_violations=forbidden,
        term_coverage=_round(term_coverage),
        answer_correctness=_round(answer_correctness),
        faithfulness=_round(faithfulness),
        no_answer_correctness=_round(no_answer_correctness),
    )


def _overall_score(
    *,
    retrieval_metrics: RetrievalMetrics,
    citation_metrics: CitationMetrics,
    answer_metrics: AnswerMetrics,
    expected_no_answer: bool,
) -> float:
    retrieval_score = (retrieval_metrics.precision + retrieval_metrics.recall + retrieval_metrics.mrr) / 3
    if expected_no_answer:
        score = (
            0.20 * retrieval_score
            + 0.20 * citation_metrics.correctness
            + 0.45 * answer_metrics.no_answer_correctness
            + 0.15 * answer_metrics.faithfulness
        )
    else:
        score = (
            0.30 * retrieval_score
            + 0.25 * citation_metrics.correctness
            + 0.25 * answer_metrics.answer_correctness
            + 0.20 * answer_metrics.faithfulness
        )
    return _round(score)


def _no_answer_correctness(case: EvalCase, answer: RagAnswer) -> float:
    is_no_answer = answer.confidence == "insufficient_source" or bool(answer.missing_information)
    has_sources = bool(answer.citations or answer.used_chunks)
    if case.expected_no_answer:
        return 1.0 if is_no_answer and not has_sources else 0.0
    return 0.0 if is_no_answer else 1.0


def _faithfulness(
    case: EvalCase,
    retrieve_response: RetrieveResponse,
    answer: RagAnswer,
    no_answer_correctness: float,
) -> float:
    if case.expected_no_answer:
        return no_answer_correctness
    if not answer.answer.strip() or not answer.citations:
        return 0.0

    support_ids = {chunk.chunk_id for chunk in retrieve_response.chunks} | set(answer.used_chunks)
    cited_ids = {citation.chunk_id for citation in answer.citations}
    if not cited_ids:
        return 0.0
    return len(cited_ids & support_ids) / len(cited_ids)


def _matched_citations(expected: list[ExpectedCitation], actual: list[Citation]) -> int:
    matched = 0
    used_actual_indexes: set[int] = set()
    for expected_citation in expected:
        for index, actual_citation in enumerate(actual):
            if index in used_actual_indexes:
                continue
            if _citation_matches(expected_citation, actual_citation):
                matched += 1
                used_actual_indexes.add(index)
                break
    return matched


def _citation_matches(expected: ExpectedCitation, actual: Citation) -> bool:
    if expected.chunk_id and actual.chunk_id != expected.chunk_id:
        return False
    if expected.document_id and actual.document_id != expected.document_id:
        return False
    if expected.document_version_id and actual.document_version_id != expected.document_version_id:
        return False
    if expected.page_number and actual.page_number != expected.page_number:
        return False
    if expected.section_path and actual.section_path != expected.section_path:
        return False
    return True


def _summarize(results: list[EvaluationCaseResult]) -> EvaluationSummary:
    return EvaluationSummary(
        total_cases=len(results),
        passed_cases=sum(1 for result in results if result.status == "passed"),
        failed_cases=sum(1 for result in results if result.status == "failed"),
        error_cases=sum(1 for result in results if result.status == "error"),
        average_score=_average([result.overall_score for result in results]),
        average_latency_ms=_average([result.latency_ms for result in results]),
        retrieval_precision=_average([result.retrieval_metrics.precision for result in results]),
        retrieval_recall=_average([result.retrieval_metrics.recall for result in results]),
        citation_correctness=_average([result.citation_metrics.correctness for result in results]),
        answer_correctness=_average([result.answer_metrics.answer_correctness for result in results]),
        faithfulness=_average([result.answer_metrics.faithfulness for result in results]),
        no_answer_correctness=_average([result.answer_metrics.no_answer_correctness for result in results]),
    )


def _error_result(*, case: EvalCase, started: float, code: str, message: str) -> EvaluationCaseResult:
    zero_retrieval = RetrievalMetrics(
        expected_relevant_count=len(case.expected_relevant_chunk_ids),
        retrieved_count=0,
        relevant_retrieved_count=0,
        precision=0,
        recall=0,
        hit_rate=0,
        mrr=0,
    )
    zero_citation = CitationMetrics(
        expected_citation_count=len(case.expected_citations),
        actual_citation_count=0,
        matched_citation_count=0,
        precision=0,
        recall=0,
        correctness=0,
    )
    zero_answer = AnswerMetrics(
        expected_term_count=len(case.expected_answer_terms),
        matched_term_count=0,
        forbidden_term_violations=[],
        term_coverage=0,
        answer_correctness=0,
        faithfulness=0,
        no_answer_correctness=0,
    )
    return EvaluationCaseResult(
        case_id=case.case_id,
        query_id=None,
        status="error",
        overall_score=0,
        latency_ms=_elapsed_ms(started),
        retrieval_latency_ms=0,
        answer_latency_ms=0,
        retrieval_metrics=zero_retrieval,
        citation_metrics=zero_citation,
        answer_metrics=zero_answer,
        error_code=code,
        error_message=message,
    )


def _mrr(retrieved: list[str], expected: set[str]) -> float:
    for index, chunk_id in enumerate(retrieved, start=1):
        if chunk_id in expected:
            return 1 / index
    return 0.0


def _average(values: list[float]) -> float:
    return _round(mean(values)) if values else 0.0


def _elapsed_ms(started: float) -> float:
    return _round((time.perf_counter() - started) * 1000, digits=2)


def _round(value: float, *, digits: int = 4) -> float:
    return round(value, digits)


def _excerpt(value: str, max_chars: int) -> str:
    if max_chars <= 0:
        return ""
    if len(value) <= max_chars:
        return value
    return value[: max_chars - 3].rstrip() + "..."


def _normalize(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    ascii_value = decomposed.encode("ascii", "ignore").decode("ascii")
    return " ".join(ascii_value.casefold().split())
