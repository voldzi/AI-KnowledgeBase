from __future__ import annotations

import logging
import os

from fastapi import FastAPI

logger = logging.getLogger(__name__)
_configured = False


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


def _resource_attributes(service_name: str, service_version: str) -> dict[str, str]:
    attrs: dict[str, str] = {
        "service.name": service_name,
        "service.version": service_version,
    }
    raw = os.getenv("OTEL_RESOURCE_ATTRIBUTES", "")
    for item in raw.split(","):
        if "=" not in item:
            continue
        key, value = item.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key and value:
            attrs[key] = value
    attrs["service.name"] = service_name
    attrs["service.version"] = service_version
    return attrs


def configure_telemetry(app: FastAPI, *, service_name: str, service_version: str) -> None:
    if _env_bool("OTEL_SDK_DISABLED", True):
        return

    global _configured
    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
    except ImportError as exc:
        logger.warning("otel_instrumentation_unavailable reason=%s", exc.__class__.__name__)
        return

    if not _configured:
        provider = TracerProvider(resource=Resource.create(_resource_attributes(service_name, service_version)))
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
        try:
            trace.set_tracer_provider(provider)
        except Exception as exc:  # pragma: no cover - defensive for reused test processes
            logger.warning("otel_tracer_provider_already_configured reason=%s", exc.__class__.__name__)
        HTTPXClientInstrumentor().instrument()
        _configured = True

    FastAPIInstrumentor.instrument_app(app, excluded_urls="/health,/ready")
