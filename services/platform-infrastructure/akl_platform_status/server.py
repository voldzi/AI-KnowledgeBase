from __future__ import annotations

import json
import logging
import os
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


@dataclass(frozen=True)
class Config:
    service_name: str
    service_version: str
    environment: str
    auth_mode: str
    host: str
    port: int
    ready_timeout_seconds: float
    ready_checks: tuple[tuple[str, str], ...]


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key in ("service", "path", "status_code", "latency_ms", "request_id", "correlation_id"):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        return json.dumps(payload, separators=(",", ":"), sort_keys=True)


logger = logging.getLogger("akl.platform_infrastructure")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    logger.addHandler(handler)
logger.propagate = False


REQUEST_COUNTERS: dict[tuple[str, int], int] = {}


OPENAPI_DOCUMENT: dict[str, Any] = {
    "openapi": "3.1.0",
    "info": {
        "title": "AKB Platform Infrastructure Status API",
        "version": "0.1.0",
        "description": "Operational health API for the AKB Platform infrastructure thread.",
    },
    "paths": {
        "/health": {
            "get": {
                "summary": "Liveness check",
                "responses": {"200": {"description": "Service process is alive."}},
            }
        },
        "/ready": {
            "get": {
                "summary": "Readiness check",
                "responses": {
                    "200": {"description": "Service and configured dependencies are ready."},
                    "503": {"description": "At least one configured dependency is not ready."},
                },
            }
        },
        "/metrics": {
            "get": {
                "summary": "Prometheus metrics",
                "responses": {"200": {"description": "Prometheus text exposition."}},
            }
        },
        "/openapi.json": {
            "get": {
                "summary": "OpenAPI schema",
                "responses": {"200": {"description": "OpenAPI JSON document."}},
            }
        },
    },
}


def parse_ready_checks(raw_value: str) -> tuple[tuple[str, str], ...]:
    checks: list[tuple[str, str]] = []
    for item in raw_value.split(","):
        item = item.strip()
        if not item:
            continue
        if "=" not in item:
            raise ValueError(f"Invalid readiness check '{item}'. Expected name=url.")
        name, url = item.split("=", 1)
        name = name.strip()
        url = url.strip()
        if not name or not url:
            raise ValueError(f"Invalid readiness check '{item}'. Expected non-empty name and url.")
        if not url.startswith(("http://", "https://")):
            raise ValueError(f"Invalid readiness check '{name}'. URL must be http(s).")
        checks.append((name, url))
    return tuple(checks)


def load_config() -> Config:
    environment = os.getenv("AKL_ENV", "development")
    auth_mode = os.getenv("AKL_AUTH_MODE", "mock")
    if environment == "production" and auth_mode == "mock":
        raise RuntimeError("Refusing to start with AKL_ENV=production and AKL_AUTH_MODE=mock.")

    log_level = os.getenv("AKL_LOG_LEVEL", "INFO").upper()
    logger.setLevel(getattr(logging, log_level, logging.INFO))

    return Config(
        service_name=os.getenv("AKL_SERVICE_NAME", "platform-infrastructure"),
        service_version=os.getenv("AKL_SERVICE_VERSION", "0.1.0"),
        environment=environment,
        auth_mode=auth_mode,
        host=os.getenv("PLATFORM_HOST", "0.0.0.0"),
        port=int(os.getenv("PLATFORM_PORT", "8080")),
        ready_timeout_seconds=float(os.getenv("PLATFORM_READY_TIMEOUT_SECONDS", "2")),
        ready_checks=parse_ready_checks(os.getenv("PLATFORM_READY_CHECKS", "")),
    )


def base_payload(config: Config, request_id: str, correlation_id: str) -> dict[str, Any]:
    return {
        "service": config.service_name,
        "version": config.service_version,
        "environment": config.environment,
        "request_id": request_id,
        "correlation_id": correlation_id,
    }


def check_dependency(name: str, url: str, timeout: float, request_id: str, correlation_id: str) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={
            "X-Request-ID": request_id,
            "X-Correlation-ID": correlation_id,
            "X-Service-Name": "platform-infrastructure",
        },
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status_code = response.getcode()
            healthy = 200 <= status_code < 400
            return {
                "name": name,
                "status": "ready" if healthy else "not_ready",
                "status_code": status_code,
                "latency_ms": round((time.perf_counter() - started) * 1000, 2),
            }
    except (urllib.error.URLError, TimeoutError) as exc:
        return {
            "name": name,
            "status": "not_ready",
            "error": exc.__class__.__name__,
            "latency_ms": round((time.perf_counter() - started) * 1000, 2),
        }


