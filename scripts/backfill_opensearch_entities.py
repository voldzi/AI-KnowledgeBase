#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import httpx

ROOT = Path(__file__).resolve().parents[1]
for candidate in (ROOT / "services" / "ingestion-service", Path("/app")):
    if str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))

from intelligence.entities import build_intelligence_metadata, intelligence_payload_fields  # noqa: E402


DEFAULT_SOURCE_FIELDS = [
    "chunk_id",
    "document_title",
    "section_title",
    "section_path",
    "text",
    "normalized_text",
    "metadata",
]


@dataclass
class BackfillStats:
    scanned: int = 0
    updated: int = 0
    skipped_no_text: int = 0
    chunks_with_entities: int = 0
    entities_found: int = 0
    bulk_failures: int = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "scanned": self.scanned,
            "updated": self.updated,
            "skipped_no_text": self.skipped_no_text,
            "chunks_with_entities": self.chunks_with_entities,
            "entities_found": self.entities_found,
            "bulk_failures": self.bulk_failures,
        }


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.dry_run:
        ensure_entity_mapping(args)
    stats = backfill_entities(args)
    if args.refresh and not args.dry_run:
        request_json("POST", f"{args.opensearch_url}/{args.opensearch_index}/_refresh")
    print(json.dumps({"status": "completed", **stats.as_dict()}, sort_keys=True))
    return 0 if stats.bulk_failures == 0 else 2


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Backfill AKB OpenSearch chunk documents with rule_based_v1 entity metadata."
    )
    parser.add_argument("--opensearch-url", default="http://localhost:9200")
    parser.add_argument("--opensearch-index", default="akl_document_chunks")
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--scroll-ttl", default="2m")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--missing-only", action="store_true")
    parser.add_argument("--refresh", action=argparse.BooleanOptionalAction, default=True)
    args = parser.parse_args(argv)
    if args.batch_size <= 0:
        parser.error("--batch-size must be greater than zero")
    if args.limit is not None and args.limit <= 0:
        parser.error("--limit must be greater than zero")
    args.opensearch_url = args.opensearch_url.rstrip("/")
    return args


def backfill_entities(args: argparse.Namespace) -> BackfillStats:
    stats = BackfillStats()
    scroll_id: str | None = None
    started = time.monotonic()
    try:
        page = initial_search(args)
        scroll_id = string_value(page.get("_scroll_id"))
        while True:
            hits = search_hits(page)
            if not hits:
                break
            updates: list[tuple[str, dict[str, Any]]] = []
            for hit in hits:
                if args.limit is not None and stats.scanned >= args.limit:
                    break
                stats.scanned += 1
                source = hit.get("_source") if isinstance(hit, dict) else None
                if not isinstance(source, dict):
                    stats.skipped_no_text += 1
                    continue
                update_doc = build_entity_update_document(source)
                if update_doc is None:
                    stats.skipped_no_text += 1
                    continue
                stats.updated += 1
                entity_count = entity_count_from_update(update_doc)
                stats.entities_found += entity_count
                if entity_count > 0:
                    stats.chunks_with_entities += 1
                if not args.dry_run:
                    document_id = string_value(hit.get("_id")) or string_value(source.get("chunk_id"))
                    if document_id:
                        updates.append((document_id, update_doc))
            if updates:
                failures = bulk_update(args, updates)
                stats.bulk_failures += failures
            print_progress(stats, started, dry_run=args.dry_run)
            if args.limit is not None and stats.scanned >= args.limit:
                break
            if not scroll_id:
                break
            page = scroll_search(args, scroll_id)
            scroll_id = string_value(page.get("_scroll_id")) or scroll_id
    finally:
        if scroll_id:
            clear_scroll(args, scroll_id)
    return stats


def initial_search(args: argparse.Namespace) -> dict[str, Any]:
    query: dict[str, Any] = {"match_all": {}}
    if args.missing_only:
        query = {"bool": {"must_not": [{"exists": {"field": "metadata.intelligence.entity_extraction_profile"}}]}}
    body = {
        "size": args.batch_size,
        "sort": ["_doc"],
        "_source": DEFAULT_SOURCE_FIELDS,
        "query": query,
    }
    return request_json(
        "POST",
        f"{args.opensearch_url}/{args.opensearch_index}/_search",
        params={"scroll": args.scroll_ttl},
        payload=body,
    )


def scroll_search(args: argparse.Namespace, scroll_id: str) -> dict[str, Any]:
    return request_json(
        "POST",
        f"{args.opensearch_url}/_search/scroll",
        payload={"scroll": args.scroll_ttl, "scroll_id": scroll_id},
    )


def clear_scroll(args: argparse.Namespace, scroll_id: str) -> None:
    try:
        request_json("DELETE", f"{args.opensearch_url}/_search/scroll", payload={"scroll_id": [scroll_id]})
    except RuntimeError:
        return


