from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette import status
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import ConfigError, Settings, load_settings
from app.errors import (
    IngestionError,
    http_error_handler,
    ingestion_error_handler,
    unexpected_error_handler,
    validation_error_handler,
)
from app.ids import make_id, utcnow
from app.logging import configure_logging
from app.middleware import CorrelationIdMiddleware
from app.object_storage import ObjectStorageClient
from app.pipeline import IngestionPipeline
from app.registry_client import RegistryClient
from app.schemas import (
    HealthResponse,
    IngestionJobCreate,
    IngestionJobResponse,
    IngestionReport,
    JobStatus,
    ReadinessResponse,
    ReindexRequest,
    ReindexResponse,
    StoredJob,
)
from app.security import AuthContext, auth_context_for_request, require_service_auth
from app.store import JobStore
from chunkers.logical import LogicalStructureChunker
from embeddings.client import EmbeddingClient
from indexers.qdrant import QdrantIndexer
from parsers.router import ParserRouter

logger = logging.getLogger("akl.ingestion")


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or load_settings()
    configure_logging(resolved_settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):  # type: ignore[no-untyped-def]
        app.state.settings = resolved_settings
        app.state.store = JobStore(resolved_settings.job_store_path)
        app.state.registry = RegistryClient(resolved_settings)
        app.state.object_storage = ObjectStorageClient(resolved_settings)
        app.state.parser_router = ParserRouter(resolved_settings)
        app.state.chunker = LogicalStructureChunker(resolved_settings)
        app.state.embedding_client = EmbeddingClient(resolved_settings)
        app.state.indexer = QdrantIndexer(resolved_settings)
        app.state.pipeline = IngestionPipeline(
            store=app.state.store,
            registry=app.state.registry,
            object_storage=app.state.object_storage,
            parser_router=app.state.parser_router,
            chunker=app.state.chunker,
            embedding_client=app.state.embedding_client,
            indexer=app.state.indexer,
        )
        yield

    app = FastAPI(
        title="AKL Ingestion Service",
        version=resolved_settings.service_version,
        description=(
            "Document ingestion service for parsing, OCR fallback, logical chunking, embeddings, "
            "Qdrant indexing, and ingestion reports. It does not publish document versions."
        ),
        lifespan=lifespan,
    )
    app.add_middleware(CorrelationIdMiddleware)
    app.add_exception_handler(IngestionError, ingestion_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_error_handler)
    app.add_exception_handler(Exception, unexpected_error_handler)

    @app.get("/health", response_model=HealthResponse, tags=["health"])
    async def health(request: Request) -> HealthResponse:
        settings = _settings(request)
        return HealthResponse(
            status="ok",
            service=settings.service_name,
            version=settings.service_version,
        )

    @app.get("/ready", response_model=ReadinessResponse, tags=["health"])
    async def ready(request: Request) -> ReadinessResponse:
        settings = _settings(request)
        checks = {
            "registry": await _registry(request).readiness(),
            "embeddings": await _embedding_client(request).readiness(),
            "indexer": await _indexer(request).readiness(),
            "job_store": "ready" if settings.job_store_path.exists() else "not_ready",
        }
        ready_status = "ready" if all(value in {"ready", "mock"} for value in checks.values()) else "not_ready"
        return ReadinessResponse(status=ready_status, service=settings.service_name, checks=checks)

    @app.post(
        "/api/v1/ingestion/jobs",
        response_model=IngestionJobResponse,
        status_code=status.HTTP_201_CREATED,
        tags=["ingestion"],
    )
    async def create_ingestion_job(
        payload: IngestionJobCreate,
        request: Request,
    ) -> IngestionJobResponse:
        auth_context = _guard_request(request)
        settings = _settings(request)
        subject_id = auth_context.subject_id
        job = IngestionJobResponse(
            job_id=make_id("ing"),
            status=JobStatus.queued,
            document_id=payload.document_id,
            document_version_id=payload.document_version_id,
            source_file_uri=payload.source_file_uri,
            parser_profile=payload.parser_profile,
            ocr_enabled=payload.ocr_enabled,
            chunking_strategy=payload.chunking_strategy,
            embedding_profile=payload.embedding_profile,
            created_at=utcnow(),
        )
        stored_job = _store(request).create(StoredJob(request=payload, job=job))
        logger.info(
            "ingestion_job_created job_id=%s document_id=%s document_version_id=%s",
            job.job_id,
            payload.document_id,
            payload.document_version_id,
        )
        if settings.process_jobs_inline:
            stored_job = await _pipeline(request).run(
                stored_job,
                subject_id=subject_id,
                auth_context=auth_context,
            )
        return stored_job.job

    @app.get(
        "/api/v1/ingestion/jobs",
        response_model=list[IngestionJobResponse],
        tags=["ingestion"],
    )
    async def list_ingestion_jobs(request: Request) -> list[IngestionJobResponse]:
        _guard_request(request)
        jobs = [stored_job.job for stored_job in _store(request).list()]
        return sorted(jobs, key=lambda item: item.created_at, reverse=True)

    @app.get(
        "/api/v1/ingestion/jobs/{job_id}",
        response_model=IngestionJobResponse,
        tags=["ingestion"],
    )
    async def get_ingestion_job(job_id: str, request: Request) -> IngestionJobResponse:
        _guard_request(request)
        return _store(request).get(job_id).job

    @app.get(
        "/api/v1/ingestion/jobs/{job_id}/report",
        response_model=IngestionReport,
        tags=["ingestion"],
    )
    async def get_ingestion_report(job_id: str, request: Request) -> IngestionReport:
        _guard_request(request)
        stored_job = _store(request).get(job_id)
        if stored_job.report is None:
            raise IngestionError("REPORT_NOT_READY", "Ingestion report is not available yet", status_code=404)
        return stored_job.report

    @app.post(
        "/api/v1/ingestion/jobs/{job_id}/cancel",
        response_model=IngestionJobResponse,
        tags=["ingestion"],
    )
    async def cancel_ingestion_job(job_id: str, request: Request) -> IngestionJobResponse:
        _guard_request(request)
        stored_job = _store(request).get(job_id)
        if stored_job.job.status in {
            JobStatus.completed,
            JobStatus.completed_with_warnings,
            JobStatus.failed,
            JobStatus.cancelled,
        }:
            raise IngestionError(
                "JOB_NOT_CANCELLABLE",
                "Only queued or running ingestion jobs can be cancelled",
                status_code=409,
                details={"status": stored_job.job.status.value},
            )
        updated = _store(request).update_status(job_id, JobStatus.cancelled, finished_at=utcnow())
        return updated.job

    @app.post(
        "/api/v1/ingestion/reindex",
        response_model=ReindexResponse,
        tags=["ingestion"],
    )
    async def reindex(payload: ReindexRequest, request: Request) -> ReindexResponse:
        auth_context = _guard_request(request)
        settings = _settings(request)
        subject_id = auth_context.subject_id
        accepted_jobs: list[str] = []
        rejected_items: list[dict] = []

        for item in payload.items:
            try:
                await _registry(request).require_authorized(
                    subject_id=subject_id,
                    action="document.reindex",
                    document_id=item.document_id,
                    document_version_id=item.document_version_id,
                    auth_context=auth_context,
                )
                job = IngestionJobResponse(
                    job_id=make_id("ing"),
                    status=JobStatus.queued,
                    document_id=item.document_id,
                    document_version_id=item.document_version_id,
                    source_file_uri=item.source_file_uri,
                    parser_profile=item.parser_profile,
                    ocr_enabled=item.ocr_enabled,
                    chunking_strategy=item.chunking_strategy,
                    embedding_profile=item.embedding_profile,
                    created_at=utcnow(),
                )
                stored_job = _store(request).create(StoredJob(request=item, job=job))
                accepted_jobs.append(job.job_id)
                if settings.process_jobs_inline:
                    await _pipeline(request).run(
                        stored_job,
                        subject_id=subject_id,
                        auth_context=auth_context,
                    )
            except IngestionError as exc:
                rejected_items.append(
                    {
                        "document_id": item.document_id,
                        "document_version_id": item.document_version_id,
                        "code": exc.code,
                        "message": exc.message,
                    }
                )

        return ReindexResponse(accepted_jobs=accepted_jobs, rejected_items=rejected_items)

    return app


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _store(request: Request) -> JobStore:
    return request.app.state.store


def _registry(request: Request) -> RegistryClient:
    return request.app.state.registry


def _embedding_client(request: Request) -> EmbeddingClient:
    return request.app.state.embedding_client


def _indexer(request: Request) -> QdrantIndexer:
    return request.app.state.indexer


def _pipeline(request: Request) -> IngestionPipeline:
    return request.app.state.pipeline


def _guard_request(request: Request) -> AuthContext:
    require_service_auth(request, _settings(request))
    return auth_context_for_request(request, _settings(request))


try:
    app = create_app()
except ConfigError as exc:
    logger.critical("configuration_error reason=%s", exc)
    raise
