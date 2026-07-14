from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import shutil
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from starlette import status
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import ConfigError, Settings, load_settings
from app.context import get_correlation_id
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
    AnalystSearchRequest,
    AnalystSearchResponse,
    HealthResponse,
    IngestionJobCreate,
    IngestionJobResponse,
    IngestionReport,
    EntityFacetReport,
    EntityFacetRequest,
    EntityRelationshipRequest,
    EntityRelationshipResponse,
    EntitySearchRequest,
    EntitySearchResponse,
    IntelligenceDocumentCoordinate,
    JobStatus,
    ReadinessResponse,
    ReindexRequest,
    ReindexResponse,
    ReportMessage,
    StoredJob,
)
from app.security import AuthContext, auth_context_for_request, require_service_auth
from app.store import JobStore, idempotent_job_id
from app.telemetry import configure_telemetry
from chunkers.logical import LogicalStructureChunker
from embeddings.client import EmbeddingClient
from indexers.factory import create_indexer
from parsers.router import ParserRouter

logger = logging.getLogger("akl.ingestion")
ACTOR_SUBJECT_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,127}$")
GLOBAL_JOB_LIST_ROLES = frozenset(
    {
        "admin",
        "akl_admin",
        "akb_admin",
        "document_manager",
        "akl_document_manager",
    }
)


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
        app.state.indexer = create_indexer(resolved_settings)
        app.state.pipeline = IngestionPipeline(
            store=app.state.store,
            registry=app.state.registry,
            object_storage=app.state.object_storage,
            parser_router=app.state.parser_router,
            chunker=app.state.chunker,
            embedding_client=app.state.embedding_client,
            indexer=app.state.indexer,
        )
        app.state.recovery_task = asyncio.create_task(_recovery_loop(app))
        try:
            yield
        finally:
            app.state.recovery_task.cancel()
            with suppress(asyncio.CancelledError):
                await app.state.recovery_task

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
    configure_telemetry(
        app,
        service_name=resolved_settings.service_name,
        service_version=resolved_settings.service_version,
    )

    @app.get("/health", response_model=HealthResponse, tags=["health"])
    async def health(request: Request) -> HealthResponse:
        settings = _settings(request)
        return HealthResponse(
            status="ok",
            service=settings.service_name,
            version=settings.service_version,
        )

    @app.get(
        "/ready",
        response_model=ReadinessResponse,
        responses={
            status.HTTP_503_SERVICE_UNAVAILABLE: {
                "model": ReadinessResponse,
                "description": "Registry identity or another required dependency is not ready",
            }
        },
        tags=["health"],
    )
    async def ready(request: Request, response: Response) -> ReadinessResponse:
        transport_context = _guard_request(request)
        _require_readiness_transport(transport_context)
        if request.headers.get("X-AKL-On-Behalf-Of") is not None:
            raise IngestionError(
                "DELEGATED_ACTOR_FORBIDDEN",
                "Readiness must use only the exact transport identity",
                status_code=403,
            )
        settings = _settings(request)
        checks = {
            "registry": await _registry(request).readiness(),
            "embeddings": await _embedding_client(request).readiness(),
            "indexer": await _indexer(request).readiness(),
            "job_store": _store(request).readiness(),
            "object_storage": _object_storage(request).readiness(),
            "parser": _parser_readiness(settings),
            "worker": "ready" if settings.process_jobs_inline else "not_ready",
        }
        ready_status = "ready" if all(value in {"ready", "mock"} for value in checks.values()) else "not_ready"
        if ready_status != "ready":
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return ReadinessResponse(status=ready_status, service=settings.service_name, checks=checks)

    @app.get(
        "/api/v1/integrations/web-ingestion/readiness",
        tags=["health"],
    )
    async def web_ingestion_transport_readiness(request: Request) -> dict[str, str]:
        """Non-mutating deployment proof for the exact web ingestion client."""
        transport_context = _guard_request(request)
        _require_web_transport(transport_context)
        if (
            request.headers.get("X-AKL-On-Behalf-Of") is not None
            or request.headers.get("X-AKL-Ingestion-Authorization") is not None
        ):
            raise IngestionError(
                "WEB_INGESTION_PREFLIGHT_DELEGATION_FORBIDDEN",
                "The web ingestion transport preflight must not include actor delegation",
                status_code=403,
            )
        return {
            "status": "ready",
            "service": _settings(request).service_name,
            "client_id": "svc-akb-web-ingestion",
            "role": "service_akb_web_ingestion",
        }

    @app.post(
        "/api/v1/ingestion/jobs",
        response_model=IngestionJobResponse,
        status_code=status.HTTP_201_CREATED,
        tags=["ingestion"],
    )
    async def create_ingestion_job(
        payload: IngestionJobCreate,
        request: Request,
        response: Response,
    ) -> IngestionJobResponse:
        transport_context = _guard_request(request)
        _require_web_transport(transport_context)
        delegated_actor_context = _delegated_actor_context(request)
        authorization_proof = _ingestion_authorization_proof(request)
        settings = _settings(request)
        client_namespace = transport_context.service_client_id
        if not client_namespace:
            raise IngestionError(
                "WEB_INGESTION_TRANSPORT_REQUIRED",
                "The exact web ingestion transport identity is required",
                status_code=403,
            )
        confirmed_subject_id, authorization_id = await _registry(
            request
        ).confirm_ingestion_authorization(
            authorization_token=authorization_proof,
            expected_subject_id=delegated_actor_context.subject_id,
            action="document.ingest",
            document_id=payload.document_id,
            document_version_id=payload.document_version_id,
            correlation_id=get_correlation_id(),
            idempotency_key=payload.idempotency_key,
        )
        if confirmed_subject_id != delegated_actor_context.subject_id:
            raise IngestionError(
                "REGISTRY_AUTHORIZATION_CONFLICT",
                "Registry confirmed another actor than the delegated transport subject",
                status_code=502,
            )
        actor_context = _confirmed_actor_context(confirmed_subject_id)
        authoritative_claim_requested = (
            "expected_current_ingestion_job_id" in payload.model_fields_set
        )
        request_hash = _ingestion_request_hash(
            payload,
            actor_subject_id=actor_context.subject_id,
            client_namespace=client_namespace,
            authoritative_claim_requested=authoritative_claim_requested,
        )
        job = IngestionJobResponse(
            job_id=idempotent_job_id(client_namespace, payload.idempotency_key),
            status=JobStatus.pending_authorization,
            document_id=payload.document_id,
            document_version_id=payload.document_version_id,
            source_file_uri=payload.source_file_uri,
            extraction_profile=payload.extraction_profile or settings.default_extraction_profile,
            parser_profile=payload.parser_profile,
            ocr_enabled=payload.ocr_enabled,
            chunking_strategy=payload.chunking_strategy,
            embedding_profile=payload.embedding_profile,
            created_at=utcnow(),
        )
        stored_job, replayed = _store(request).create_or_replay(
            StoredJob(
                request=payload,
                job=job,
                request_hash=request_hash,
                authoritative_claim_requested=authoritative_claim_requested,
                actor_subject_id=actor_context.subject_id,
                actor_authorization_id=authorization_id,
                transport_client_id=transport_context.service_client_id,
            )
        )
        if not _has_confirmed_durable_lineage(stored_job):
            _quarantine_incomplete_durable_job(_store(request), stored_job)
            raise IngestionError(
                "DURABLE_AUTHORIZATION_LINEAGE_INVALID",
                "The durable ingestion authorization lineage is invalid",
                status_code=409,
            )
        logger.info(
            "ingestion_job_created job_id=%s document_id=%s document_version_id=%s replayed=%s",
            job.job_id,
            payload.document_id,
            payload.document_version_id,
            replayed,
        )
        store = _store(request)
        should_reconcile = bool(
            stored_job.pending_external_status is not None
            or stored_job.job.status in {
                JobStatus.pending_authorization,
                JobStatus.claiming,
                JobStatus.queued,
                JobStatus.starting,
                JobStatus.running,
            }
        )
        if should_reconcile and store.acquire_run(stored_job.job.job_id):
            try:
                stored_job = store.get(stored_job.job.job_id)
                if stored_job.pending_external_status is not None:
                    stored_job = await _pipeline(request).reconcile_terminal_status(
                        stored_job,
                        auth_context=actor_context,
                    )
                if stored_job.cancel_requested:
                    stored_job = await _complete_requested_cancellation(
                        store,
                        _registry(request),
                        _pipeline(request),
                        stored_job,
                        actor_context=actor_context,
                    )
                elif (
                    stored_job.job.status in {JobStatus.pending_authorization, JobStatus.claiming}
                    and (
                        stored_job.authoritative_claim_requested
                        or (
                            replayed
                            and await _authoritative_claim_is_ready(
                                _registry(request),
                                stored_job,
                            )
                        )
                    )
                ):
                    stored_job = await _claim_ingestion_attempt(
                        request,
                        stored_job,
                        actor_context=actor_context,
                    )
                if settings.process_jobs_inline and stored_job.job.status in {
                    JobStatus.queued,
                    JobStatus.starting,
                    JobStatus.running,
                }:
                    stored_job = await _pipeline(request).run(
                        stored_job,
                        subject_id=actor_context.subject_id,
                        auth_context=actor_context,
                    )
            finally:
                store.release_run(stored_job.job.job_id)
        else:
            stored_job = store.get(stored_job.job.job_id)
        if stored_job.job.status in {JobStatus.pending_authorization, JobStatus.claiming}:
            response.status_code = status.HTTP_202_ACCEPTED
        elif replayed:
            response.status_code = status.HTTP_200_OK
        if replayed:
            response.headers["Idempotency-Replayed"] = "true"
        return stored_job.job

    @app.get(
        "/api/v1/ingestion/jobs",
        response_model=list[IngestionJobResponse],
        tags=["ingestion"],
    )
    async def list_ingestion_jobs(request: Request) -> list[IngestionJobResponse]:
        auth_context = _guard_request(request)
        _reject_web_transport(auth_context)
        if not _can_list_all_jobs(auth_context, _settings(request)):
            raise IngestionError(
                "JOB_LIST_FORBIDDEN",
                "Global ingestion job listing requires an operational role",
                status_code=403,
            )
        jobs = [stored_job.job for stored_job in _store(request).list()]
        return sorted(jobs, key=lambda item: item.created_at, reverse=True)

    @app.get(
        "/api/v1/ingestion/jobs/{job_id}",
        response_model=IngestionJobResponse,
        tags=["ingestion"],
    )
    async def get_ingestion_job(job_id: str, request: Request) -> IngestionJobResponse:
        auth_context = _guard_job_operation_request(request)
        stored_job = _store(request).get(job_id)
        await _require_job_read(request, stored_job, auth_context)
        return stored_job.job

    @app.get(
        "/api/v1/ingestion/jobs/{job_id}/report",
        response_model=IngestionReport,
        tags=["ingestion"],
    )
    async def get_ingestion_report(job_id: str, request: Request) -> IngestionReport:
        auth_context = _guard_job_operation_request(request)
        stored_job = _store(request).get(job_id)
        await _require_job_read(request, stored_job, auth_context)
        if stored_job.report is None:
            raise IngestionError("REPORT_NOT_READY", "Ingestion report is not available yet", status_code=404)
        return stored_job.report

    @app.get(
        "/api/v1/intelligence/entities/facets",
        response_model=EntityFacetReport,
        tags=["intelligence"],
    )
    async def get_entity_facets(
        request: Request,
        limit: int = Query(default=8, ge=1, le=50),
        value_limit: int = Query(default=10, ge=1, le=50),
    ) -> EntityFacetReport:
        auth_context = _guard_non_transport_request(request)
        if not _can_list_all_jobs(auth_context, _settings(request)):
            raise IngestionError(
                "GOVERNED_FACET_QUERY_REQUIRED",
                "Production facets require the governed scoped POST contract",
                status_code=403,
            )
        indexer = _indexer(request)
        if not hasattr(indexer, "entity_facets"):
            settings = _settings(request)
            return EntityFacetReport(
                status="unavailable",
                index_name=settings.opensearch_index,
                total_chunks=0,
                chunks_with_entities=0,
                generated_at=utcnow(),
                warnings=[
                    ReportMessage(
                        code="OPENSEARCH_INDEXER_NOT_CONFIGURED",
                        message="OpenSearch indexer is not configured for entity facets.",
                    )
                ],
            )
        return await indexer.entity_facets(
            limit=limit,
            value_limit=value_limit,
            authorized_documents=[],
        )

    @app.post(
        "/api/v1/intelligence/entities/facets/query",
        response_model=EntityFacetReport,
        tags=["intelligence"],
    )
    async def query_entity_facets(
        payload: EntityFacetRequest,
        request: Request,
    ) -> EntityFacetReport:
        auth_context = _guard_non_transport_request(request)
        authorized_documents = await _require_authorized_document_scope(
            request,
            auth_context,
            [item.document_id for item in payload.authorized_documents],
            payload.authorized_documents,
        )
        indexer = _indexer(request)
        if not hasattr(indexer, "entity_facets"):
            settings = _settings(request)
            return EntityFacetReport(
                status="unavailable",
                index_name=settings.opensearch_index,
                total_chunks=0,
                chunks_with_entities=0,
                generated_at=utcnow(),
                warnings=[
                    ReportMessage(
                        code="OPENSEARCH_INDEXER_NOT_CONFIGURED",
                        message="OpenSearch indexer is not configured for entity facets.",
                    )
                ],
            )
        return await indexer.entity_facets(
            limit=payload.limit,
            value_limit=payload.value_limit,
            authorized_documents=[item.model_dump() for item in authorized_documents],
        )

    @app.post(
        "/api/v1/intelligence/entities/search",
        response_model=EntitySearchResponse,
        tags=["intelligence"],
    )
    async def search_entities(
        payload: EntitySearchRequest,
        request: Request,
    ) -> EntitySearchResponse:
        auth_context = _guard_non_transport_request(request)
        authorized_documents = await _require_authorized_document_scope(
            request,
            auth_context,
            payload.allowed_document_ids,
            payload.authorized_documents,
        )
        payload = _bind_intelligence_request_to_authorized_documents(
            payload,
            authorized_documents,
        )
        indexer = _indexer(request)
        if not hasattr(indexer, "entity_search"):
            settings = _settings(request)
            return EntitySearchResponse(
                status="unavailable",
                index_name=settings.opensearch_index,
                total_hits=0,
                returned_hits=0,
                hits=[],
                generated_at=utcnow(),
                warnings=[
                    ReportMessage(
                        code="OPENSEARCH_INDEXER_NOT_CONFIGURED",
                        message="OpenSearch indexer is not configured for entity search.",
                    )
                ],
        )
        return await indexer.entity_search(payload)

    @app.post(
        "/api/v1/intelligence/analyst/search",
        response_model=AnalystSearchResponse,
        tags=["intelligence"],
    )
    async def analyst_search(
        payload: AnalystSearchRequest,
        request: Request,
    ) -> AnalystSearchResponse:
        auth_context = _guard_non_transport_request(request)
        authorized_documents = await _require_authorized_document_scope(
            request,
            auth_context,
            payload.allowed_document_ids,
            payload.authorized_documents,
        )
        payload = _bind_intelligence_request_to_authorized_documents(
            payload,
            authorized_documents,
        )
        indexer = _indexer(request)
        if not hasattr(indexer, "analyst_search"):
            settings = _settings(request)
            return AnalystSearchResponse(
                status="unavailable",
                index_name=settings.opensearch_index,
                query_mode=payload.query_mode,
                total_hits=0,
                returned_hits=0,
                hits=[],
                generated_at=utcnow(),
                warnings=[
                    ReportMessage(
                        code="OPENSEARCH_INDEXER_NOT_CONFIGURED",
                        message="OpenSearch indexer is not configured for analyst search.",
                    )
                ],
            )
        return await indexer.analyst_search(payload)

    @app.post(
        "/api/v1/intelligence/entities/relationships",
        response_model=EntityRelationshipResponse,
        tags=["intelligence"],
    )
    async def entity_relationships(
        payload: EntityRelationshipRequest,
        request: Request,
    ) -> EntityRelationshipResponse:
        auth_context = _guard_non_transport_request(request)
        authorized_documents = await _require_authorized_document_scope(
            request,
            auth_context,
            payload.allowed_document_ids,
            payload.authorized_documents,
        )
        payload = _bind_intelligence_request_to_authorized_documents(
            payload,
            authorized_documents,
        )
        indexer = _indexer(request)
        if not hasattr(indexer, "entity_relationships"):
            settings = _settings(request)
            return EntityRelationshipResponse(
                status="unavailable",
                index_name=settings.opensearch_index,
                total_edges=0,
                returned_edges=0,
                edges=[],
                generated_at=utcnow(),
                warnings=[
                    ReportMessage(
                        code="OPENSEARCH_INDEXER_NOT_CONFIGURED",
                        message="OpenSearch indexer is not configured for entity relationships.",
                    )
                ],
            )
        return await indexer.entity_relationships(payload)

    @app.post(
        "/api/v1/ingestion/jobs/{job_id}/cancel",
        response_model=IngestionJobResponse,
        tags=["ingestion"],
    )
    async def cancel_ingestion_job(job_id: str, request: Request) -> IngestionJobResponse:
        auth_context = _guard_job_operation_request(request)
        stored_job = _store(request).get(job_id)
        actor_context = _job_actor_context(request, stored_job, auth_context)
        await _confirm_document_action_proof(
            request,
            actor_context=actor_context,
            action="document.ingest",
            document_id=stored_job.job.document_id,
            document_version_id=stored_job.job.document_version_id,
            idempotency_key=f"cancel:{job_id}:{get_correlation_id()}",
        )
        store = _store(request)
        if not store.acquire_run(job_id):
            raise IngestionError(
                "JOB_EXECUTION_LEASE_ACTIVE",
                "A running ingestion attempt cannot be cancelled",
                status_code=409,
            )
        try:
            stored_job = store.get(job_id)
            if stored_job.job.status in {
                JobStatus.completed,
                JobStatus.completed_with_warnings,
                JobStatus.failed,
                JobStatus.cancelled,
            }:
                raise IngestionError(
                    "JOB_NOT_CANCELLABLE",
                    "Only an ingestion attempt that has not started can be cancelled",
                    status_code=409,
                    details={"status": stored_job.job.status.value},
                )
            if stored_job.job.status in {JobStatus.starting, JobStatus.running}:
                raise IngestionError(
                    "JOB_EXECUTION_LEASE_ACTIVE",
                    "A running ingestion attempt cannot be cancelled",
                    status_code=409,
                )
            stored_job = store.request_cancel(job_id)
            updated = await _complete_requested_cancellation(
                store,
                _registry(request),
                _pipeline(request),
                stored_job,
                actor_context=actor_context,
            )
            return updated.job
        finally:
            store.release_run(job_id)

    @app.post(
        "/api/v1/ingestion/reindex",
        response_model=ReindexResponse,
        tags=["ingestion"],
    )
    async def reindex(payload: ReindexRequest, request: Request) -> ReindexResponse:
        auth_context = _guard_request(request)
        _reject_web_transport(auth_context)
        settings = _settings(request)
        if settings.auth_mode not in {"disabled", "mock"}:
            raise IngestionError(
                "REINDEX_GOVERNED_WORKFLOW_REQUIRED",
                "Production reindex must use the durable governed ingestion-attempt workflow",
                status_code=403,
            )
        if len(payload.items) != 1:
            raise IngestionError(
                "REINDEX_SINGLE_AUTHORIZATION_REQUIRED",
                "A reindex request must contain exactly one Registry-authorized item",
                status_code=403,
            )
        subject_id = auth_context.subject_id
        accepted_jobs: list[str] = []
        rejected_items: list[dict] = []

        for item in payload.items:
            try:
                await _confirm_document_action_proof(
                    request,
                    actor_context=auth_context,
                    action="document.reindex",
                    document_id=item.document_id,
                    document_version_id=item.document_version_id,
                    idempotency_key=(
                        f"reindex:{item.document_id}:{item.document_version_id}:"
                        f"{get_correlation_id()}"
                    ),
                )
                job = IngestionJobResponse(
                    job_id=make_id("ing"),
                    status=JobStatus.queued,
                    document_id=item.document_id,
                    document_version_id=item.document_version_id,
                    source_file_uri=item.source_file_uri,
                    extraction_profile=item.extraction_profile or settings.default_extraction_profile,
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


def _object_storage(request: Request) -> ObjectStorageClient:
    return request.app.state.object_storage


def _indexer(request: Request) -> QdrantIndexer:
    return request.app.state.indexer


def _pipeline(request: Request) -> IngestionPipeline:
    return request.app.state.pipeline


def _parser_readiness(settings: Settings) -> str:
    command = None
    if settings.ocr_provider == "tesseract":
        command = settings.tesseract_command
    elif settings.ocr_provider == "ocrmypdf":
        command = settings.ocrmypdf_command
    if command and shutil.which(command) is None:
        return "not_ready"
    return "ready"


def _guard_request(request: Request) -> AuthContext:
    require_service_auth(request, _settings(request))
    return auth_context_for_request(request, _settings(request))


def _guard_non_transport_request(request: Request) -> AuthContext:
    auth_context = _guard_request(request)
    _reject_web_transport(auth_context)
    return auth_context


def _guard_job_operation_request(request: Request) -> AuthContext:
    auth_context = _guard_request(request)
    settings = _settings(request)
    if auth_context.service_identity or settings.auth_mode not in {"disabled", "mock"}:
        _require_web_transport(auth_context)
    return auth_context


def _require_web_transport(auth_context: AuthContext) -> None:
    settings_client_id = "svc-akb-web-ingestion"
    if (
        not auth_context.service_identity
        or auth_context.service_client_id != settings_client_id
        or "service_akb_web_ingestion" not in auth_context.roles
    ):
        raise IngestionError(
            "WEB_INGESTION_TRANSPORT_REQUIRED",
            "The exact web ingestion transport identity is required",
            status_code=403,
        )


def _require_readiness_transport(auth_context: AuthContext) -> None:
    if (
        not auth_context.service_identity
        or auth_context.service_client_id != "svc-ingestion"
        or "service_ingestion" not in auth_context.roles
    ):
        raise IngestionError(
            "READINESS_TRANSPORT_REQUIRED",
            "The exact ingestion readiness identity is required",
            status_code=403,
        )


def _reject_web_transport(auth_context: AuthContext) -> None:
    if auth_context.service_identity:
        raise IngestionError(
            "SERVICE_ROUTE_FORBIDDEN",
            "The web ingestion transport cannot call this route",
            status_code=403,
        )


def _delegated_actor_context(request: Request) -> AuthContext:
    actor_subject_id = (request.headers.get("X-AKL-On-Behalf-Of") or "").strip()
    if not ACTOR_SUBJECT_PATTERN.fullmatch(actor_subject_id):
        raise IngestionError(
            "DELEGATED_ACTOR_INVALID",
            "A bounded delegated actor subject is required",
            status_code=400,
        )
    return AuthContext(
        subject_id=actor_subject_id,
        roles=(),
        groups=(),
        capabilities=(),
        scopes=(),
        organization_id="org_stratos",
        identity_active=True,
        membership_active=True,
        application_access_active=True,
        bearer_token=None,
        service_identity=False,
        service_client_id=None,
    )


def _confirmed_actor_context(subject_id: str) -> AuthContext:
    if not ACTOR_SUBJECT_PATTERN.fullmatch(subject_id):
        raise IngestionError(
            "REGISTRY_AUTHORIZATION_CONFLICT",
            "Registry returned an invalid confirmed actor",
            status_code=502,
        )
    return AuthContext(
        subject_id=subject_id,
        roles=(),
        groups=(),
        capabilities=(),
        scopes=(),
        organization_id="org_stratos",
        identity_active=True,
        membership_active=True,
        application_access_active=True,
        bearer_token=None,
        service_identity=False,
        service_client_id=None,
    )


def _ingestion_authorization_proof(request: Request) -> str:
    value = (request.headers.get("X-AKL-Ingestion-Authorization") or "").strip()
    if not 32 <= len(value) <= 4096 or any(character.isspace() for character in value):
        raise IngestionError(
            "INGESTION_AUTHORIZATION_REQUIRED",
            "A bounded Registry-issued ingestion authorization proof is required",
            status_code=401,
        )
    return value


async def _claim_ingestion_attempt(
    request: Request,
    stored_job: StoredJob,
    *,
    actor_context: AuthContext,
) -> StoredJob:
    return await _claim_stored_job(
        _store(request),
        _registry(request),
        stored_job,
        actor_context=actor_context,
    )


async def _claim_stored_job(
    store: JobStore,
    registry: RegistryClient,
    stored_job: StoredJob,
    *,
    actor_context: AuthContext,
) -> StoredJob:
    current = store.get(stored_job.job.job_id)
    if current.job.status == JobStatus.pending_authorization:
        current = store.update_status(
            current.job.job_id,
            JobStatus.claiming,
            expected_statuses={JobStatus.pending_authorization},
        )
    if current.job.status != JobStatus.claiming:
        return current
    try:
        await registry.claim_external_document_attempt(
            document_id=current.request.document_id,
            document_version_id=current.request.document_version_id,
            expected_ingestion_job_id=current.request.expected_current_ingestion_job_id,
            ingestion_job_id=current.job.job_id,
            auth_context=actor_context,
        )
    except IngestionError as exc:
        if exc.code == "REGISTRY_CONFLICT":
            report = IngestionReport(
                job_id=current.job.job_id,
                status=JobStatus.failed,
                documents_processed=0,
                pages_processed=0,
                chunks_created=0,
                tables_detected=0,
                ocr_used=False,
                warnings=[],
                errors=[ReportMessage(code=exc.code, message=exc.message)],
            )
            store.finalize(
                current.job.job_id,
                status=JobStatus.failed,
                report=report,
                pending_external_status=None,
                finished_at=utcnow(),
                expected_statuses={JobStatus.claiming},
            )
            raise
        # Transport-unknown outcomes remain CLAIMING. An exact idempotent replay
        # reissues the Registry CAS and only then activates the local job.
        raise
    return store.update_status(
        current.job.job_id,
        JobStatus.queued,
        expected_statuses={JobStatus.claiming},
    )


async def _complete_requested_cancellation(
    store: JobStore,
    registry: RegistryClient,
    pipeline: IngestionPipeline,
    stored_job: StoredJob,
    *,
    actor_context: AuthContext,
) -> StoredJob:
    """Finish a durable cancel intent without ever allowing later execution."""
    current = store.get(stored_job.job.job_id)
    if not current.cancel_requested:
        return current
    if current.job.status in {
        JobStatus.completed,
        JobStatus.completed_with_warnings,
        JobStatus.failed,
        JobStatus.cancelled,
    }:
        return current
    if current.job.status in {JobStatus.starting, JobStatus.running}:
        raise IngestionError(
            "JOB_EXECUTION_LEASE_ACTIVE",
            "A running ingestion attempt cannot be cancelled",
            status_code=409,
        )

    authoritative_attempt_selected = True
    if current.job.status == JobStatus.pending_authorization and not (
        current.authoritative_claim_requested
    ):
        authoritative_attempt_selected = await registry.is_authoritative_attempt_selected(
            document_id=current.request.document_id,
            document_version_id=current.request.document_version_id,
            ingestion_job_id=current.job.job_id,
        )
    if current.job.status in {JobStatus.pending_authorization, JobStatus.claiming}:
        if not authoritative_attempt_selected:
            return _finalize_cancelled_job(
                store,
                current,
                pending_external_status=None,
                expected_statuses={JobStatus.pending_authorization},
            )
        current = await _claim_stored_job(
            store,
            registry,
            current,
            actor_context=actor_context,
        )
    if current.job.status != JobStatus.queued:
        raise IngestionError(
            "JOB_NOT_CANCELLABLE",
            "Only an ingestion attempt that has not started can be cancelled",
            status_code=409,
            details={"status": current.job.status.value},
        )
    current = _finalize_cancelled_job(
        store,
        current,
        pending_external_status="FAILED",
        expected_statuses={JobStatus.queued},
    )
    return await pipeline.reconcile_terminal_status(
        current,
        auth_context=actor_context,
    )


def _finalize_cancelled_job(
    store: JobStore,
    stored_job: StoredJob,
    *,
    pending_external_status: str | None,
    expected_statuses: set[JobStatus],
) -> StoredJob:
    report = IngestionReport(
        job_id=stored_job.job.job_id,
        status=JobStatus.cancelled,
        documents_processed=0,
        pages_processed=0,
        chunks_created=0,
        tables_detected=0,
        ocr_used=False,
        warnings=[],
        errors=[
            ReportMessage(
                code="JOB_CANCELLED",
                message="Ingestion was cancelled before execution",
            )
        ],
    )
    return store.finalize(
        stored_job.job.job_id,
        status=JobStatus.cancelled,
        report=report,
        pending_external_status=pending_external_status,
        finished_at=utcnow(),
        expected_statuses=expected_statuses,
    )


async def _recovery_loop(app: FastAPI) -> None:
    while True:
        try:
            await _recover_durable_jobs(app)
        except Exception:
            logger.exception("durable_ingestion_recovery_pass_failed")
        await asyncio.sleep(2)


async def _recover_durable_jobs(app: FastAPI) -> None:
    store: JobStore = app.state.store
    registry: RegistryClient = app.state.registry
    pipeline: IngestionPipeline = app.state.pipeline
    settings: Settings = app.state.settings
    for stored_job in store.list():
        if (
            stored_job.pending_external_status is None
            and stored_job.job.status
            not in {
                JobStatus.pending_authorization,
                JobStatus.claiming,
                JobStatus.queued,
                JobStatus.starting,
                JobStatus.running,
            }
        ):
            continue
        if not _has_confirmed_durable_lineage(stored_job):
            _quarantine_incomplete_durable_job(store, stored_job)
            continue
        actor_subject_id = stored_job.actor_subject_id
        assert actor_subject_id is not None
        job_id = stored_job.job.job_id
        if not store.acquire_run(job_id):
            continue
        try:
            current = store.get(job_id)
            actor_context = _confirmed_actor_context(actor_subject_id)
            if current.pending_external_status is not None:
                current = await pipeline.reconcile_terminal_status(
                    current,
                    auth_context=actor_context,
                )
            if current.cancel_requested:
                current = await _complete_requested_cancellation(
                    store,
                    registry,
                    pipeline,
                    current,
                    actor_context=actor_context,
                )
            elif current.job.status in {
                JobStatus.pending_authorization,
                JobStatus.claiming,
            }:
                if not await _authoritative_claim_is_ready(registry, current):
                    continue
                current = await _claim_stored_job(
                    store,
                    registry,
                    current,
                    actor_context=actor_context,
                )
            if settings.process_jobs_inline and current.job.status in {
                JobStatus.queued,
                JobStatus.starting,
                JobStatus.running,
            }:
                await pipeline.run(
                    current,
                    subject_id=actor_subject_id,
                    auth_context=actor_context,
                )
        except IngestionError as exc:
            logger.warning(
                "durable_ingestion_recovery_deferred job_id=%s error_code=%s",
                job_id,
                exc.code,
            )
        except Exception:
            logger.exception("durable_ingestion_recovery_failed job_id=%s", job_id)
        finally:
            store.release_run(job_id)


def _has_confirmed_durable_lineage(stored_job: StoredJob) -> bool:
    actor_subject_id = stored_job.actor_subject_id
    transport_client_id = stored_job.transport_client_id
    if not (
        stored_job.request_hash
        and actor_subject_id
        and stored_job.actor_authorization_id
        and stored_job.actor_authorization_id.startswith("iauth_")
        and transport_client_id == "svc-akb-web-ingestion"
    ):
        return False
    return bool(
        stored_job.job.job_id
        == idempotent_job_id(
            transport_client_id,
            stored_job.request.idempotency_key,
        )
        and stored_job.request_hash
        == _ingestion_request_hash(
            stored_job.request,
            actor_subject_id=actor_subject_id,
            client_namespace=transport_client_id,
            authoritative_claim_requested=stored_job.authoritative_claim_requested,
        )
    )


async def _authoritative_claim_is_ready(
    registry: RegistryClient,
    stored_job: StoredJob,
) -> bool:
    if stored_job.job.status == JobStatus.claiming:
        return True
    if stored_job.authoritative_claim_requested:
        return True
    return await registry.is_authoritative_attempt_selected(
        document_id=stored_job.request.document_id,
        document_version_id=stored_job.request.document_version_id,
        ingestion_job_id=stored_job.job.job_id,
    )


def _quarantine_incomplete_durable_job(store: JobStore, stored_job: StoredJob) -> None:
    if stored_job.job.status not in {
        JobStatus.pending_authorization,
        JobStatus.claiming,
        JobStatus.queued,
        JobStatus.starting,
        JobStatus.running,
    }:
        return
    report = IngestionReport(
        job_id=stored_job.job.job_id,
        status=JobStatus.failed,
        documents_processed=0,
        pages_processed=0,
        chunks_created=0,
        tables_detected=0,
        ocr_used=False,
        warnings=[],
        errors=[
            ReportMessage(
                code="DURABLE_AUTHORIZATION_LINEAGE_MISSING",
                message="Legacy ingestion job was quarantined without execution",
            )
        ],
    )
    try:
        store.finalize(
            stored_job.job.job_id,
            status=JobStatus.failed,
            report=report,
            pending_external_status=None,
            finished_at=utcnow(),
            expected_statuses={
                JobStatus.pending_authorization,
                JobStatus.claiming,
                JobStatus.queued,
                JobStatus.starting,
                JobStatus.running,
            },
        )
    except IngestionError as exc:
        if exc.code != "JOB_STATE_CONFLICT":
            raise


async def _require_job_read(
    request: Request,
    stored_job: StoredJob,
    auth_context: AuthContext,
) -> None:
    actor_context = _job_actor_context(request, stored_job, auth_context)
    authorization_proof = _ingestion_authorization_proof(request)
    confirmed_subject_id, _authorization_id = await _registry(
        request
    ).confirm_ingestion_authorization(
        authorization_token=authorization_proof,
        expected_subject_id=actor_context.subject_id,
        action="document.read",
        document_id=stored_job.job.document_id,
        document_version_id=stored_job.job.document_version_id,
        correlation_id=get_correlation_id(),
        idempotency_key=f"read:{stored_job.job.job_id}:{get_correlation_id()}",
    )
    if confirmed_subject_id != actor_context.subject_id:
        raise IngestionError(
            "REGISTRY_AUTHORIZATION_CONFLICT",
            "Registry confirmed another reader than the current transport subject",
            status_code=502,
        )


def _job_actor_context(
    request: Request,
    stored_job: StoredJob,
    auth_context: AuthContext,
) -> AuthContext:
    if stored_job.transport_client_id != "svc-akb-web-ingestion":
        raise IngestionError(
            "JOB_NOT_FOUND",
            "Ingestion job was not found",
            status_code=404,
        )
    settings = _settings(request)
    if (
        settings.auth_mode in {"disabled", "mock"}
        and not auth_context.service_identity
    ):
        # Explicit local-only compatibility for direct developer/test probes.
        # Authenticated deployments must always preserve the web transport
        # boundary and may never substitute a person's bearer for it.
        return auth_context
    _require_web_transport(auth_context)
    actor_context = _delegated_actor_context(request)
    return actor_context


def _can_list_all_jobs(auth_context: AuthContext, settings: Settings) -> bool:
    # Production job listing needs a dedicated Registry-issued global proof;
    # static OIDC roles must never become dynamic content authority.
    return (
        settings.auth_mode in {"disabled", "mock"}
        and bool(GLOBAL_JOB_LIST_ROLES.intersection(auth_context.roles))
    )


async def _require_authorized_document_scope(
    request: Request,
    auth_context: AuthContext,
    document_ids: list[str],
    authorized_documents: list[IntelligenceDocumentCoordinate],
) -> list[IntelligenceDocumentCoordinate]:
    settings = _settings(request)
    if settings.auth_mode in {"disabled", "mock"} and _can_list_all_jobs(
        auth_context,
        settings,
    ):
        return sorted(authorized_documents, key=lambda item: item.document_id)
    normalized_document_ids = sorted(set(document_ids))
    normalized_coordinates = sorted(
        authorized_documents,
        key=lambda item: item.document_id,
    )
    if (
        not normalized_document_ids
        or len(normalized_document_ids) != len(document_ids)
        or len(normalized_document_ids) > 500
        or any(not document_id or len(document_id) > 128 for document_id in normalized_document_ids)
        or [item.document_id for item in normalized_coordinates]
        != normalized_document_ids
    ):
        raise IngestionError(
            "DOCUMENT_SCOPE_REQUIRED",
            "Intelligence queries require a bounded, unique document scope",
            status_code=403,
        )
    authorization_proof = (
        request.headers.get("X-AKL-Intelligence-Authorization") or ""
    ).strip()
    idempotency_key = (
        request.headers.get("X-AKL-Intelligence-Idempotency-Key") or ""
    ).strip()
    if (
        not 32 <= len(authorization_proof) <= 4096
        or any(character.isspace() for character in authorization_proof)
        or not 8 <= len(idempotency_key) <= 200
        or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]+", idempotency_key)
    ):
        raise IngestionError(
            "DOCUMENT_SCOPE_AUTHORIZATION_PROOF_REQUIRED",
            "A Registry-issued proof for the exact intelligence document scope is required",
            status_code=403,
        )
    confirmed_subject_id, _authorization_id = await _registry(
        request
    ).confirm_intelligence_scope_authorization(
        authorization_token=authorization_proof,
        expected_subject_id=auth_context.subject_id,
        documents=[item.model_dump() for item in normalized_coordinates],
        correlation_id=get_correlation_id(),
        idempotency_key=idempotency_key,
    )
    if confirmed_subject_id != auth_context.subject_id:
        raise IngestionError(
            "REGISTRY_INTELLIGENCE_AUTHORIZATION_CONFLICT",
            "Registry confirmed another subject for the intelligence document scope",
            status_code=502,
        )
    return normalized_coordinates


