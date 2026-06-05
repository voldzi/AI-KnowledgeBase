import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api import health_router, router
from app.config import get_settings
from app.database import create_schema
from app.errors import register_exception_handlers
from app.middleware import CorrelationIdMiddleware


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    if settings.auto_create_schema:
        create_schema()
    yield


def create_app() -> FastAPI:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    settings = get_settings()
    app = FastAPI(
        title="AKL Identity & Document Registry API",
        version=settings.service_version,
        description=(
            "Registry service for controlled documents, versions, access policies, "
            "authorization decisions, and audit events. It does not implement ingestion, RAG, or LLM logic."
        ),
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.add_middleware(CorrelationIdMiddleware)
    register_exception_handlers(app)
    app.include_router(health_router)
    app.include_router(router)
    return app


app = create_app()
