from __future__ import annotations

import threading
from pathlib import Path

from app.errors import IngestionError
from app.schemas import IngestionJobResponse, IngestionReport, JobStatus, StoredJob


class JobStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        self._lock = threading.Lock()
        self.root.mkdir(parents=True, exist_ok=True)

    def create(self, stored_job: StoredJob) -> StoredJob:
        with self._lock:
            path = self._path(stored_job.job.job_id)
            if path.exists():
                raise IngestionError("JOB_CONFLICT", "Ingestion job already exists", status_code=409)
            self._write(path, stored_job)
            return stored_job

    def get(self, job_id: str) -> StoredJob:
        path = self._path(job_id)
        if not path.exists():
            raise IngestionError("JOB_NOT_FOUND", "Ingestion job was not found", status_code=404)
        return StoredJob.model_validate_json(path.read_text(encoding="utf-8"))

    def update_job(self, job: IngestionJobResponse) -> StoredJob:
        with self._lock:
            stored_job = self.get(job.job_id)
            updated = StoredJob(request=stored_job.request, job=job, report=stored_job.report)
            self._write(self._path(job.job_id), updated)
            return updated

    def update_status(
        self,
        job_id: str,
        status: JobStatus,
        *,
        started_at=None,
        finished_at=None,
    ) -> StoredJob:
        with self._lock:
            stored_job = self.get(job_id)
            job = stored_job.job.model_copy(
                update={
                    "status": status,
                    "started_at": started_at if started_at is not None else stored_job.job.started_at,
                    "finished_at": finished_at if finished_at is not None else stored_job.job.finished_at,
                }
            )
            updated = StoredJob(request=stored_job.request, job=job, report=stored_job.report)
            self._write(self._path(job_id), updated)
            return updated

    def update_report(self, job_id: str, report: IngestionReport) -> StoredJob:
        with self._lock:
            stored_job = self.get(job_id)
            job = stored_job.job.model_copy(update={"status": report.status})
            updated = StoredJob(request=stored_job.request, job=job, report=report)
            self._write(self._path(job_id), updated)
            return updated

    def list(self) -> list[StoredJob]:
        return [self.get(path.stem) for path in sorted(self.root.glob("ing_*.json"))]

    def _path(self, job_id: str) -> Path:
        return self.root / f"{job_id}.json"

    def _write(self, path: Path, stored_job: StoredJob) -> None:
        tmp_path = path.with_suffix(".tmp")
        tmp_path.write_text(stored_job.model_dump_json(indent=2), encoding="utf-8")
        tmp_path.replace(path)
