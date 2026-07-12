from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.config import Settings
from app.errors import EvaluationError
from app.rag_client import RagClient
from app.registry_client import RegistryClient
from app.quality import compare_runs, evaluate_quality_gate, quality_thresholds
from app.schemas import (
    DatasetSummary,
    EvaluationDataset,
    EvaluationDatasetCreate,
    EvaluationRun,
    EvaluationRunRequest,
    EvaluationRunSummary,
    QualityOverview,
)
from app.security import EvaluationPrincipal
from app.store import DatasetStore, RunStore, dataset_from_create
from runners.evaluator import EvaluationRunner

logger = logging.getLogger(__name__)


class EvaluationService:
    def __init__(
        self,
        *,
        settings: Settings,
        dataset_store: DatasetStore,
        run_store: RunStore,
        rag_client: RagClient,
        registry_client: RegistryClient,
    ) -> None:
        self._settings = settings
        self._dataset_store = dataset_store
        self._run_store = run_store
        self._rag_client = rag_client
        self._registry_client = registry_client
        self._runner = EvaluationRunner(settings=settings, rag_client=rag_client)

    def list_datasets(self, principal: EvaluationPrincipal) -> list[DatasetSummary]:
        return [
            dataset
            for dataset in self._dataset_store.list_datasets()
            if _dataset_visible(dataset, principal)
        ]

    def get_dataset(self, dataset_id: str, principal: EvaluationPrincipal) -> EvaluationDataset:
        dataset = self._dataset_store.get_dataset(dataset_id)
        _require_dataset_visible(dataset, principal)
        return dataset

    def create_dataset(
        self,
        payload: EvaluationDatasetCreate,
        principal: EvaluationPrincipal,
    ) -> EvaluationDataset:
        _validate_case_limit(len(payload.cases), self._settings.max_cases_per_run)
        if payload.visibility == "shared" and not _can_manage_all(principal):
            raise EvaluationError(
                "SHARED_DATASET_FORBIDDEN",
                "Only administrators and evaluation services can create shared datasets",
                status_code=403,
            )
        return self._dataset_store.create_dataset(
            payload,
            owner_subject_id=principal.subject_id,
        )

    async def run_evaluation(
        self,
        payload: EvaluationRunRequest,
        principal: EvaluationPrincipal,
    ) -> EvaluationRun:
        effective_payload = _effective_run_request(payload, principal)
        dataset = self._resolve_dataset(effective_payload, principal)
        selected_count = _selected_case_count(dataset, effective_payload)
        _validate_case_limit(selected_count, self._settings.max_cases_per_run)
        baseline = self._run_store.latest_comparable_for_dataset(dataset.dataset_id)

        logger.info(
            "evaluation_run_started dataset_id=%s case_count=%s query_text_logged=false answer_text_logged=false",
            dataset.dataset_id,
            selected_count,
        )
        run = await self._runner.run(
            dataset,
            effective_payload,
            actor_subject_id=principal.subject_id,
            actor_roles=list(principal.roles),
            bearer_token=principal.bearer_token,
        )
        run = run.model_copy(
            update={
                "quality_gate": evaluate_quality_gate(run, self._settings),
                "comparison": compare_runs(run, baseline),
            }
        )
        self._run_store.save_run(run)
        await self._audit_run(run, bearer_token=principal.bearer_token)
        logger.info(
            "evaluation_run_completed run_id=%s dataset_id=%s status=%s average_score=%s",
            run.run_id,
            run.dataset_id,
            run.status,
            run.summary.average_score,
        )
        return run

    def list_runs(
        self,
        principal: EvaluationPrincipal,
        *,
        dataset_id: str | None = None,
        limit: int = 20,
    ) -> list[EvaluationRunSummary]:
        runs = self._run_store.list_runs(dataset_id=dataset_id, limit=max(limit * 4, limit))
        if not _can_manage_all(principal):
            runs = [run for run in runs if run.actor_subject_id == principal.subject_id]
        return runs[:limit]

    def get_run(self, run_id: str, principal: EvaluationPrincipal) -> EvaluationRun:
        run = self._run_store.get_run(run_id)
        if run.actor_subject_id not in {None, principal.subject_id} and not _can_manage_all(principal):
            raise EvaluationError(
                "RUN_FORBIDDEN",
                "Evaluation run is not available for the current subject",
                status_code=403,
            )
        return run

    def quality_overview(
        self,
        principal: EvaluationPrincipal,
        *,
        dataset_id: str | None = None,
        limit: int = 20,
    ) -> QualityOverview:
        datasets = self.list_datasets(principal)
        visible_dataset_ids = {dataset.dataset_id for dataset in datasets}
        selected_dataset_id = dataset_id if dataset_id in visible_dataset_ids else None
        runs = self.list_runs(principal, dataset_id=selected_dataset_id, limit=limit)
        latest_run = self.get_run(runs[0].run_id, principal) if runs else None
        return QualityOverview(
            datasets=datasets,
            recent_runs=runs,
            latest_run=latest_run,
            thresholds=quality_thresholds(self._settings),
            generated_at=datetime.now(timezone.utc),
        )

    async def readiness(self) -> dict[str, str]:
        statuses = {
            "dataset-store": self._dataset_store.readiness(),
            "report-store": self._run_store.readiness(),
            "rag-retrieval-service": await self._rag_client.readiness(),
        }
        if self._settings.audit_enabled:
            statuses["registry-api"] = await self._registry_client.readiness()
        else:
            statuses["registry-api"] = "disabled"
        return statuses

    def _resolve_dataset(
        self,
        payload: EvaluationRunRequest,
        principal: EvaluationPrincipal,
    ) -> EvaluationDataset:
        if payload.dataset is not None:
            dataset_id = payload.dataset.dataset_id or "inline"
            return dataset_from_create(
                payload.dataset,
                dataset_id=dataset_id,
                owner_subject_id=principal.subject_id,
            )
        if payload.dataset_id is None:
            raise EvaluationError("DATASET_REQUIRED", "Evaluation dataset is required", status_code=400)
        dataset = self._dataset_store.get_dataset(payload.dataset_id)
        _require_dataset_visible(dataset, principal)
        return dataset

    async def _audit_run(self, run: EvaluationRun, *, bearer_token: str | None) -> None:
        if not self._settings.audit_enabled:
            return
        try:
            await self._registry_client.write_audit_event(
                event_type="evaluation.run.completed",
                resource_id=run.run_id,
                metadata={
                    "dataset_id": run.dataset_id,
                    "status": run.status,
                    "total_cases": run.summary.total_cases,
                    "passed_cases": run.summary.passed_cases,
                    "failed_cases": run.summary.failed_cases,
                    "error_cases": run.summary.error_cases,
                    "average_score": run.summary.average_score,
                    "query_text_logged": False,
                    "answer_text_logged": False,
                    "quality_gate": run.quality_gate.status if run.quality_gate else "not_evaluated",
                },
                bearer_token=bearer_token,
            )
        except Exception as exc:
            logger.warning(
                "evaluation_audit_failed run_id=%s reason=%s",
                run.run_id,
                exc.__class__.__name__,
            )


