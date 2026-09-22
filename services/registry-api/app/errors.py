from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette import status

from app.middleware import get_correlation_id


ERROR_ENVELOPE_SCHEMA = "akb.registry.error.v1"
_MAX_FIELD_PATHS = 8
_MAX_FIELD_PATH_SEGMENTS = 12


def error_payload(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    correlation_id = get_correlation_id()
    return {
        "error": {
            "schema_version": ERROR_ENVELOPE_SCHEMA,
            "code": code,
            "message": message,
            "details": details or {},
            # Keep trace_id while clients migrate to the explicit correlation_id.
            "correlation_id": correlation_id,
            "trace_id": correlation_id,
        }
    }


def json_safe(value: Any) -> Any:
    if isinstance(value, BaseException):
        return str(value)
    if isinstance(value, dict):
        return {str(key): json_safe(inner) for key, inner in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(inner) for inner in value]
    return value


def problem(status_code: int, code: str, message: str, details: dict[str, Any] | None = None) -> HTTPException:
    return HTTPException(status_code=status_code, detail=error_payload(code, message, details))


def _safe_validation_field_paths(errors: list[dict[str, Any]]) -> list[str]:
    """Expose schema locations only; never echo request values or validator messages."""
    paths: list[str] = []
    for item in errors[:_MAX_FIELD_PATHS]:
        location = item.get("loc")
        if not isinstance(location, (list, tuple)):
            continue
        parts = [str(part) for part in location[:_MAX_FIELD_PATH_SEGMENTS]
                 if isinstance(part, (str, int))]
        if parts and parts[0] == "body":
            parts = parts[1:]
        if not parts:
            continue
        path = ".".join(parts)
        if path and len(path) <= 512 and path not in paths:
            paths.append(path)
    return paths


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
        if isinstance(exc.detail, dict) and "error" in exc.detail:
            payload = exc.detail
        else:
            payload = error_payload("http_error", str(exc.detail))
        return JSONResponse(status_code=exc.status_code, content=payload, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Validation errors can contain an ``input`` echo.  The integration
        # boundary exposes only bounded field paths, never submitted values.
        errors = exc.errors()
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=error_payload(
                "validation_error",
                "Request validation failed",
                {"field_paths": _safe_validation_field_paths(errors)},
            ),
        )

    @app.exception_handler(Exception)
    async def generic_exception_handler(_: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=error_payload("internal_error", "Unexpected registry-api error"),
        )
