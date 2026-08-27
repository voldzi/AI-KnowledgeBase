"""Remove identity protocol data before it reaches any trace backend."""
from __future__ import annotations

import re
from collections.abc import Mapping, Sequence

from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import Event, ReadableSpan
from opentelemetry.sdk.trace.export import SpanExporter, SpanExportResult
from opentelemetry.trace import Link, Status

SENSITIVE_ATTRIBUTE = re.compile(
    r"authorization|cookie|token|secret|password|credential|header|body|prompt|answer|content|"
    r"exception|db\.statement|db\.query|db\.operation\.parameter", re.I
)
IDENTITY_ROUTE = re.compile(
    r"/api/auth(?:/|\b)|/internal/web-sessions(?:/|\b)|/identity(?:/|\b)|"
    r"/protocol/openid-connect(?:/|\b)|[?&](?:code|state|ticket|id_token|access_token)=", re.I
)
ROUTE_ATTRIBUTE = re.compile(r"url|target|path|route", re.I)


def safe_trace_attributes(attributes: Mapping | None) -> dict:
    result = {}
    for key, value in (attributes or {}).items():
        if SENSITIVE_ATTRIBUTE.search(key):
            continue
        if ROUTE_ATTRIBUTE.search(key) and isinstance(value, str):
            value = re.split(r"[?#]", value, maxsplit=1)[0]
        result[key] = value
    return result


def sanitize_span(span: ReadableSpan) -> ReadableSpan | None:
    routes = [span.name, *(
        str(value) for key, value in (span.attributes or {}).items()
        if ROUTE_ATTRIBUTE.search(key)
    )]
    if any(IDENTITY_ROUTE.search(value) for value in routes):
        return None
    return ReadableSpan(
        name=re.split(r"[?#]", span.name, maxsplit=1)[0],
        context=span.context,
        parent=span.parent,
        resource=Resource(safe_trace_attributes(span.resource.attributes), span.resource.schema_url),
        attributes=safe_trace_attributes(span.attributes),
        events=[
            Event(event.name, safe_trace_attributes(event.attributes), event.timestamp)
            for event in span.events if event.name != "exception"
        ],
        links=[Link(link.context, safe_trace_attributes(link.attributes)) for link in span.links],
        kind=span.kind,
        status=Status(span.status.status_code),
        start_time=span.start_time,
        end_time=span.end_time,
        instrumentation_scope=span.instrumentation_scope,
    )


class SafeSpanExporter(SpanExporter):
    def __init__(self, delegate: SpanExporter):
        self.delegate = delegate

    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        safe = [result for span in spans if (result := sanitize_span(span)) is not None]
        return self.delegate.export(safe) if safe else SpanExportResult.SUCCESS

    def shutdown(self) -> None:
        self.delegate.shutdown()

    def force_flush(self, timeout_millis: int = 30_000) -> bool:
        return self.delegate.force_flush(timeout_millis)
