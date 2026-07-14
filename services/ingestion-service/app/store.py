from __future__ import annotations

import fcntl
import hashlib
import os
import threading
import uuid
from pathlib import Path

from app.errors import IngestionError
from app.schemas import IngestionJobResponse, IngestionReport, JobStatus, StoredJob


class JobStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        self._lock = threading.Lock()
        self._run_handles: dict[str, int] = {}
        self.root.mkdir(parents=True, exist_ok=True)

    def create(self, stored_job: StoredJob) -> StoredJob:
        with self._lock:
            path = self._path(stored_job.job.job_id)
            if path.exists():
                raise IngestionError("JOB_CONFLICT", "Ingestion job already exists", status_code=409)
            self._write_new(path, stored_job)
            return stored_job

    def create_or_replay(self, stored_job: StoredJob) -> tuple[StoredJob, bool]:
        if not stored_job.request_hash:
            raise ValueError("request_hash is required for idempotent job creation")
        path = self._path(stored_job.job.job_id)
        with self._lock:
            created = self._write_new(path, stored_job)
            if created:
                return stored_job, False
            existing = self.get(stored_job.job.job_id)
            if (
                existing.request.idempotency_key != stored_job.request.idempotency_key
                or existing.request_hash != stored_job.request_hash
            ):
                raise IngestionError(
                    "IDEMPOTENCY_CONFLICT",
                    "The idempotency key is already bound to another ingestion payload",
                    status_code=409,
                )
            return existing, True

    def get(self, job_id: str) -> StoredJob:
        path = self._path(job_id)
        if not path.exists():
            raise IngestionError("JOB_NOT_FOUND", "Ingestion job was not found", status_code=404)
        return StoredJob.model_validate_json(path.read_text(encoding="utf-8"))

    def update_job(self, job: IngestionJobResponse) -> StoredJob:
        with self._lock:
            stored_job = self.get(job.job_id)
            updated = stored_job.model_copy(update={"job": job})
            self._write(self._path(job.job_id), updated)
            return updated

    def update_status(
        self,
        job_id: str,
        status: JobStatus,
        *,
        started_at=None,
        finished_at=None,
        expected_statuses: frozenset[JobStatus] | set[JobStatus] | None = None,
    ) -> StoredJob:
        with self._lock:
            stored_job = self.get(job_id)
            if expected_statuses is not None and stored_job.job.status not in expected_statuses:
                raise IngestionError(
                    "JOB_STATE_CONFLICT",
                    "The ingestion job state changed concurrently",
                    status_code=409,
                    details={
                        "current_status": stored_job.job.status.value,
                        "requested_status": status.value,
                    },
                )
            job = stored_job.job.model_copy(
                update={
                    "status": status,
                    "started_at": started_at if started_at is not None else stored_job.job.started_at,
                    "finished_at": finished_at if finished_at is not None else stored_job.job.finished_at,
                }
            )
            updated = stored_job.model_copy(update={"job": job})
            self._write(self._path(job_id), updated)
            return updated

    def update_report(self, job_id: str, report: IngestionReport) -> StoredJob:
        with self._lock:
            stored_job = self.get(job_id)
            job = stored_job.job.model_copy(update={"status": report.status})
            updated = stored_job.model_copy(update={"job": job, "report": report})
            self._write(self._path(job_id), updated)
            return updated

    def request_cancel(self, job_id: str) -> StoredJob:
        """Durably record cancellation before any fallible Registry handshake."""
        with self._lock:
            stored_job = self.get(job_id)
            if stored_job.job.status not in {
                JobStatus.pending_authorization,
                JobStatus.claiming,
                JobStatus.queued,
            }:
                raise IngestionError(
                    "JOB_NOT_CANCELLABLE",
                    "Only an ingestion attempt that has not started can be cancelled",
                    status_code=409,
                    details={"status": stored_job.job.status.value},
                )
            if stored_job.cancel_requested:
                return stored_job
            updated = stored_job.model_copy(update={"cancel_requested": True})
            self._write(self._path(job_id), updated)
            return updated

    def set_pending_external_status(self, job_id: str, status: str) -> StoredJob:
        if status not in {"INDEXED", "FAILED"}:
            raise ValueError("Only terminal Registry statuses may be queued for reconciliation")
        with self._lock:
            stored_job = self.get(job_id)
            updated = stored_job.model_copy(update={"pending_external_status": status})
            self._write(self._path(job_id), updated)
            return updated

    def finalize(
        self,
        job_id: str,
        *,
        status: JobStatus,
        report: IngestionReport,
        pending_external_status: str | None,
        finished_at,
        expected_statuses: frozenset[JobStatus] | set[JobStatus],
    ) -> StoredJob:
        if status not in {
            JobStatus.completed,
            JobStatus.completed_with_warnings,
            JobStatus.failed,
            JobStatus.cancelled,
        }:
            raise ValueError("Only terminal ingestion states may be finalized")
        if pending_external_status not in {None, "INDEXED", "FAILED"}:
            raise ValueError("Unsupported pending Registry status")
        with self._lock:
            stored_job = self.get(job_id)
            if stored_job.job.status not in expected_statuses:
                raise IngestionError(
                    "JOB_STATE_CONFLICT",
                    "The ingestion job state changed concurrently",
                    status_code=409,
                    details={
                        "current_status": stored_job.job.status.value,
                        "requested_status": status.value,
                    },
                )
            job = stored_job.job.model_copy(
                update={"status": status, "finished_at": finished_at}
            )
            updated = stored_job.model_copy(
                update={
                    "job": job,
                    "report": report,
                    "pending_external_status": pending_external_status,
                }
            )
            self._write(self._path(job_id), updated)
            return updated

    def clear_pending_external_status(self, job_id: str, *, expected_status: str) -> StoredJob:
        with self._lock:
            stored_job = self.get(job_id)
            if stored_job.pending_external_status != expected_status:
                raise IngestionError(
                    "EXTERNAL_STATUS_STATE_CONFLICT",
                    "The pending Registry status changed concurrently",
                    status_code=409,
                )
            updated = stored_job.model_copy(update={"pending_external_status": None})
            self._write(self._path(job_id), updated)
            return updated

    def list(self) -> list[StoredJob]:
        return [self.get(path.stem) for path in sorted(self.root.glob("ing_*.json"))]

    def readiness(self) -> str:
        probe = self.root / f".readiness.{uuid.uuid4().hex}.tmp"
        descriptor: int | None = None
        try:
            descriptor = os.open(probe, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o640)
            os.write(descriptor, b"ready\n")
            _sync_file(descriptor)
            os.close(descriptor)
            descriptor = None
            probe.unlink()
            self._sync_root()
            return "ready"
        except OSError:
            return "not_ready"
        finally:
            if descriptor is not None:
                os.close(descriptor)
            probe.unlink(missing_ok=True)

    def acquire_run(self, job_id: str) -> bool:
        with self._lock:
            if job_id in self._run_handles:
                return False
            lock_path = self.root / f".{job_id}.run.lock"
            descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o640)
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                os.close(descriptor)
                return False
            self._run_handles[job_id] = descriptor
            return True

    def release_run(self, job_id: str) -> None:
        with self._lock:
            descriptor = self._run_handles.pop(job_id, None)
            if descriptor is None:
                return
            fcntl.flock(descriptor, fcntl.LOCK_UN)
            os.close(descriptor)

    def _path(self, job_id: str) -> Path:
        return self.root / f"{job_id}.json"

    def _write_new(self, path: Path, stored_job: StoredJob) -> bool:
        tmp_path = self.root / f".{path.name}.{uuid.uuid4().hex}.tmp"
        self._write_synced_file(tmp_path, stored_job)
        try:
            os.link(tmp_path, path)
        except FileExistsError:
            return False
        finally:
            tmp_path.unlink(missing_ok=True)
        self._sync_root()
        return True

    def _write(self, path: Path, stored_job: StoredJob) -> None:
        tmp_path = self.root / f".{path.name}.{uuid.uuid4().hex}.tmp"
        self._write_synced_file(tmp_path, stored_job)
        os.replace(tmp_path, path)
        self._sync_root()

    def _write_synced_file(self, path: Path, stored_job: StoredJob) -> None:
        payload = stored_job.model_dump_json(indent=2).encode("utf-8")
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o640)
        try:
            view = memoryview(payload)
            while view:
                written = os.write(descriptor, view)
                view = view[written:]
            _sync_file(descriptor)
        finally:
            os.close(descriptor)

    def _sync_root(self) -> None:
        descriptor = os.open(self.root, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def idempotent_job_id(client_id: str, idempotency_key: str) -> str:
    digest = hashlib.sha256(f"{client_id}\0{idempotency_key}".encode("utf-8")).hexdigest()
    return f"ing_{digest[:32]}"


def _sync_file(descriptor: int) -> None:
    sync = getattr(os, "fdatasync", os.fsync)
    sync(descriptor)
