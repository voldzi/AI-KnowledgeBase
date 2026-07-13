#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from typing import Any


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    ensure_index(args.opensearch_url, args.opensearch_index)
    total = backfill(args)
    count = opensearch_count(args.opensearch_url, args.opensearch_index)
    print(f"backfilled={total}")
    print(f"opensearch_count={count}")
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Backfill AKB OpenSearch chunk index from existing Qdrant payloads."
    )
    parser.add_argument("--qdrant-url", default="http://localhost:6333")
    parser.add_argument("--qdrant-collection", default="akl_document_chunks")
    parser.add_argument("--opensearch-url", default="http://localhost:9200")
    parser.add_argument("--opensearch-index", default="akl_document_chunks")
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args(argv)
    if args.batch_size <= 0:
        parser.error("--batch-size must be greater than zero")
    if args.limit is not None and args.limit <= 0:
        parser.error("--limit must be greater than zero")
    args.qdrant_url = args.qdrant_url.rstrip("/")
    args.opensearch_url = args.opensearch_url.rstrip("/")
    return args


def backfill(args: argparse.Namespace) -> int:
    total = 0
    offset: Any = None
    while True:
        page_limit = args.batch_size
        if args.limit is not None:
            remaining = args.limit - total
            if remaining <= 0:
                break
            page_limit = min(page_limit, remaining)

        body: dict[str, Any] = {
            "limit": page_limit,
            "with_payload": True,
            "with_vector": False,
        }
        if offset is not None:
            body["offset"] = offset
        page = request_json(
            "POST",
            f"{args.qdrant_url}/collections/{args.qdrant_collection}/points/scroll",
            body,
        )
        result = page.get("result") if isinstance(page.get("result"), dict) else {}
        points = result.get("points") if isinstance(result.get("points"), list) else []
        if not points:
            break

        documents = []
        for point in points:
            payload = point.get("payload") if isinstance(point, dict) else None
            if isinstance(payload, dict) and payload.get("chunk_id"):
                documents.append(opensearch_document(payload))
        if documents:
            bulk_upsert(args.opensearch_url, args.opensearch_index, documents)
            total += len(documents)
            print(f"indexed={total}", flush=True)

        offset = result.get("next_page_offset")
        if offset is None:
            break
    return total


def ensure_index(opensearch_url: str, index: str) -> None:
    try:
        request_json("GET", f"{opensearch_url}/{index}")
        return
    except RuntimeError as exc:
        if "HTTP 404" not in str(exc):
            raise
    request_json("PUT", f"{opensearch_url}/{index}", index_definition())


def bulk_upsert(opensearch_url: str, index: str, documents: list[dict[str, Any]]) -> None:
    lines: list[str] = []
    for document in documents:
        lines.append(json.dumps({"index": {"_index": index, "_id": document["chunk_id"]}}))
        lines.append(json.dumps(document, ensure_ascii=False))
    data = ("\n".join(lines) + "\n").encode("utf-8")
    request_json(
        "POST",
        f"{opensearch_url}/_bulk",
        data=data,
        headers={"Content-Type": "application/x-ndjson"},
    )


def opensearch_document(payload: dict[str, Any]) -> dict[str, Any]:
    document = dict(payload)
    metadata = document.get("metadata") if isinstance(document.get("metadata"), dict) else {}
    document.setdefault("embedding_model", metadata.get("embedding_model") or "backfilled-from-qdrant")
    document["search_text"] = "\n".join(
        value
        for value in (
            document.get("document_title"),
            document.get("section_title"),
            " / ".join(document.get("section_path") or []),
            document.get("text"),
        )
        if isinstance(value, str) and value.strip()
    )
    return document


def opensearch_count(opensearch_url: str, index: str) -> int:
    body = request_json("GET", f"{opensearch_url}/{index}/_count")
    return int(body.get("count", 0))


def request_json(
    method: str,
    url: str,
    payload: dict[str, Any] | None = None,
    *,
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    if data is None and payload is not None:
        data = json.dumps(payload).encode("utf-8")
    request_headers = {"Accept": "application/json"}
    if payload is not None:
        request_headers["Content-Type"] = "application/json"
    if headers:
        request_headers.update(headers)
    request = urllib.request.Request(url, data=data, method=method, headers=request_headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read().decode("utf-8")
            body = json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} failed with HTTP {exc.code}: {raw[:1000]}") from exc

    if body.get("errors"):
        raise RuntimeError(f"{method} {url} returned item errors: {json.dumps(body)[:1000]}")
    return body


def index_definition() -> dict[str, Any]:
    return {
        "settings": {
            "index": {
                "number_of_shards": 1,
                "number_of_replicas": 0,
            },
            "analysis": {
                "filter": {
                    "akb_czech_stop": {"type": "stop", "stopwords": "_czech_"},
                    "akb_czech_stemmer": {"type": "stemmer", "language": "czech"},
                },
                "analyzer": {
                    "akb_czech": {
                        "type": "custom",
                        "tokenizer": "standard",
                        "filter": ["lowercase", "asciifolding", "akb_czech_stop", "akb_czech_stemmer"],
                    }
                },
            },
        },
        "mappings": {
            "dynamic": True,
            "properties": {
                "chunk_id": {"type": "keyword"},
                "document_id": {"type": "keyword"},
                "document_version_id": {"type": "keyword"},
                "document_title": {
                    "type": "text",
                    "analyzer": "akb_czech",
                    "fields": {"keyword": {"type": "keyword", "ignore_above": 512}},
                },
                "version_label": {"type": "keyword"},
                "document_type": {"type": "keyword"},
                "text": {"type": "text", "analyzer": "akb_czech"},
                "normalized_text": {"type": "text", "analyzer": "akb_czech"},
                "search_text": {"type": "text", "analyzer": "akb_czech"},
                "section_title": {"type": "text", "analyzer": "akb_czech"},
                "section_path": {"type": "keyword"},
                "article_number": {"type": "keyword"},
                "paragraph_number": {"type": "keyword"},
                "classification": {"type": "keyword"},
                "status": {"type": "keyword"},
                "tags": {"type": "keyword"},
                "valid_from": {"type": "date"},
                "valid_to": {"type": "date"},
                "page_number": {"type": "integer"},
                "char_start": {"type": "integer"},
                "char_end": {"type": "integer"},
                "source_file_uri": {"type": "keyword", "index": False},
                "source_file_name": {"type": "keyword"},
                "source_mime_type": {"type": "keyword"},
                "source_sha256": {"type": "keyword"},
                "embedding_model": {"type": "keyword"},
            },
        },
    }


if __name__ == "__main__":
    raise SystemExit(main())
