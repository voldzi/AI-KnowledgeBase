from __future__ import annotations

import asyncio
import hashlib
import logging
import math
import time
import unicodedata
import uuid
from collections import Counter
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
    EvaluationSliceSummary,
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

    async def run(
        self,
        dataset: EvaluationDataset,
        request: EvaluationRunRequest,
        *,
        actor_subject_id: str | None = None,
        actor_roles: list[str] | None = None,
        bearer_token: str | None = None,
    ) -> EvaluationRun:
        selected_cases = _select_cases(dataset, request)
        started_at = datetime.now(timezone.utc)
        semaphore = asyncio.Semaphore(self._settings.concurrency)

        async def run_bounded(case: EvalCase) -> EvaluationCaseResult:
            async with semaphore:
                return await self._run_case(case, request, bearer_token=bearer_token)

        results = list(await asyncio.gather(*(run_bounded(case) for case in selected_cases)))
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
                "concurrency": self._settings.concurrency,
                "answer_excerpt_chars": self._settings.answer_excerpt_chars,
            },
            actor_subject_id=actor_subject_id,
            actor_roles=sorted(set(actor_roles or [])),
        )

    async def _run_case(
        self,
        case: EvalCase,
        request: EvaluationRunRequest,
        *,
        bearer_token: str | None,
    ) -> EvaluationCaseResult:
        subject_id = request.subject_id_override or case.subject_id
        retrieve_payload = RetrieveRequest(
            subject_id=subject_id,
            query=case.query,
            filters=case.filters,
            max_chunks=max(case.max_chunks, *case.retrieval_cutoffs),
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
            retrieve_response = await self._rag_client.retrieve(retrieve_payload, bearer_token=bearer_token)
            retrieval_latency_ms = _elapsed_ms(retrieve_started)

            if case.answer_mode == "retrieve_only":
                return _evaluate_success(
                    case=case,
                    retrieve_response=retrieve_response,
                    answer=None,
                    pass_threshold=self._settings.pass_threshold,
                    answer_excerpt_chars=self._settings.answer_excerpt_chars,
                    latency_ms=_elapsed_ms(started),
                    retrieval_latency_ms=retrieval_latency_ms,
                    answer_latency_ms=0,
                )

            answer_started = time.perf_counter()
            answer = await self._rag_client.query(query_payload, bearer_token=bearer_token)
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
    answer: RagAnswer | None,
    pass_threshold: float,
    answer_excerpt_chars: int,
    latency_ms: float,
    retrieval_latency_ms: float,
    answer_latency_ms: float,
) -> EvaluationCaseResult:
    retrieval_metrics = _retrieval_metrics(case, retrieve_response)
    retrieval_only = answer is None
    citation_metrics = _neutral_citation_metrics() if retrieval_only else _citation_metrics(case, answer)
    answer_metrics = _neutral_answer_metrics() if retrieval_only else _answer_metrics(case, retrieve_response, answer)
    overall_score = _overall_score(
        retrieval_metrics=retrieval_metrics,
        citation_metrics=citation_metrics,
        answer_metrics=answer_metrics,
        expected_no_answer=case.expected_no_answer,
        retrieval_only=retrieval_only,
    )
    status = "passed" if overall_score >= pass_threshold else "failed"
    warnings = sorted(set(retrieve_response.warnings + (answer.warnings if answer else [])))
    failure_stage = _failure_stage(
        case=case,
        retrieval_metrics=retrieval_metrics,
        citation_metrics=citation_metrics,
        answer_metrics=answer_metrics,
        retrieval_only=retrieval_only,
    )
    return EvaluationCaseResult(
        case_id=case.case_id,
        query_id=(answer.query_id if answer else None) or retrieve_response.query_id,
        status=status,
        overall_score=overall_score,
        latency_ms=latency_ms,
        retrieval_latency_ms=retrieval_latency_ms,
        answer_latency_ms=answer_latency_ms,
        confidence=answer.confidence if answer else None,
        retrieval_metrics=retrieval_metrics,
        citation_metrics=citation_metrics,
        answer_metrics=answer_metrics,
        retrieved_chunk_ids=[chunk.chunk_id for chunk in retrieve_response.chunks],
        used_chunks=answer.used_chunks if answer else [],
        actual_citations=answer.citations if answer else [],
        warnings=warnings,
        answer_excerpt=_excerpt(answer.answer, answer_excerpt_chars) if answer else "",
        answer_sha256=hashlib.sha256(answer.answer.encode("utf-8")).hexdigest() if answer else None,
        role=case.role,
        query_category=case.query_category,
        judgment_status=case.judgment_status,
        expected_no_answer=case.expected_no_answer,
        retrieval_only=retrieval_only,
        failure_stage=failure_stage,
        expected_retrieval_profile=case.expected_retrieval_profile,
        actual_retrieval_profile=retrieve_response.retrieval_profile,
        router_correct=(
            retrieve_response.retrieval_profile == case.expected_retrieval_profile
            if case.expected_retrieval_profile is not None
            else None
        ),
        retrieval_diagnostics=retrieve_response.retrieval_diagnostics,
    )


