from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import stat

import httpx

from app.config import load_settings
from app.object_storage import SourceObject
from parsers.docling import DoclingParser, WORKER_READINESS_SCHEMA, _http_json_payload


def _socket_path() -> Path:
    return Path(
        os.environ.get(
            "AKL_INGESTION_DOCLING_SOCKET_PATH",
            "/run/akb-docling/worker.sock",
        )
    )


def _client(timeout: float) -> httpx.Client:
    socket_path = _socket_path()
    socket_stat = socket_path.lstat()
    if not stat.S_ISSOCK(socket_stat.st_mode):
        raise RuntimeError("Docling endpoint is not a Unix socket")
    return httpx.Client(
        base_url="http://akb-docling-worker",
        transport=httpx.HTTPTransport(uds=str(socket_path), retries=0),
        timeout=timeout,
        follow_redirects=False,
        trust_env=False,
    )


def health() -> int:
    with _client(3) as client:
        response = client.get("/health")
    payload = _http_json_payload(response, max_bytes=16 * 1024)
    if (
        response.status_code != 200
        or not isinstance(payload, dict)
        or set(payload) != {"schema", "status", "execution"}
        or payload.get("schema") != WORKER_READINESS_SCHEMA
        or payload.get("status") != "ok"
        or payload.get("execution") != "offline-uds"
    ):
        raise RuntimeError("Docling worker health response is invalid")
    return 0


def conversion_smoke() -> int:
    import fitz

    settings = load_settings()
    document = fitz.open()
    page = document.new_page()
    page.insert_text((72, 72), "AKB DOCLING RELEASE PROBE")
    content = document.tobytes()
    document.close()
    source = SourceObject(
        uri="memory://release-probe.pdf",
        filename="release-probe.pdf",
        mime_type="application/pdf",
        content=content,
        sha256=f"sha256:{hashlib.sha256(content).hexdigest()}",
    )
    parser = DoclingParser(settings)
    if parser.readiness() != "ready":
        raise RuntimeError("Docling worker is not ready")
    result = parser.parse(source, parser_profile="release_probe", ocr_enabled=False)
    if (
        result.parser_name != "docling_standard"
        or not any("AKB DOCLING RELEASE PROBE" in block.text for block in result.blocks)
        or result.metadata.get("docling_artifacts_sha256")
        != settings.docling_artifacts_sha256
    ):
        raise RuntimeError("Docling conversion smoke did not preserve the synthetic source")
    print(
        json.dumps(
            {
                "schema": "akb-docling-release-probe-1",
                "status": "passed",
                "parser": result.parser_name,
                "pages": result.pages_processed,
                "blocks": len(result.blocks),
                "artifacts_sha256": settings.docling_artifacts_sha256,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--health", action="store_true")
    group.add_argument("--conversion-smoke", action="store_true")
    args = parser.parse_args()
    return health() if args.health else conversion_smoke()


if __name__ == "__main__":
    raise SystemExit(main())
