from __future__ import annotations

import logging

from app.config import Settings
from app.errors import EvaluationError
from app.rag_client import RagClient
from app.registry_client import RegistryClient
from app.schemas import (
    DatasetSummary,
    EvaluationDataset,
    EvaluationDatasetCreate,
    EvaluationRun,
    EvaluationRunRequest,
)
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

    def list_datasets(self) -> list[DatasetSummary]:
        return self._dataset_store.list_datasets()

    def create_dataset(self, payload: EvaluationDatasetCreate) -> EvaluationDataset:
        _validate_case_limit(len(payload.cases), self._settings.max_cases_per_run)
        return self._dataset_store.create_dataset(payload)

    async def run_evaluation(self, payload: EvaluationRunRequest) -> EvaluationRun:
        dataset = self._resolve_dataset(payload)
        selected_count = _selected_case_count(dataset, payload)
        _validate_case_limit(selected_count, self._settings.max_cases_per_run)

        logger.info(
            "evaluation_run_started dataset_id=%s case_count=%s query_text_logged=false answer_text_logged=false",
            dataset.dataset_id,
            selected_count,
        )
        run = await self._runner.run(dataset, payload)
        self._run_store.save_run(run)
        await self._audit_run(run)
        logger.info(
            "evaluation_run_completed run_id=%s dataset_id=%s status=%s average_score=%s",
            run.run_id,
            run.dataset_id,
            run.status,
            run.summary.average_score,
        )
        return run

    def get_run(self, run_id: str) -> EvaluationRun:
        return self._run_store.get_run(run_id)

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

    def _resolve_dataset(self, payload: EvaluationRunRequest) -> EvaluationDataset:
        if payload.dataset is not None:
            dataset_id = payload.dataset.dataset_id or "inline"
            return dataset_from_create(payload.dataset, dataset_id=dataset_id)
        if payload.dataset_id is None:
            raise EvaluationError("DATASET_REQUIRED", "Evaluation dataset is required", status_code=400)
        return self._dataset_store.get_dataset(payload.dataset_id)

    async def _audit_run(self, run: EvaluationRun) -> None:
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
                },
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