def _retrieval_metrics(case: EvalCase, retrieve_response: RetrieveResponse) -> RetrievalMetrics:
    judged_relevance = {judgment.chunk_id: judgment.relevance for judgment in case.relevance_judgments}
    expected_chunks = set(case.expected_relevant_chunk_ids) | {
        chunk_id for chunk_id, relevance in judged_relevance.items() if relevance > 0
    }
    expected_documents = set(case.expected_relevant_document_ids)
    primary_chunks = retrieve_response.chunks[: case.max_chunks]
    retrieved = [chunk.chunk_id for chunk in primary_chunks]
    retrieved_documents = [chunk.citation.document_id for chunk in primary_chunks]
    retrieved_set = set(retrieved)
    retrieved_document_set = set(retrieved_documents)
    matched_chunks = expected_chunks & retrieved_set
    matched_documents = expected_documents & retrieved_document_set
    relevance_by_rank = [
        max(
            judged_relevance.get(chunk.chunk_id, 0),
            3 if chunk.chunk_id in expected_chunks else 0,
            3 if chunk.citation.document_id in expected_documents else 0,
        )
        for chunk in primary_chunks
    ]
    relevant_retrieved_count = sum(1 for relevance in relevance_by_rank if relevance > 0)
    expected_count = len(expected_chunks) + len(expected_documents)

    if expected_count:
        precision = relevant_retrieved_count / len(retrieved) if retrieved else 0.0
        recall = (len(matched_chunks) + len(matched_documents)) / expected_count
        hit_rate = 1.0 if relevant_retrieved_count else 0.0
        mrr = _mrr_from_relevance(relevance_by_rank)
        ideal_relevances = sorted(
            [max(judged_relevance.get(chunk_id, 3), 1) for chunk_id in expected_chunks]
            + [3 for _ in expected_documents],
            reverse=True,
        )
        ndcg = _ndcg(relevance_by_rank, ideal_relevances)
    else:
        precision = 1.0 if not retrieved else 0.0
        recall = 1.0
        hit_rate = 1.0 if not retrieved else 0.0
        mrr = 1.0 if not retrieved else 0.0
        ndcg = 1.0 if not retrieved else 0.0

    forbidden_retrieved = set(case.expected_forbidden_chunk_ids) & retrieved_set
    authorization_leak_rate = (
        len(forbidden_retrieved) / len(set(case.expected_forbidden_chunk_ids))
        if case.expected_forbidden_chunk_ids
        else 0.0
    )
    zero_result = not retrieved
    recall_at_k: dict[str, float] = {}
    ndcg_at_k: dict[str, float] = {}
    for cutoff in case.retrieval_cutoffs:
        cutoff_chunks = retrieve_response.chunks[:cutoff]
        cutoff_chunk_ids = {chunk.chunk_id for chunk in cutoff_chunks}
        cutoff_document_ids = {chunk.citation.document_id for chunk in cutoff_chunks}
        cutoff_relevance = [
            max(
                judged_relevance.get(chunk.chunk_id, 0),
                3 if chunk.chunk_id in expected_chunks else 0,
                3 if chunk.citation.document_id in expected_documents else 0,
            )
            for chunk in cutoff_chunks
        ]
        if expected_count:
            cutoff_recall = (
                len(expected_chunks & cutoff_chunk_ids)
                + len(expected_documents & cutoff_document_ids)
            ) / expected_count
            cutoff_ndcg = _ndcg(cutoff_relevance, ideal_relevances)
        else:
            cutoff_recall = 1.0 if not cutoff_chunks else 0.0
            cutoff_ndcg = 1.0 if not cutoff_chunks else 0.0
        recall_at_k[str(cutoff)] = _round(cutoff_recall)
        ndcg_at_k[str(cutoff)] = _round(cutoff_ndcg)

    return RetrievalMetrics(
        expected_relevant_count=len(expected_chunks),
        retrieved_count=len(retrieved),
        relevant_retrieved_count=relevant_retrieved_count,
        precision=_round(precision),
        recall=_round(recall),
        hit_rate=_round(hit_rate),
        mrr=_round(mrr),
        ndcg=_round(ndcg),
        expected_relevant_document_count=len(expected_documents),
        relevant_document_retrieved_count=len(matched_documents),
        zero_result=zero_result,
        false_zero_result=zero_result and not case.expected_no_answer,
        forbidden_retrieved_count=len(forbidden_retrieved),
        authorization_leak_rate=_round(authorization_leak_rate),
        recall_at_k=recall_at_k,
        ndcg_at_k=ndcg_at_k,
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
    claims = [claim for claim in answer.claims if isinstance(claim, dict)]
    supported_claim_count = sum(claim.get("supported") is True for claim in claims)
    supported_claim_rate = supported_claim_count / len(claims) if claims else 0.0
    return AnswerMetrics(
        expected_term_count=len(case.expected_answer_terms),
        matched_term_count=len(matched_terms),
        forbidden_term_violations=forbidden,
        term_coverage=_round(term_coverage),
        answer_correctness=_round(answer_correctness),
        faithfulness=_round(faithfulness),
        no_answer_correctness=_round(no_answer_correctness),
        total_claim_count=len(claims),
        supported_claim_count=supported_claim_count,
        supported_claim_rate=_round(supported_claim_rate),
    )


def _overall_score(
    *,
    retrieval_metrics: RetrievalMetrics,
    citation_metrics: CitationMetrics,
    answer_metrics: AnswerMetrics,
    expected_no_answer: bool,
    retrieval_only: bool,
) -> float:
    retrieval_score = (
        retrieval_metrics.precision
        + retrieval_metrics.recall
        + retrieval_metrics.mrr
        + retrieval_metrics.ndcg
    ) / 4
    if retrieval_only:
        return _round(retrieval_score)
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
    answerable_results = [result for result in results if not result.expected_no_answer]
    full_answer_results = [result for result in results if not result.retrieval_only]
    claim_results = [
        result for result in full_answer_results if result.answer_metrics.total_claim_count > 0
    ]
    no_answer_results = [result for result in full_answer_results if result.expected_no_answer]
    router_results = [result for result in results if result.router_correct is not None]
    recall_at_8_results = [
        result for result in results if "8" in result.retrieval_metrics.recall_at_k
    ]
    recall_at_50_results = [
        result for result in results if "50" in result.retrieval_metrics.recall_at_k
    ]
    failures = Counter(result.failure_stage for result in results if result.failure_stage != "none")
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
        retrieval_hit_rate=_average([result.retrieval_metrics.hit_rate for result in results]),
        retrieval_mrr=_average([result.retrieval_metrics.mrr for result in results]),
        retrieval_ndcg=_average([result.retrieval_metrics.ndcg for result in results]),
        zero_result_rate=_rate(sum(result.retrieval_metrics.zero_result for result in results), len(results)),
        false_zero_result_rate=_rate(
            sum(result.retrieval_metrics.false_zero_result for result in answerable_results),
            len(answerable_results),
        ),
        authorization_leak_rate=_average(
            [result.retrieval_metrics.authorization_leak_rate for result in results]
        ),
        citation_traceability=_average(
            [result.answer_metrics.faithfulness for result in full_answer_results]
        )
        if full_answer_results
        else 1.0,
        retrieval_latency_p50_ms=_percentile(
            [result.retrieval_latency_ms for result in results], 0.50
        ),
        retrieval_latency_p95_ms=_percentile(
            [result.retrieval_latency_ms for result in results], 0.95
        ),
        total_latency_p95_ms=_percentile([result.latency_ms for result in results], 0.95),
        full_answer_cases=len(full_answer_results),
        retrieval_only_cases=sum(result.retrieval_only for result in results),
        draft_cases=sum(result.judgment_status == "draft" for result in results),
        silver_cases=sum(result.judgment_status == "silver" for result in results),
        gold_cases=sum(result.judgment_status == "gold" for result in results),
        failure_counts=dict(sorted(failures.items())),
        role_slices=_slice_summaries(results, key_name="role"),
        query_category_slices=_slice_summaries(results, key_name="query_category"),
        retrieval_recall_at_8=_average(
            [result.retrieval_metrics.recall_at_k["8"] for result in recall_at_8_results]
        ),
        retrieval_recall_at_50=_average(
            [result.retrieval_metrics.recall_at_k["50"] for result in recall_at_50_results]
        ),
        supported_claim_rate=_average(
            [result.answer_metrics.supported_claim_rate for result in claim_results]
        ),
        false_answer_rate=_rate(
            sum(result.answer_metrics.no_answer_correctness < 1 for result in no_answer_results),
            len(no_answer_results),
        ),
        router_accuracy=_rate(
            sum(result.router_correct is True for result in router_results),
            len(router_results),
        ),
        claim_evaluated_cases=len(claim_results),
        no_answer_evaluated_cases=len(no_answer_results),
        router_evaluated_cases=len(router_results),
        recall_at_50_evaluated_cases=len(recall_at_50_results),
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
        ndcg=0,
        zero_result=True,
        false_zero_result=not case.expected_no_answer,
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
        role=case.role,
        query_category=case.query_category,
        judgment_status=case.judgment_status,
        expected_no_answer=case.expected_no_answer,
        retrieval_only=case.answer_mode == "retrieve_only",
        failure_stage="error",
        expected_retrieval_profile=case.expected_retrieval_profile,
    )


