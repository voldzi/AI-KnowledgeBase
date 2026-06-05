import logging
from contextvars import ContextVar
from time import perf_counter
from uuid import uuid4

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


_request_id: ContextVar[str] = ContextVar("request_id", default="")
_correlation_id: ContextVar[str] = ContextVar("correlation_id", default="")


def get_request_id() -> str:
    return _request_id.get()


def get_correlation_id() -> str:
    correlation_id = _correlation_id.get()
    if correlation_id:
        return correlation_id
    return get_request_id()


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = request.headers.get("X-Request-ID") or str(uuid4())
        correlation_id = request.headers.get("X-Correlation-ID") or request_id

        request_token = _request_id.set(request_id)
        correlation_token = _correlation_id.set(correlation_id)
        start = perf_counter()

        try:
            response = await call_next(request)
        except Exception:
            latency_ms = round((perf_counter() - start) * 1000, 2)
            logging.getLogger("akl.registry").exception(
                "request failed",
                extra={
                    "request_id": request_id,
                    "correlation_id": correlation_id,
                    "method": request.method,
                    "path": request.url.path,
                    "latency_ms": latency_ms,
                },
            )
            raise
        finally:
            _request_id.reset(request_token)
            _correlation_id.reset(correlation_token)

        latency_ms = round((perf_counter() - start) * 1000, 2)
        logging.getLogger("akl.registry").info(
            "request completed",
            extra={
                "request_id": request_id,
                "correlation_id": correlation_id,
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "latency_ms": latency_ms,
            },
        )
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Correlation-ID"] = correlation_id
        return response
