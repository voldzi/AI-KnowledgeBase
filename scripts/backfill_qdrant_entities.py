#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

ROOT = Path(__file__).resolve().parents[1]
for candidate in (ROOT / "services" / "ingestion-service", Path("/app")):
    if str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))

from intelligence.entities import build_intelligence_metadata, intelligence_payload_fields  # noqa: E402


@dataclass
class BackfillStats:
    scanned: int = 0
    updated: int = 0
    skipped_existing: int = 0
    skipped_no_text: int = 0
    chunks_with_entities: int = 0
    entities_found: int = 0
    update_failures: int = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "scanned": self.scanned,
            "updated": self.updated,
            "skipped_existing": self.skipped_existing,
            "skipped_no_text": self.skipped_no_text,
            "chunks_with_entities": self.chunks_with_entities,
            "entities_found": self.entities_found,
            "update_failures": self.update_failures,
        }


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    with httpx.Client(timeout=args.timeout_seconds) as client:
        stats = backfill_entities(client, args)
    print(json.dumps({"status": "completed", **stats.as_dict()}, sort_keys=True))
    return 0 if stats.update_failures == 0 else 2


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Backfill AKB Qdrant point payloads with rule_based_v1 entity metadata."
    )
    parser.add_argument("--qdrant-url", default="http://localhost:6333")
    parser.add_argument("--collection", default="akl_document_chunks")
    parser.add_argument("--api-key", default=None)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--missing-only", action="store_true")
    parser.add_argument("--wait", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--timeout-seconds", type=float, default=120.0)
    args = parser.parse_args(argv)
    if args.batch_size <= 0:
        parser.error("--batch-size must be greater than zero")
    if args.limit is not None and args.limit <= 0:
        parser.error("--limit must be greater than zero")
    args.qdrant_url = args.qdrant_url.rstrip("/")
    return args


def backfill_entities(client: httpx.Client, args: argparse.Namespace) -> BackfillStats:
    stats = BackfillStats()
    offset: Any = None
    started = time.monotonic()
    while True:
        page = scroll_points(client, args, offset)
        result = page.get("result") if isinstance(page.get("result"), dict) else {}
        points = result.get("points") if isinstance(result.get("points"), list) else []
        if not points:
            break
        for point in points:
            if args.limit is not None and stats.scanned >= args.limit:
                break
            stats.scanned += 1
            point_id = point.get("id") if isinstance(point, dict) else None
            payload = point.get("payload") if isinstance(point, dict) else None
            if not isinstance(payload, dict) or point_id is None:
                stats.skipped_no_text += 1
                continue
            if args.missing_only and payload_has_entity_profile(payload):
                stats.skipped_existing += 1
                continue
            update_payload = build_qdrant_payload_update(payload)
            if update_payload is None:
                stats.skipped_no_text += 1
                continue
            stats.updated += 1
            entity_count = entity_count_from_update(update_payload)
            stats.entities_found += entity_count
            if entity_count > 0:
                stats.chunks_with_entities += 1
            if not args.dry_run:
                if not set_point_payload(client, args, point_id, update_payload):
                    stats.update_failures += 1
        print_progress(stats, started, dry_run=args.dry_run)
        if args.limit is not None and stats.scanned >= args.limit:
            break
        offset = result.get("next_page_offset") if isinstance(result, dict) else None
        if offset is None:
            break
    return stats


def scroll_points(client: httpx.Client, args: argparse.Namespace, offset: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "limit": args.batch_size,
        "with_payload": True,
        "with_vector": False,
    }
    if offset is not None:
        body["offset"] = offset
    return request_json(
        client,
        "POST",
        f"{args.qdrant_url}/collections/{args.collection}/points/scroll",
        args=args,
        payload=body,
    )


def set_point_payload(client: httpx.Client, args: argparse.Namespace, point_id: Any, payload: dict[str, Any]) -> bool:
    response = request_json(
        client,
        "POST",
        f"{args.qdrant_url}/collections/{args.collection}/points/payload",
        args=args,
        params={"wait": str(args.wait).lower()},
        payload={"payload": payload, "points": [point_id]},
    )
    status = response.get("status")
    return status in {None, "ok"}


def build_qdrant_payload_update(payload: dict[str, Any]) -> dict[str, Any] | None:
    text = string_value(payload.get("text")) or string_value(payload.get("normalized_text"))
    if not text:
        return None

    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    updated_metadata = dict(metadata)
    intelligence = build_intelligence_metadata(text)
    updated_metadata["intelligence"] = intelligence
    payload_fields = intelligence_payload_fields(updated_metadata)

    return {
        "metadata": updated_metadata,
        **payload_fields,
    }


def payload_has_entity_profile(payload: dict[str, Any]) -> bool:
    metadata = payload.get("metadata")
    if not isinstance(metadata, dict):
        return False
    intelligence = metadata.get("intelligence")
    if not isinstance(intelligence, dict):
        return False
    return bool(intelligence.get("entity_extraction_profile"))


def entity_count_from_update(update_payload: dict[str, Any]) -> int:
    metadata = update_payload.get("metadata")
    if not isinstance(metadata, dict):
        return 0
    intelligence = metadata.get("intelligence")
    if not isinstance(intelligence, dict):
        return 0
    count = intelligence.get("entity_count")
    return count if isinstance(count, int) else 0


def request_json(
    client: httpx.Client,
    method: str,
    url: str,
    *,
    args: argparse.Namespace,
    params: dict[str, str] | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    headers: dict[str, str] = {}
    if args.api_key:
        headers["api-key"] = args.api_key
    try:
        response = client.request(method, url, params=params, json=payload, headers=headers)
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        body = exc.response.text[:1000]
        raise RuntimeError(f"{method} {url} failed with HTTP {exc.response.status_code}: {body}") from exc
    except httpx.HTTPError as exc:
        raise RuntimeError(f"{method} {url} failed: {exc}") from exc
    return response.json() if response.text else {}


def print_progress(stats: BackfillStats, started: float, *, dry_run: bool) -> None:
    elapsed = max(time.monotonic() - started, 0.001)
    rate = stats.scanned / elapsed
    print(
        "progress "
        f"dry_run={str(dry_run).lower()} "
        f"scanned={stats.scanned} "
        f"updated={stats.updated} "
        f"skipped_existing={stats.skipped_existing} "
        f"chunks_with_entities={stats.chunks_with_entities} "
        f"entities_found={stats.entities_found} "
        f"skipped_no_text={stats.skipped_no_text} "
        f"update_failures={stats.update_failures} "
        f"rate_per_second={rate:.1f}",
        flush=True,
    )


def string_value(value: Any) -> str | None:
    return value if isinstance(value, str) and value.strip() else None


if __name__ == "__main__":
    raise SystemExit(main())