def _mrr_from_relevance(relevances: list[int]) -> float:
    for index, relevance in enumerate(relevances, start=1):
        if relevance > 0:
            return 1 / index
    return 0.0


def _ndcg(relevances: list[int], ideal_relevances: list[int]) -> float:
    if not ideal_relevances:
        return 1.0 if not relevances else 0.0
    dcg = _discounted_gain(relevances)
    ideal_dcg = _discounted_gain(ideal_relevances[: len(relevances) or len(ideal_relevances)])
    return min(1.0, dcg / ideal_dcg) if ideal_dcg else 0.0


def _discounted_gain(relevances: list[int]) -> float:
    return sum((2**relevance - 1) / math.log2(rank + 1) for rank, relevance in enumerate(relevances, 1))


def _average(values: list[float]) -> float:
    return _round(mean(values)) if values else 0.0


def _rate(numerator: int, denominator: int) -> float:
    return _round(numerator / denominator) if denominator else 0.0


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    position = (len(ordered) - 1) * percentile
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return _round(ordered[lower], digits=2)
    interpolated = ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)
    return _round(interpolated, digits=2)


def _slice_summaries(
    results: list[EvaluationCaseResult],
    *,
    key_name: str,
) -> list[EvaluationSliceSummary]:
    keys = sorted({str(getattr(result, key_name)) for result in results})
    summaries: list[EvaluationSliceSummary] = []
    for key in keys:
        selected = [result for result in results if str(getattr(result, key_name)) == key]
        answerable = [result for result in selected if not result.expected_no_answer]
        full_answer = [result for result in selected if not result.retrieval_only]
        summaries.append(
            EvaluationSliceSummary(
                key=key,
                total_cases=len(selected),
                average_score=_average([result.overall_score for result in selected]),
                retrieval_recall=_average([result.retrieval_metrics.recall for result in selected]),
                retrieval_ndcg=_average([result.retrieval_metrics.ndcg for result in selected]),
                false_zero_result_rate=_rate(
                    sum(result.retrieval_metrics.false_zero_result for result in answerable),
                    len(answerable),
                ),
                citation_traceability=(
                    _average([result.answer_metrics.faithfulness for result in full_answer])
                    if full_answer
                    else 1.0
                ),
                retrieval_latency_p95_ms=_percentile(
                    [result.retrieval_latency_ms for result in selected], 0.95
                ),
            )
        )
    return summaries