def readiness_payload(config: Config, request_id: str, correlation_id: str) -> tuple[int, dict[str, Any]]:
    checks = [
        check_dependency(name, url, config.ready_timeout_seconds, request_id, correlation_id)
        for name, url in config.ready_checks
    ]
    ready = all(item["status"] == "ready" for item in checks)
    status_code = HTTPStatus.OK if ready else HTTPStatus.SERVICE_UNAVAILABLE
    payload = base_payload(config, request_id, correlation_id)
    payload.update({"status": "ready" if ready else "not_ready", "checks": checks})
    return int(status_code), payload


def error_payload(code: str, message: str, trace_id: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "error": {
            "code": code,
            "message": message,
            "details": details or {},
            "trace_id": trace_id,
        }
    }


def metrics_text(config: Config) -> str:
    lines = [
        "# HELP akl_platform_status_http_requests_total HTTP requests handled by the platform status service.",
        "# TYPE akl_platform_status_http_requests_total counter",
    ]
    for (path, status_code), count in sorted(REQUEST_COUNTERS.items()):
        lines.append(
            'akl_platform_status_http_requests_total{service="%s",path="%s",status_code="%s"} %s'
            % (config.service_name, path, status_code, count)
        )
    lines.extend(
        [
            "# HELP akl_platform_status_ready_checks Configured readiness dependency checks.",
            "# TYPE akl_platform_status_ready_checks gauge",
            f'akl_platform_status_ready_checks{{service="{config.service_name}"}} {len(config.ready_checks)}',
        ]
    )
    return "\n".join(lines) + "\n"


class PlatformStatusHandler(BaseHTTPRequestHandler):
    config: Config
    server_version = "AKLPlatformStatus/0.1"

    def do_GET(self) -> None:
        started = time.perf_counter()
        request_id = self.headers.get("X-Request-ID") or str(uuid.uuid4())
        correlation_id = self.headers.get("X-Correlation-ID") or request_id
        status_code = HTTPStatus.OK
        path = self.path.split("?", 1)[0]

        try:
            if path == "/health":
                payload = base_payload(self.config, request_id, correlation_id)
                payload["status"] = "ok"
                self.send_json(HTTPStatus.OK, payload, request_id, correlation_id)
            elif path == "/ready":
                ready_status, payload = readiness_payload(self.config, request_id, correlation_id)
                status_code = HTTPStatus(ready_status)
                self.send_json(status_code, payload, request_id, correlation_id)
            elif path == "/metrics":
                body = metrics_text(self.config).encode("utf-8")
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("X-Request-ID", request_id)
                self.send_header("X-Correlation-ID", correlation_id)
                self.end_headers()
                self.wfile.write(body)
            elif path == "/openapi.json":
                self.send_json(HTTPStatus.OK, OPENAPI_DOCUMENT, request_id, correlation_id)
            else:
                status_code = HTTPStatus.NOT_FOUND
                self.send_json(
                    status_code,
                    error_payload("NOT_FOUND", "Endpoint not found.", correlation_id),
                    request_id,
                    correlation_id,
                )
        finally:
            REQUEST_COUNTERS[(path, int(status_code))] = REQUEST_COUNTERS.get((path, int(status_code)), 0) + 1
            latency_ms = round((time.perf_counter() - started) * 1000, 2)
            logger.info(
                "request completed",
                extra={
                    "service": self.config.service_name,
                    "path": path,
                    "status_code": int(status_code),
                    "latency_ms": latency_ms,
                    "request_id": request_id,
                    "correlation_id": correlation_id,
                },
            )

    def send_json(
        self,
        status_code: HTTPStatus,
        payload: dict[str, Any],
        request_id: str,
        correlation_id: str,
    ) -> None:
        body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Request-ID", request_id)
        self.send_header("X-Correlation-ID", correlation_id)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: Any) -> None:
        return


def run(config: Config) -> None:
    PlatformStatusHandler.config = config
    server = ThreadingHTTPServer((config.host, config.port), PlatformStatusHandler)
    logger.info("starting platform status service", extra={"service": config.service_name})
    server.serve_forever()


def main() -> None:
    run(load_config())


if __name__ == "__main__":
    main()