def _selected_case_count(dataset: EvaluationDataset, payload: EvaluationRunRequest) -> int:
    if payload.case_ids:
        return len(payload.case_ids)
    if payload.max_cases is not None:
        return min(payload.max_cases, len(dataset.cases))
    return len(dataset.cases)


def _validate_case_limit(case_count: int, max_cases_per_run: int) -> None:
    if case_count > max_cases_per_run:
        raise EvaluationError(
            "EVALUATION_CASE_LIMIT_EXCEEDED",
            "Evaluation run exceeds configured case limit",
            status_code=400,
            details={"case_count": case_count, "max_cases_per_run": max_cases_per_run},
        )


def _effective_run_request(
    payload: EvaluationRunRequest,
    principal: EvaluationPrincipal,
) -> EvaluationRunRequest:
    if principal.trusted_service or _can_manage_all(principal):
        return payload
    return payload.model_copy(update={"subject_id_override": principal.subject_id})


def _can_manage_all(principal: EvaluationPrincipal) -> bool:
    if principal.trusted_service:
        return True
    return "akb:manage_access" in principal.capabilities


def _dataset_visible(dataset: DatasetSummary, principal: EvaluationPrincipal) -> bool:
    return (
        dataset.visibility == "shared"
        or dataset.owner_subject_id in {None, principal.subject_id}
        or _can_manage_all(principal)
    )


def _require_dataset_visible(
    dataset: EvaluationDataset,
    principal: EvaluationPrincipal,
) -> None:
    summary = DatasetSummary(
        dataset_id=dataset.dataset_id,
        name=dataset.name,
        description=dataset.description,
        tags=dataset.tags,
        case_count=len(dataset.cases),
        created_at=dataset.created_at,
        visibility=dataset.visibility,
        owner_subject_id=dataset.owner_subject_id,
    )
    if not _dataset_visible(summary, principal):
        raise EvaluationError(
            "DATASET_FORBIDDEN",
            "Evaluation dataset is not available for the current subject",
            status_code=403,
        )
