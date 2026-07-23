#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hmac
import json
import logging
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
from typing import Any, Protocol


LOGGER = logging.getLogger("akb.gte_reranker")
MODEL_ID = "Alibaba-NLP/gte-multilingual-reranker-base"
MODEL_REVISION = "8215cf04918ba6f7b6a62bb44238ce2953d8831c"
CODE_REVISION = "40ced75c3017eb27626c9d4ea981bde21a2662f4"


class Backend(Protocol):
    def rerank(self, query: str, texts: list[str]) -> list[float]: ...


class MpsBackend:
    def __init__(self, *, max_length: int, batch_size: int) -> None:
        import torch
        from sentence_transformers import CrossEncoder

        if not torch.backends.mps.is_available():
            raise RuntimeError("Apple MPS is unavailable")
        self._torch = torch
        self._batch_size = batch_size
        self._model = CrossEncoder(
            MODEL_ID,
            revision=MODEL_REVISION,
            device="mps",
            trust_remote_code=True,
            max_length=max_length,
            model_kwargs={"code_revision": CODE_REVISION},
            config_kwargs={"code_revision": CODE_REVISION},
        )
        self._lock = threading.Lock()

    def rerank(self, query: str, texts: list[str]) -> list[float]:
        with self._lock:
            scores = self._model.predict(
                [(query, text) for text in texts],
                batch_size=self._batch_size,
                show_progress_bar=False,
            )
            self._torch.mps.synchronize()
        return [float(score) for score in scores]


def create_handler(
    *,
    backend: Backend,
    api_key: str,
    max_texts: int,
    max_text_chars: int,
    max_payload_bytes: int,
) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "AKB-GTE-Reranker/1"

        def do_GET(self) -> None:
            if self.path == "/health":
                self._json(HTTPStatus.OK, {"status": "ok", "device": "mps"})
                return
            self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

        def do_POST(self) -> None:
            if self.path != "/rerank":
                self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
                return
            if not self._authorized():
                self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                return
            content_length = self._content_length()
            if content_length is None or content_length > max_payload_bytes:
                self._json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "payload_too_large"})
                return
            try:
                payload = json.loads(self.rfile.read(content_length))
                query, texts = _validate_request(
                    payload,
                    max_texts=max_texts,
                    max_text_chars=max_text_chars,
                )
                scores = backend.rerank(query, texts)
            except (UnicodeDecodeError, json.JSONDecodeError, ValueError, TypeError) as exc:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                return
            except Exception as exc:
                LOGGER.error(
                    "rerank_failed reason=%s content_logged=false",
                    exc.__class__.__name__,
                )
                self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "reranker_unavailable"})
                return
            if len(scores) != len(texts):
                self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "incomplete_scores"})
                return
            results = [
                {"index": index, "score": max(0.0, min(1.0, score))}
                for index, score in enumerate(scores)
            ]
            results.sort(key=lambda item: item["score"], reverse=True)
            self._json(HTTPStatus.OK, results)

        def log_message(self, format: str, *args: Any) -> None:
            LOGGER.info("request method=%s status=%s content_logged=false", self.command, args[1])

        def _authorized(self) -> bool:
            expected = f"Bearer {api_key}"
            supplied = self.headers.get("Authorization", "")
            return hmac.compare_digest(supplied, expected)

        def _content_length(self) -> int | None:
            try:
                value = int(self.headers.get("Content-Length", ""))
            except ValueError:
                return None
            return value if value >= 0 else None

        def _json(self, status: HTTPStatus, payload: object) -> None:
            body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return Handler


def _validate_request(
    payload: object,
    *,
    max_texts: int,
    max_text_chars: int,
) -> tuple[str, list[str]]:
    if not isinstance(payload, dict):
        raise ValueError("request must be an object")
    query = payload.get("query")
    texts = payload.get("texts")
    if not isinstance(query, str) or not query.strip():
        raise ValueError("query must be a non-empty string")
    if not isinstance(texts, list) or not 1 <= len(texts) <= max_texts:
        raise ValueError(f"texts must contain between 1 and {max_texts} strings")
    if any(not isinstance(text, str) or not text.strip() for text in texts):
        raise ValueError("texts must contain non-empty strings")
    if len(query) > max_text_chars or any(len(text) > max_text_chars for text in texts):
        raise ValueError("query or text exceeds the configured character limit")
    return query.strip(), [text.strip() for text in texts]


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve the pinned GTE reranker over MPS")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=11438)
    parser.add_argument("--api-key-file", type=Path, required=True)
    parser.add_argument("--max-texts", type=int, default=32)
    parser.add_argument("--max-text-chars", type=int, default=2000)
    parser.add_argument("--max-payload-bytes", type=int, default=2_000_000)
    parser.add_argument("--max-length", type=int, default=512)
    parser.add_argument("--batch-size", type=int, default=8)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    api_key = args.api_key_file.read_text(encoding="utf-8").strip()
    if not api_key:
        raise SystemExit("API key file is empty")
    backend = MpsBackend(max_length=args.max_length, batch_size=args.batch_size)
    handler = create_handler(
        backend=backend,
        api_key=api_key,
        max_texts=args.max_texts,
        max_text_chars=args.max_text_chars,
        max_payload_bytes=args.max_payload_bytes,
    )
    server = ThreadingHTTPServer((args.host, args.port), handler)
    LOGGER.info(
        "ready host=%s port=%s model=%s revision=%s code_revision=%s device=mps content_logged=false",
        args.host,
        args.port,
        MODEL_ID,
        MODEL_REVISION,
        CODE_REVISION,
    )
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
