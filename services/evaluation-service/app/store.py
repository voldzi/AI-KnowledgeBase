from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.errors import EvaluationError
from app.schemas import DatasetSummary, EvaluationDataset, EvaluationDatasetCreate, EvaluationRun

DATASET_ID_PATTERN = re.compile(r"^[A-Za-z0-9_.:-]+$")


class DatasetStore:
    def __init__(self, base_dir: str) -> None:
        self._base_dir = Path(base_dir)
        self._base_dir.mkdir(parents=True, exist_ok=True)

    def list_datasets(self) -> list[DatasetSummary]:
        datasets = [self._load_dataset(path) for path in sorted(self._base_dir.glob("*.json"))]
        return [
            DatasetSummary(
                dataset_id=dataset.dataset_id,
                name=dataset.name,
                description=dataset.description,
                tags=dataset.tags,
                case_count=len(dataset.cases),
                created_at=dataset.created_at,
            )
            for dataset in datasets
        ]

    def get_dataset(self, dataset_id: str) -> EvaluationDataset:
        path = self._path_for(dataset_id)
        if not path.exists():
            raise EvaluationError(
                "DATASET_NOT_FOUND",
                "Evaluation dataset was not found",
                status_code=404,
                details={"dataset_id": dataset_id},
            )
        return self._load_dataset(path)

    def create_dataset(self, payload: EvaluationDatasetCreate) -> EvaluationDataset:
        dataset_id = payload.dataset_id or _slug_dataset_id(payload.name)
        path = self._path_for(dataset_id)
        if path.exists():
            raise EvaluationError(
                "DATASET_ALREADY_EXISTS",
                "Evaluation dataset already exists",
                status_code=409,
                details={"dataset_id": dataset_id},
            )

        dataset = dataset_from_create(payload, dataset_id=dataset_id)
        self._write_json(path, dataset.model_dump(mode="json"))
        return dataset

    def readiness(self) -> str:
        return "ready" if self._base_dir.exists() and self._base_dir.is_dir() else "not_ready"

    def _path_for(self, dataset_id: str) -> Path:
        if not DATASET_ID_PATTERN.match(dataset_id):
            raise EvaluationError(
                "INVALID_DATASET_ID",
                "Dataset id contains unsupported characters",
                status_code=400,
                details={"dataset_id": dataset_id},
            )
        return self._base_dir / f"{dataset_id}.json"

    def _load_dataset(self, path: Path) -> EvaluationDataset:
        try:
            return EvaluationDataset.model_validate_json(path.read_text(encoding="utf-8"))
        except Exception as exc:
            raise EvaluationError(
                "DATASET_INVALID",
                "Evaluation dataset file is invalid",
                status_code=500,
                details={"path": str(path), "reason": exc.__class__.__name__},
            ) from exc

    def _write_json(self, path: Path, payload: dict[str, object]) -> None:
        path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


class RunStore:
    def __init__(self, base_dir: str) -> None:
        self._base_dir = Path(base_dir)
        self._base_dir.mkdir(parents=True, exist_ok=True)

    def save_run(self, run: EvaluationRun) -> None:
        path = self._path_for(run.run_id)
        path.write_text(run.model_dump_json(indent=2), encoding="utf-8")

    def get_run(self, run_id: str) -> EvaluationRun:
        path = self._path_for(run_id)
        if not path.exists():
            raise EvaluationError(
                "RUN_NOT_FOUND",
                "Evaluation run was not found",
                status_code=404,
                details={"run_id": run_id},
            )
        try:
            return EvaluationRun.model_validate_json(path.read_text(encoding="utf-8"))
        except Exception as exc:
            raise EvaluationError(
                "RUN_INVALID",
                "Evaluation run file is invalid",
                status_code=500,
                details={"run_id": run_id, "reason": exc.__class__.__name__},
            ) from exc

    def readiness(self) -> str:
        return "ready" if self._base_dir.exists() and self._base_dir.is_dir() else "not_ready"

    def _path_for(self, run_id: str) -> Path:
        if not DATASET_ID_PATTERN.match(run_id):
            raise EvaluationError(
                "INVALID_RUN_ID",
                "Run id contains unsupported characters",
                status_code=400,
                details={"run_id": run_id},
            )
        return self._base_dir / f"{run_id}.json"


def dataset_from_create(payload: EvaluationDatasetCreate, *, dataset_id: str | None = None) -> EvaluationDataset:
    resolved_dataset_id = dataset_id or payload.dataset_id or _slug_dataset_id(payload.name)
    return EvaluationDataset(
        dataset_id=resolved_dataset_id,
        name=payload.name,
        description=payload.description,
        tags=payload.tags,
        cases=payload.cases,
        metadata=payload.metadata,
        created_at=datetime.now(timezone.utc),
    )


def _slug_dataset_id(name: str) -> str:
    base = re.sub(r"[^A-Za-z0-9_.:-]+", "-", name.strip().lower()).strip("-")
    if not base:
        base = "dataset"
    return f"{base}-{uuid.uuid4().hex[:8]}"
