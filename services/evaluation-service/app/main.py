from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import ConfigError, Settings, load_settings
from app.errors import (
    EvaluationError,
    evaluation_error_handler,
    http_error_handler,
    validation_error_handler,
)
from app.logging import configure_logging
from app.middleware import CorrelationIdMiddleware
from app.rag_client import create_rag_client
from app.reporting import render_csv, render_html, render_json
from app.registry_client import create_registry_client
from app.schemas import (
    DatasetSummary,
    EvaluationDataset,
    EvaluationDatasetCreate,
    EvaluationRun,
    EvaluationRunRequest,
    EvaluationRunSummary,
    HealthResponse,
    QualityOverview,
    ReadinessResponse,
    ReportFormat,
)
from app.security import EvaluationPrincipal, require_service_auth
from app.service import EvaluationService
from app.store import DatasetStore, RunStore
from app.telemetry import configure_telemetry

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or load_settings()
    configure_logging(resolved_settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):  # type: ignore[no-untyped-def]
        app.state.settings = resolved_settings
        app.state.evaluation_service = EvaluationService(
            settings=resolved_settings,
            dataset_store=DatasetStore(
                resolved_settings.datasets_dir,
                resolved_settings.seed_datasets_dir,
            ),
            run_store=RunStore(resolved_settings.reports_dir),
            rag_client=create_rag_client(resolved_settings),
            registry_client=create_registry_client(resolved_settings),
        )
        yield

    app = FastAPI(
        title="AKL Evaluation Service",
        version=resolved_settings.service_version,
        description="Evaluation runs, datasets, and reports for AKL RAG answer, citation, and retrieval quality.",
        lifespan=lifespan,
    )
    app.add_middleware(CorrelationIdMiddleware)
    app.add_exception_handler(EvaluationError, evaluation_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_error_handler)
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
        tags=["health"],
        responses={503: {"description": "At least one dependency is not ready."}},
    )
    async def ready(request: Request, response: Response) -> ReadinessResponse:
        statuses = await _service(request).readiness()
        ready_values = {"ready", "disabled"}
        status = "ready" if all(value in ready_values for value in statuses.values()) else "not_ready"
        if status != "ready":
            response.status_code = 503
        return ReadinessResponse(status=status, service=_settings(request).service_name, dependencies=statuses)

    @app.get("/api/v1/evaluations/datasets", response_model=list[DatasetSummary], tags=["evaluations"])
    async def list_datasets(request: Request) -> list[DatasetSummary]:
        principal = _guard_request(request)
        logger.info("evaluation_datasets_requested")
        return _service(request).list_datasets(principal)

    @app.get(
        "/api/v1/evaluations/datasets/{dataset_id}",
        response_model=EvaluationDataset,
        tags=["evaluations"],
    )
    async def get_dataset(dataset_id: str, request: Request) -> EvaluationDataset:
        principal = _guard_request(request)
        logger.info("evaluation_dataset_get_requested dataset_id=%s", dataset_id)
        return _service(request).get_dataset(dataset_id, principal)

    @app.post(
        "/api/v1/evaluations/datasets",
        response_model=EvaluationDataset,
        tags=["evaluations"],
        status_code=201,
    )
    async def create_dataset(payload: EvaluationDatasetCreate, request: Request) -> EvaluationDataset:
        principal = _guard_request(request)
        logger.info(
            "evaluation_dataset_create_requested dataset_id=%s case_count=%s query_text_logged=false",
            payload.dataset_id,
            len(payload.cases),
        )
        return _service(request).create_dataset(payload, principal)

    @app.get(
        "/api/v1/evaluations/runs",
        response_model=list[EvaluationRunSummary],
        tags=["evaluations"],
    )
    async def list_runs(
        request: Request,
        dataset_id: str | None = Query(default=None),
        limit: int = Query(default=20, ge=1, le=100),
    ) -> list[EvaluationRunSummary]:
        principal = _guard_request(request)
        logger.info("evaluation_runs_requested dataset_id=%s limit=%s", dataset_id, limit)
        return _service(request).list_runs(
            principal,
            dataset_id=dataset_id,
            limit=limit,
        )

    @app.post("/api/v1/evaluations/runs", response_model=EvaluationRun, tags=["evaluations"])
    async def create_run(payload: EvaluationRunRequest, request: Request) -> EvaluationRun:
        principal = _guard_request(request)
        logger.info(
            "evaluation_run_requested dataset_id=%s inline_dataset=%s case_count=%s query_text_logged=false",
            payload.dataset_id,
            payload.dataset is not None,
            len(payload.case_ids) if payload.case_ids else None,
        )
        return await _service(request).run_evaluation(payload, principal)

    @app.get("/api/v1/evaluations/runs/{run_id}", response_model=EvaluationRun, tags=["evaluations"])
    async def get_run(run_id: str, request: Request) -> EvaluationRun:
        principal = _guard_request(request)
        logger.info("evaluation_run_get_requested run_id=%s", run_id)
        return _service(request).get_run(run_id, principal)

    @app.get(
        "/api/v1/evaluations/quality/overview",
        response_model=QualityOverview,
        tags=["evaluations"],
    )
    async def quality_overview(
        request: Request,
        dataset_id: str | None = Query(default=None),
        limit: int = Query(default=20, ge=1, le=100),
    ) -> QualityOverview:
        principal = _guard_request(request)
        logger.info("evaluation_quality_overview_requested dataset_id=%s limit=%s", dataset_id, limit)
        return _service(request).quality_overview(
            principal,
            dataset_id=dataset_id,
            limit=limit,
        )

    @app.get(
        "/api/v1/evaluations/runs/{run_id}/report",
        tags=["evaluations"],
        response_model=None,
        responses={
            200: {
                "description": "Evaluation report in JSON, CSV, or HTML.",
                "content": {
                    "application/json": {"schema": {"$ref": "#/components/schemas/EvaluationRun"}},
                    "text/csv": {"schema": {"type": "string"}},
                    "text/html": {"schema": {"type": "string"}},
                },
            }
        },
    )
    async def get_report(
        run_id: str,
        request: Request,
        format: ReportFormat = Query(default="json"),  # noqa: A002
    ) -> Response:
        principal = _guard_request(request)
        logger.info("evaluation_report_requested run_id=%s format=%s", run_id, format)
        run = _service(request).get_run(run_id, principal)
        if format == "json":
            return Response(content=render_json(run), media_type="application/json")
        if format == "csv":
            return Response(
                content=render_csv(run),
                media_type="text/csv",
                headers={"Content-Disposition": f'attachment; filename="{run_id}.csv"'},
            )
        return Response(content=render_html(run), media_type="text/html")

    return app


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _service(request: Request) -> EvaluationService:
    return request.app.state.evaluation_service


def _guard_request(request: Request) -> EvaluationPrincipal:
    return require_service_auth(request, _settings(request))


try:
    app = create_app()
except ConfigError as exc:
    logger.critical("configuration_error reason=%s", exc)
    raise
