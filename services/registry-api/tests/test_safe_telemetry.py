from pathlib import Path

import pytest
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import Event, ReadableSpan
from opentelemetry.sdk.trace.export import SpanExporter, SpanExportResult
from opentelemetry.trace import Status, StatusCode

from app.safe_telemetry import SafeSpanExporter, sanitize_span


@pytest.mark.parametrize("path", ["/api/auth/callback", "/identity/token", "/protocol/openid-connect/token", "/api/v1/internal/web-sessions/private-hash", "/?code=synthetic-code"])
def test_identity_protocol_spans_are_not_exported(path):
    assert sanitize_span(ReadableSpan("GET", attributes={"url.full": "https://example.invalid" + path})) is None


def test_export_removes_sensitive_attributes_and_raw_errors():
    span = ReadableSpan(
        "GET /documents?query=private-query", resource=Resource({"service.name": "registry", "token": "private-resource"}),
        attributes={"url.full": "https://example.invalid/documents?token=private-token#private-fragment", "http.status_code": 200, "http.request.header.authorization": "Bearer private-token", "db.statement": "private-sql", "request.body": "private-body", "llm.prompt": "private-prompt", "llm.answer": "private-answer"},
        status=Status(StatusCode.ERROR, "private-error"),
        events=[Event("exception", {"exception.message": "private-error"})],
    )
    safe = sanitize_span(span)
    assert safe is not None
    assert safe.name == "GET /documents"
    assert safe.attributes == {"url.full": "https://example.invalid/documents", "http.status_code": 200}
    assert safe.status.description is None
    assert not safe.events
    assert safe.resource.attributes == {"service.name": "registry"}


def test_exporter_lifecycle_and_empty_batch():
    class Capture(SpanExporter):
        calls = 0
        closed = False

        def export(self, spans):
            self.calls += 1
            assert len(spans) == 1
            return SpanExportResult.SUCCESS

        def shutdown(self):
            self.closed = True

        def force_flush(self, timeout_millis=30_000):
            return True

    delegate = Capture()
    exporter = SafeSpanExporter(delegate)
    assert exporter.export([ReadableSpan("/identity/token")]) == SpanExportResult.SUCCESS
    assert delegate.calls == 0
    assert exporter.export([ReadableSpan("GET /documents")]) == SpanExportResult.SUCCESS
    assert exporter.force_flush()
    exporter.shutdown()
    assert delegate.closed


def test_registry_and_rag_use_identical_privacy_boundary():
    services = Path(__file__).resolve().parents[2]
    assert (services / "registry-api/app/safe_telemetry.py").read_bytes() == (services / "rag-retrieval-service/app/safe_telemetry.py").read_bytes()
