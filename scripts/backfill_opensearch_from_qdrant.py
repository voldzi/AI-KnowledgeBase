#!/usr/bin/env python3
from __future__ import annotations

import argparse
from base64 import b64encode
import json
import os
from pathlib import Path
import re
import ssl
import sys
import urllib.error
import urllib.request
from typing import Any


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    ensure_index(args)
    total = backfill(args)
    refresh(args)
    count = opensearch_count(args)
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
    parser.add_argument(
        "--opensearch-username",
        default=os.getenv("AKL_OPENSEARCH_USERNAME"),
    )
    parser.add_argument(
        "--opensearch-password-file",
        default=os.getenv("AKL_OPENSEARCH_PASSWORD_FILE"),
    )
    parser.add_argument(
        "--opensearch-ca-file",
        default=os.getenv("AKL_OPENSEARCH_CA_FILE"),
    )
    parser.add_argument(
        "--create-index",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Create a missing index for local development; use --no-create-index for a managed alias.",
    )
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args(argv)
    if args.batch_size <= 0:
        parser.error("--batch-size must be greater than zero")
    if args.limit is not None and args.limit <= 0:
        parser.error("--limit must be greater than zero")
    args.qdrant_url = args.qdrant_url.rstrip("/")
    args.opensearch_url = args.opensearch_url.rstrip("/")
    args.opensearch_password = _load_opensearch_password(args.opensearch_password_file)
    if bool(args.opensearch_username) != bool(args.opensearch_password):
        parser.error("OpenSearch username and password must be configured together")
    if args.opensearch_url.startswith("https://") and not args.opensearch_ca_file:
        parser.error("HTTPS OpenSearch requires --opensearch-ca-file")
    args.opensearch_ssl_context = _opensearch_ssl_context(args.opensearch_ca_file)
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
            bulk_upsert(args, documents)
            total += len(documents)
            print(f"indexed={total}", flush=True)

        offset = result.get("next_page_offset")
        if offset is None:
            break
    return total


def ensure_index(args: argparse.Namespace) -> None:
    try:
        opensearch_request_json(
            args,
            "GET",
            f"{args.opensearch_url}/{args.opensearch_index}",
        )
        opensearch_request_json(
            args,
            "PUT",
            f"{args.opensearch_url}/{args.opensearch_index}/_mapping",
            mapping_definition(),
        )
        return
    except RuntimeError as exc:
        if "HTTP 404" not in str(exc):
            raise
    if not args.create_index:
        raise RuntimeError(
            f"Configured OpenSearch index or alias {args.opensearch_index!r} does not exist"
        )
    opensearch_request_json(
        args,
        "PUT",
        f"{args.opensearch_url}/{args.opensearch_index}",
        index_definition(),
    )


def bulk_upsert(args: argparse.Namespace, documents: list[dict[str, Any]]) -> None:
    lines: list[str] = []
    for document in documents:
        lines.append(
            json.dumps(
                {
                    "index": {
                        "_index": args.opensearch_index,
                        "_id": document["chunk_id"],
                    }
                }
            )
        )
        lines.append(json.dumps(document, ensure_ascii=False))
    data = ("\n".join(lines) + "\n").encode("utf-8")
    opensearch_request_json(
        args,
        "POST",
        f"{args.opensearch_url}/_bulk",
        data=data,
        headers={"Content-Type": "application/x-ndjson"},
    )


def opensearch_document(payload: dict[str, Any]) -> dict[str, Any]:
    document = dict(payload)
    metadata = document.get("metadata") if isinstance(document.get("metadata"), dict) else {}
    document_id = document.get("document_id")
    document_version_id = document.get("document_version_id")
    policy_hash = document.get("policy_hash")
    if (
        not isinstance(document_id, str)
        or not document_id
        or not isinstance(document_version_id, str)
        or not document_version_id
        or not isinstance(policy_hash, str)
        or not re.fullmatch(r"sha256:[a-f0-9]{64}", policy_hash)
    ):
        chunk_id = document.get("chunk_id") or "<unknown>"
        raise RuntimeError(
            f"Qdrant chunk {chunk_id} is missing a valid authorization coordinate"
        )
    document.setdefault(
        "embedding_model",
        metadata.get("embedding_model") or "backfilled-from-qdrant",
    )
    document["authorization_key"] = authorization_key(
        document_id,
        document_version_id,
        policy_hash,
    )
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


def opensearch_count(args: argparse.Namespace) -> int:
    body = opensearch_request_json(
        args,
        "GET",
        f"{args.opensearch_url}/{args.opensearch_index}/_count",
    )
    return int(body.get("count", 0))


