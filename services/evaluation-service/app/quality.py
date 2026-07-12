from __future__ import annotations

import math
from statistics import mean

from app.config import Settings
from app.schemas import (
    EvaluationCaseResult,
    EvaluationRun,
    QualityGateCheck,
    QualityGateResult,
    QualityThresholds,
    RunComparison,
)


def quality_thresholds(settings: Settings) -> QualityThresholds:
    return QualityThresholds(
        retrieval_recall_min=settings.gate_retrieval_recall_min,
        retrieval_ndcg_min=settings.gate_retrieval_ndcg_min,
        false_zero_result_rate_max=settings.gate_false_zero_result_rate_max,
        authorization_leak_rate_max=settings.gate_authorization_leak_rate_max,
        citation_traceability_min=settings.gate_citation_traceability_min,
        retrieval_latency_p95_ms_max=settings.gate_retrieval_latency_p95_ms_max,
    )


def evaluate_quality_gate(run: EvaluationRun, settings: Settings) -> QualityGateResult:
    eligible = [case for case in run.cases if case.judgment_status != "draft" and case.status != "error"]
    answerable = [case for case in eligible if not case.expected_no_answer]
    full_answer = [case for case in eligible if not case.retrieval_only]
    authorization_cases = [case for case in eligible if case.query_category == "authorization"]
    checks = [
        _minimum_check(
            "retrieval_recall",
            _average([case.retrieval_metrics.recall for case in eligible]),
            settings.gate_retrieval_recall_min,
            eligible=bool(eligible),
        ),
        _minimum_check(
            "retrieval_ndcg",
            _average([case.retrieval_metrics.ndcg for case in eligible]),
            settings.gate_retrieval_ndcg_min,
            eligible=bool(eligible),
        ),
        _maximum_check(
            "false_zero_result_rate",
            _rate(
                sum(case.retrieval_metrics.false_zero_result for case in answerable),
                len(answerable),
            ),
            settings.gate_false_zero_result_rate_max,
            eligible=bool(answerable),
        ),
        _maximum_check(
            "authorization_leak_rate",
            _average([case.retrieval_metrics.authorization_leak_rate for case in authorization_cases]),
            settings.gate_authorization_leak_rate_max,
            eligible=bool(authorization_cases),
        ),
        _minimum_check(
            "citation_traceability",
            _average([case.answer_metrics.faithfulness for case in full_answer]),
            settings.gate_citation_traceability_min,
            eligible=bool(full_answer),
        ),
        _maximum_check(
            "retrieval_latency_p95_ms",
            _percentile([case.retrieval_latency_ms for case in eligible], 0.95),
            settings.gate_retrieval_latency_p95_ms_max,
            eligible=bool(eligible),
        ),
    ]
    evaluated = [check for check in checks if check.eligible]
    status = "not_evaluated" if not evaluated else "passed" if all(check.passed for check in evaluated) else "failed"
    return QualityGateResult(
        status=status,
        checks=checks,
        eligible_cases=len(eligible),
        excluded_draft_cases=sum(case.judgment_status == "draft" for case in run.cases),
    )


def compare_runs(run: EvaluationRun, baseline: EvaluationRun | None) -> RunComparison | None:
    if baseline is None:
        return None
    current = run.summary
    previous = baseline.summary
    deltas = {
        "average_score": _round(current.average_score - previous.average_score),
        "retrieval_recall": _round(current.retrieval_recall - previous.retrieval_recall),
        "retrieval_ndcg": _round(current.retrieval_ndcg - previous.retrieval_ndcg),
        "false_zero_result_rate": _round(
            current.false_zero_result_rate - previous.false_zero_result_rate
        ),
        "citation_traceability": _round(
            current.citation_traceability - previous.citation_traceability
        ),
        "retrieval_latency_p95_ms": _round(
            current.retrieval_latency_p95_ms - previous.retrieval_latency_p95_ms,
            digits=2,
        ),
    }
    regressions = []
    for key in ("average_score", "retrieval_recall", "retrieval_ndcg", "citation_traceability"):
        if deltas[key] < -0.01:
            regressions.append(key)
    if deltas["false_zero_result_rate"] > 0.01:
        regressions.append("false_zero_result_rate")
    if deltas["retrieval_latency_p95_ms"] > max(100, previous.retrieval_latency_p95_ms * 0.20):
        regressions.append("retrieval_latency_p95_ms")
    return RunComparison(
        baseline_run_id=baseline.run_id,
        average_score_delta=deltas["average_score"],
        retrieval_recall_delta=deltas["retrieval_recall"],
        retrieval_ndcg_delta=deltas["retrieval_ndcg"],
        false_zero_result_rate_delta=deltas["false_zero_result_rate"],
        citation_traceability_delta=deltas["citation_traceability"],
        retrieval_latency_p95_ms_delta=deltas["retrieval_latency_p95_ms"],
        regressions=regressions,
    )


def _minimum_check(key: str, actual: float, threshold: float, *, eligible: bool) -> QualityGateCheck:
    return QualityGateCheck(
        key=key,
        actual=actual,
        operator=">=",
        threshold=threshold,
        passed=not eligible or actual >= threshold,
        eligible=eligible,
    )


def _maximum_check(key: str, actual: float, threshold: float, *, eligible: bool) -> QualityGateCheck:
    return QualityGateCheck(
        key=key,
        actual=actual,
        operator="<=",
        threshold=threshold,
        passed=not eligible or actual <= threshold,
        eligible=eligible,
    )


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


def _round(value: float, *, digits: int = 4) -> float:
    return round(value, digits)
