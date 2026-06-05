from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import ConfigError, Settings, load_settings
from app.errors import (
    GovernanceError,
    governance_error_handler,
    http_error_handler,
    validation_error_handler,
)
from app.logging import configure_logging
from app.middleware import CorrelationIdMiddleware
from app.rag_client import create_rag_client
from app.registry_client import create_registry_client
from app.schemas import (
    CompareVersionsRequest,
    CompareVersionsResponse,
    ComplianceCheckRequest,
    ComplianceCheckResponse,
    ConflictDetectionRequest,
    ConflictDetectionResponse,
    GenerateKbArticleRequest,
    GenerateKbArticleResponse,
    HealthResponse,
    ReadinessResponse,
    ValidityAlertsResponse,
)
from app.security import require_service_auth
from app.service import GovernanceService
from compliance.checker import ComplianceChecker
from conflict_detection.detector import ConflictDetector
from document_diff.diff_engine import DocumentDiffEngine
from kb_generation.generator import KbArticleGenerator

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or load_settings()
    configure_logging(resolved_settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):  # type: ignore[no-untyped-def]
        registry_client = create_registry_client(resolved_settings)
        rag_client = create_rag_client(resolved_settings)
        app.state.settings = resolved_settings
        app.state.governance_service = GovernanceService(
            settings=resolved_settings,
            registry_client=registry_client,
            rag_client=rag_client,
            diff_engine=DocumentDiffEngine(),
            compliance_checker=ComplianceChecker(resolved_settings),
            conflict_detector=ConflictDetector(),
            kb_generator=KbArticleGenerator(),
        )
        yield

    app = FastAPI(
        title="AKL Governance / Compliance Service",
        version=resolved_settings.service_version,
        description=(
            "Document version comparison, compliance checking, conflict detection, "
            "KB draft generation, and validity alerts with citations, sources, and confidence."
        ),
        lifespan=lifespan,
    )
    app.add_middleware(CorrelationIdMiddleware)
    app.add_exception_handler(GovernanceError, governance_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_error_handler)

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
        status = "ready" if all(value == "ready" for value in statuses.values()) else "not_ready"
        if status != "ready":
            response.status_code = 503
        return ReadinessResponse(status=status, service=_settings(request).service_name, dependencies=statuses)

    @app.post(
        "/api/v1/governance/compare-versions",
        response_model=CompareVersionsResponse,
        tags=["governance"],
    )
    async def compare_versions(payload: CompareVersionsRequest, request: Request) -> CompareVersionsResponse:
        _guard_request(request)
        logger.info(
            "governance_compare_requested subject_id=%s left_version=%s right_version=%s content_logged=false",
            payload.subject_id,
            payload.left_version.document_version_id,
            payload.right_version.document_version_id,
        )
        return await _service(request).compare_versions(payload)

    @app.post(
        "/api/v1/governance/check-compliance",
        response_model=ComplianceCheckResponse,
        tags=["governance"],
    )
    async def check_compliance(payload: ComplianceCheckRequest, request: Request) -> ComplianceCheckResponse:
        _guard_request(request)
        logger.info(
            "governance_compliance_requested subject_id=%s document_type=%s content_logged=false",
            payload.subject_id,
            payload.draft.document_type,
        )
        return await _service(request).check_compliance(payload)

    @app.post(
        "/api/v1/governance/detect-conflicts",
        response_model=ConflictDetectionResponse,
        tags=["governance"],
    )
    async def detect_conflicts(payload: ConflictDetectionRequest, request: Request) -> ConflictDetectionResponse:
        _guard_request(request)
        logger.info(
            "governance_conflict_detection_requested subject_id=%s document_count=%s content_logged=false",
            payload.subject_id,
            len(payload.documents),
        )
        return await _service(request).detect_conflicts(payload)

    @app.post(
        "/api/v1/governance/generate-kb-article",
        response_model=GenerateKbArticleResponse,
        tags=["governance"],
    )
    async def generate_kb_article(payload: GenerateKbArticleRequest, request: Request) -> GenerateKbArticleResponse:
        _guard_request(request)
        logger.info(
            "governance_kb_generation_requested subject_id=%s source_document_id=%s content_logged=false",
            payload.subject_id,
            payload.source_document.document_id,
        )
        return await _service(request).generate_kb_article(payload)

    @app.get(
        "/api/v1/governance/validity-alerts",
        response_model=ValidityAlertsResponse,
        tags=["governance"],
    )
    async def validity_alerts(
        request: Request,
        subject_id: str = Query(..., min_length=1, max_length=128),
        days_before_expiry: int | None = Query(default=None, ge=1, le=730),
    ) -> ValidityAlertsResponse:
        _guard_request(request)
        days = days_before_expiry or _settings(request).default_validity_alert_days
        logger.info(
            "governance_validity_alerts_requested subject_id=%s days_before_expiry=%s",
            subject_id,
            days,
        )
        return await _service(request).validity_alerts(subject_id=subject_id, days_before_expiry=days)

    return app


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _service(request: Request) -> GovernanceService:
    return request.app.state.governance_service


def _guard_request(request: Request) -> None:
    require_service_auth(request, _settings(request))


try:
    app = create_app()
except ConfigError as exc:
    logger.critical("configuration_error reason=%s", exc)
    raise