def refresh(args: argparse.Namespace) -> None:
    opensearch_request_json(
        args,
        "POST",
        f"{args.opensearch_url}/{args.opensearch_index}/_refresh",
    )


def authorization_key(
    document_id: str,
    document_version_id: str,
    policy_hash: str,
) -> str:
    from hashlib import sha256

    coordinate = "\x1f".join((document_id, document_version_id, policy_hash))
    return f"sha256:{sha256(coordinate.encode('utf-8')).hexdigest()}"


def opensearch_request_json(
    args: argparse.Namespace,
    method: str,
    url: str,
    payload: dict[str, Any] | None = None,
    *,
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    request_headers = dict(headers or {})
    if args.opensearch_username and args.opensearch_password:
        token = b64encode(
            f"{args.opensearch_username}:{args.opensearch_password}".encode("utf-8")
        ).decode("ascii")
        request_headers["Authorization"] = f"Basic {token}"
    return request_json(
        method,
        url,
        payload,
        data=data,
        headers=request_headers,
        ssl_context=args.opensearch_ssl_context,
    )


def request_json(
    method: str,
    url: str,
    payload: dict[str, Any] | None = None,
    *,
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
    ssl_context: ssl.SSLContext | None = None,
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
        with urllib.request.urlopen(request, timeout=60, context=ssl_context) as response:
            raw = response.read().decode("utf-8")
            body = json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} failed with HTTP {exc.code}: {raw[:1000]}") from exc

    if body.get("errors"):
        raise RuntimeError(f"{method} {url} returned item errors: {json.dumps(body)[:1000]}")
    return body


def _load_opensearch_password(password_file: str | None) -> str | None:
    if password_file:
        try:
            password = Path(password_file).read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise argparse.ArgumentTypeError(
                "OpenSearch password file could not be read"
            ) from exc
        if not password:
            raise argparse.ArgumentTypeError("OpenSearch password file must not be empty")
        return password
    return os.getenv("AKL_OPENSEARCH_PASSWORD") or None


def _opensearch_ssl_context(ca_file: str | None) -> ssl.SSLContext | None:
    if ca_file is None:
        return None
    try:
        return ssl.create_default_context(cafile=ca_file)
    except (OSError, ssl.SSLError) as exc:
        raise argparse.ArgumentTypeError(
            "OpenSearch CA file could not be loaded"
        ) from exc


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
        "mappings": mapping_definition(),
    }


def mapping_definition() -> dict[str, Any]:
    return {
        "dynamic": True,
        "properties": {
            "chunk_id": {"type": "keyword"},
            "document_id": {"type": "keyword"},
            "document_version_id": {"type": "keyword"},
            "authorization_key": {"type": "keyword"},
            "document_title": {
                "type": "text",
                "analyzer": "akb_czech",
                "fields": {"keyword": {"type": "keyword", "ignore_above": 512}},
            },
            "version_label": {"type": "keyword"},
            "document_type": {"type": "keyword"},
            "tenant_id": {"type": "keyword"},
            "external_system": {"type": "keyword"},
            "external_ref": {"type": "keyword"},
            "text": {"type": "text", "analyzer": "akb_czech"},
            "normalized_text": {"type": "text", "analyzer": "akb_czech"},
            "search_text": {"type": "text", "analyzer": "akb_czech"},
            "section_title": {"type": "text", "analyzer": "akb_czech"},
            "section_path": {"type": "keyword"},
            "article_number": {"type": "keyword"},
            "paragraph_number": {"type": "keyword"},
            "classification": {"type": "keyword"},
            "organization_id": {"type": "keyword"},
            "policy_binding_id": {"type": "keyword"},
            "policy_version": {"type": "keyword"},
            "policy_hash": {"type": "keyword"},
            "policy_summary": {
                "properties": {
                    "handlingClass": {"type": "keyword"},
                    "legalClassification": {"type": "keyword"},
                    "tlp": {"type": "keyword"},
                    "pap": {"type": "keyword"},
                    "contentCategories": {"type": "keyword"},
                    "obligations": {"type": "keyword"},
                    "audience": {
                        "properties": {
                            "organizationId": {"type": "keyword"},
                            "scopeType": {"type": "keyword"},
                            "scopeIds": {"type": "keyword"},
                            "recipientSubjectIds": {"type": "keyword"},
                        }
                    },
                },
            },
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
            "entity_types": {"type": "keyword"},
            "entity_values": {"type": "keyword"},
            "entity_pairs": {"type": "keyword"},
        },
    }


if __name__ == "__main__":
    raise SystemExit(main())