def _neutral_citation_metrics() -> CitationMetrics:
    return CitationMetrics(
        expected_citation_count=0,
        actual_citation_count=0,
        matched_citation_count=0,
        precision=1,
        recall=1,
        correctness=1,
    )


def _neutral_answer_metrics() -> AnswerMetrics:
    return AnswerMetrics(
        expected_term_count=0,
        matched_term_count=0,
        forbidden_term_violations=[],
        term_coverage=1,
        answer_correctness=1,
        faithfulness=1,
        no_answer_correctness=1,
    )


def _failure_stage(
    *,
    case: EvalCase,
    retrieval_metrics: RetrievalMetrics,
    citation_metrics: CitationMetrics,
    answer_metrics: AnswerMetrics,
    retrieval_only: bool,
) -> str:
    if retrieval_metrics.forbidden_retrieved_count:
        return "authorization"
    if retrieval_metrics.false_zero_result:
        return "retrieval_no_match"
    if case.expected_no_answer and answer_metrics.no_answer_correctness < 1:
        return "no_answer"
    if any(
        metric < 1
        for metric in (
            retrieval_metrics.precision,
            retrieval_metrics.recall,
            retrieval_metrics.hit_rate,
            retrieval_metrics.mrr,
            retrieval_metrics.ndcg,
        )
    ):
        return "retrieval_relevance"
    if retrieval_only:
        return "none"
    if citation_metrics.correctness < 1:
        return "citation"
    if answer_metrics.answer_correctness < 1 or answer_metrics.faithfulness < 1:
        return "answer"
    return "none"


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