def _bind_intelligence_request_to_authorized_documents(
    payload: EntitySearchRequest | AnalystSearchRequest | EntityRelationshipRequest,
    authorized_documents: list[IntelligenceDocumentCoordinate],
) -> EntitySearchRequest | AnalystSearchRequest | EntityRelationshipRequest:
    if not authorized_documents:
        return payload
    return payload.model_copy(
        update={
            "allowed_document_ids": [item.document_id for item in authorized_documents],
            "allowed_policy_hashes": {
                item.document_id: [item.policy_hash]
                for item in authorized_documents
            },
            "authorized_documents": authorized_documents,
        }
    )


async def _confirm_document_action_proof(
    request: Request,
    *,
    actor_context: AuthContext,
    action: str,
    document_id: str,
    document_version_id: str,
    idempotency_key: str,
) -> None:
    authorization_proof = _ingestion_authorization_proof(request)
    confirmed_subject_id, _authorization_id = await _registry(
        request
    ).confirm_ingestion_authorization(
        authorization_token=authorization_proof,
        expected_subject_id=actor_context.subject_id,
        action=action,
        document_id=document_id,
        document_version_id=document_version_id,
        correlation_id=get_correlation_id(),
        idempotency_key=idempotency_key,
    )
    if confirmed_subject_id != actor_context.subject_id:
        raise IngestionError(
            "REGISTRY_AUTHORIZATION_CONFLICT",
            "Registry confirmed another actor than the current request subject",
            status_code=502,
        )


def _ingestion_request_hash(
    payload: IngestionJobCreate,
    *,
    actor_subject_id: str,
    client_namespace: str,
    authoritative_claim_requested: bool,
) -> str:
    canonical = json.dumps(
        {
            "actor_subject_id": actor_subject_id,
            "authoritative_claim_requested": authoritative_claim_requested,
            "client_namespace": client_namespace,
            "request": payload.model_dump(mode="json"),
        },
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(canonical).hexdigest()}"


try:
    app = create_app()
except ConfigError as exc:
    logger.critical("configuration_error reason=%s", exc)
    raise
