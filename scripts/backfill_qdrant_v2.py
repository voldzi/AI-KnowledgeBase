#!/usr/bin/env python3
from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
import hashlib
import json
from typing import Any
import uuid

import httpx


@dataclass
class Stats:
    scanned: int = 0
    valid: int = 0
    written: int = 0
    invalid: int = 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Deterministically copy AKB V1 dense points into RAG V2.")
    parser.add_argument("--qdrant-url", default="http://localhost:6333")
    parser.add_argument("--source", default="akl_document_chunks")
    parser.add_argument("--target", default="document_chunks_v2")
    parser.add_argument("--dense-size", type=int, default=1024)
    parser.add_argument("--colbert-size", type=int, default=128)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--api-key")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--recreate", action="store_true")
    parser.add_argument("--timeout-seconds", type=float, default=120.0)
    args = parser.parse_args(argv)
    if args.batch_size <= 0 or args.dense_size <= 0 or args.colbert_size <= 0:
        parser.error("vector sizes and batch size must be greater than zero")
    args.qdrant_url = args.qdrant_url.rstrip("/")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    headers = {"api-key": args.api_key} if args.api_key else {}
    with httpx.Client(timeout=args.timeout_seconds, headers=headers) as client:
        if not args.dry_run:
            ensure_target(client, args)
        stats = backfill(client, args)
        source_integrity = integrity_snapshot(client, args.qdrant_url, args.source)
        target_integrity = (
            integrity_snapshot(client, args.qdrant_url, args.target)
            if not args.dry_run
            else None
        )
    result = {
        "status": "completed",
        **asdict(stats),
        "source_integrity": source_integrity,
        "target_integrity": target_integrity,
    }
    print(json.dumps(result, sort_keys=True))
    if stats.invalid or (target_integrity is not None and target_integrity != source_integrity):
        return 2
    return 0


def ensure_target(client: httpx.Client, args: argparse.Namespace) -> None:
    url = f"{args.qdrant_url}/collections/{args.target}"
    response = client.get(url)
    if response.status_code == 200 and not args.recreate:
        return
    if response.status_code == 200:
        checked(client.delete(url))
    elif response.status_code != 404:
        checked(response)
    checked(
        client.put(
            url,
            json={
                "vectors": {
                    "dense_bge_m3": {"size": args.dense_size, "distance": "Cosine"},
                    "colbert": {
                        "size": args.colbert_size,
                        "distance": "Cosine",
                        "multivector_config": {"comparator": "max_sim"},
                        "hnsw_config": {"m": 0},
                    },
                }
            },
        )
    )


def backfill(client: httpx.Client, args: argparse.Namespace) -> Stats:
    stats = Stats()
    offset: Any = None
    while True:
        body: dict[str, Any] = {
            "limit": args.batch_size,
            "with_payload": True,
            "with_vector": True,
        }
        if offset is not None:
            body["offset"] = offset
        response = checked(
            client.post(
                f"{args.qdrant_url}/collections/{args.source}/points/scroll",
                json=body,
            )
        ).json()
        result = response.get("result", {})
        points = result.get("points", []) if isinstance(result, dict) else []
        if not points:
            break
        output: list[dict[str, Any]] = []
        for point in points:
            stats.scanned += 1
            converted = build_v2_point(point, dense_size=args.dense_size)
            if converted is None:
                stats.invalid += 1
                continue
            stats.valid += 1
            output.append(converted)
        if output and not args.dry_run:
            checked(
                client.put(
                    f"{args.qdrant_url}/collections/{args.target}/points",
                    params={"wait": "true"},
                    json={"points": output},
                )
            )
            stats.written += len(output)
        offset = result.get("next_page_offset") if isinstance(result, dict) else None
        if offset is None:
            break
    return stats


def build_v2_point(point: dict[str, Any], *, dense_size: int) -> dict[str, Any] | None:
    payload = point.get("payload")
    vector = point.get("vector")
    if isinstance(vector, dict):
        vector = vector.get("dense_bge_m3") or vector.get("")
    if not isinstance(payload, dict) or not isinstance(vector, list) or len(vector) != dense_size:
        return None
    required = ("chunk_id", "document_id", "document_version_id", "text_hash")
    if any(not isinstance(payload.get(key), str) or not payload[key] for key in required):
        return None
    if not payload["text_hash"].startswith("sha256:"):
        return None
    chunk_id = payload["chunk_id"]
    return {
        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, chunk_id)),
        "vector": {"dense_bge_m3": [float(value) for value in vector]},
        "payload": {
            **payload,
            "rag_index_version": "v2",
            "colbert_status": "pending_backfill",
        },
    }


def integrity_snapshot(client: httpx.Client, qdrant_url: str, collection: str) -> dict[str, Any]:
    coordinates: list[str] = []
    offset: Any = None
    while True:
        body: dict[str, Any] = {
            "limit": 256,
            "with_payload": ["chunk_id", "document_version_id", "text_hash"],
            "with_vector": False,
        }
        if offset is not None:
            body["offset"] = offset
        response = checked(
            client.post(
                f"{qdrant_url}/collections/{collection}/points/scroll",
                json=body,
            )
        ).json()
        result = response.get("result", {})
        points = result.get("points", []) if isinstance(result, dict) else []
        for point in points:
            payload = point.get("payload") if isinstance(point, dict) else None
            if not isinstance(payload, dict):
                continue
            values = [payload.get(key) for key in ("chunk_id", "document_version_id", "text_hash")]
            if all(isinstance(value, str) and value for value in values):
                coordinates.append("|".join(values))
        offset = result.get("next_page_offset") if isinstance(result, dict) else None
        if offset is None:
            break
    digest = hashlib.sha256("\n".join(sorted(coordinates)).encode("utf-8")).hexdigest()
    return {"count": len(coordinates), "coordinate_sha256": digest}


def checked(response: httpx.Response) -> httpx.Response:
    response.raise_for_status()
    return response


if __name__ == "__main__":
    raise SystemExit(main())
