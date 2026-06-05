from __future__ import annotations

from contextvars import ContextVar

request_id_var: ContextVar[str] = ContextVar("request_id", default="")
correlation_id_var: ContextVar[str] = ContextVar("correlation_id", default="")


def get_request_id() -> str:
    return request_id_var.get()


def get_correlation_id() -> str:
    return correlation_id_var.get() or get_request_id()