def search_hits(page: dict[str, Any]) -> list[dict[str, Any]]:
    hits = page.get("hits")
    if not isinstance(hits, dict):
        return []
    items = hits.get("hits")
    if not isinstance(items, list):
        return []
    return [item for item in items if isinstance(item, dict)]


def build_entity_update_document(source: dict[str, Any]) -> dict[str, Any] | None:
    text = string_value(source.get("text")) or string_value(source.get("normalized_text"))
    if not text:
        return None

    metadata = source.get("metadata") if isinstance(source.get("metadata"), dict) else {}
    updated_metadata = dict(metadata)
    intelligence = build_intelligence_metadata(text)
    updated_metadata["intelligence"] = intelligence
    payload_fields = intelligence_payload_fields(updated_metadata)

    return {
        "metadata": updated_metadata,
        **payload_fields,
        "search_text": search_text_for_source(source, payload_fields),
    }


def search_text_for_source(source: dict[str, Any], payload_fields: dict[str, list[str]]) -> str:
    values: Iterable[str | None] = (
        string_value(source.get("document_title")),
        string_value(source.get("section_title")),
        " / ".join(source.get("section_path") or []) if isinstance(source.get("section_path"), list) else None,
        string_value(source.get("text")) or string_value(source.get("normalized_text")),
        " ".join(payload_fields.get("entity_values") or []),
        " ".join(payload_fields.get("entity_pairs") or []),
    )
    return "\n".join(value for value in values if isinstance(value, str) and value.strip())


def entity_count_from_update(update_doc: dict[str, Any]) -> int:
    metadata = update_doc.get("metadata")
    if not isinstance(metadata, dict):
        return 0
    intelligence = metadata.get("intelligence")
    if not isinstance(intelligence, dict):
        return 0
    count = intelligence.get("entity_count")
    return count if isinstance(count, int) else 0


def bulk_update(args: argparse.Namespace, updates: list[tuple[str, dict[str, Any]]]) -> int:
    lines: list[str] = []
    for document_id, update_doc in updates:
        lines.append(json.dumps({"update": {"_index": args.opensearch_index, "_id": document_id}}))
        lines.append(json.dumps({"doc": update_doc}, ensure_ascii=False))
    body = ("\n".join(lines) + "\n").encode("utf-8")
    response = request_json(
        "POST",
        f"{args.opensearch_url}/_bulk",
        params={"refresh": "false"},
        data=body,
        headers={"Content-Type": "application/x-ndjson"},
    )
    return len(bulk_errors(response))


def bulk_errors(response: dict[str, Any]) -> list[dict[str, Any]]:
    items = response.get("items")
    if not isinstance(items, list):
        return []
    errors: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        operation = item.get("update")
        if isinstance(operation, dict) and operation.get("error"):
            errors.append({"status": operation.get("status"), "error": operation.get("error")})
    return errors


def ensure_entity_mapping(args: argparse.Namespace) -> None:
    request_json(
        "PUT",
        f"{args.opensearch_url}/{args.opensearch_index}/_mapping",
        payload={
            "properties": {
                "entity_types": {"type": "keyword"},
                "entity_values": {"type": "keyword"},
                "entity_pairs": {"type": "keyword"},
            }
        },
    )


def request_json(
    method: str,
    url: str,
    *,
    params: dict[str, str] | None = None,
    payload: dict[str, Any] | None = None,
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    request_headers = {"Accept": "application/json"}
    if headers:
        request_headers.update(headers)
    try:
        with httpx.Client(timeout=120.0) as client:
            response = client.request(
                method,
                url,
                params=params,
                json=payload,
                content=data,
                headers=request_headers,
            )
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        body = exc.response.text[:1000]
        raise RuntimeError(f"{method} {url} failed with HTTP {exc.response.status_code}: {body}") from exc
    except httpx.HTTPError as exc:
        raise RuntimeError(f"{method} {url} failed: {exc}") from exc
    raw = response.text
    return json.loads(raw) if raw else {}


def print_progress(stats: BackfillStats, started: float, *, dry_run: bool) -> None:
    elapsed = max(time.monotonic() - started, 0.001)
    rate = stats.scanned / elapsed
    print(
        "progress "
        f"dry_run={str(dry_run).lower()} "
        f"scanned={stats.scanned} "
        f"updated={stats.updated} "
        f"chunks_with_entities={stats.chunks_with_entities} "
        f"entities_found={stats.entities_found} "
        f"skipped_no_text={stats.skipped_no_text} "
        f"bulk_failures={stats.bulk_failures} "
        f"rate_per_second={rate:.1f}",
        flush=True,
    )


def string_value(value: Any) -> str | None:
    return value if isinstance(value, str) and value.strip() else None


if __name__ == "__main__":
    raise SystemExit(main())
