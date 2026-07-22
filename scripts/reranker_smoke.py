#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request


QUERY = "Kdo schvaluje výjimku ze směrnice?"
DOCUMENTS = [
    "Příloha obsahuje seznam použitých zkratek.",
    "Výjimku ze směrnice schvaluje ředitel odboru po vyjádření gestora.",
    "Dokument se archivuje po dobu pěti let.",
]


def request_json(url: str, payload: dict[str, object], api_key: str | None) -> object:
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def top_index(response: object) -> int:
    if isinstance(response, list) and response:
        first = response[0]
    elif isinstance(response, dict):
        results = response.get("results")
        if not isinstance(results, list) or not results:
            raise ValueError("response does not contain results")
        first = results[0]
    else:
        raise ValueError("response has an unsupported shape")
    if not isinstance(first, dict) or not isinstance(first.get("index"), int):
        raise ValueError("top result does not contain an integer index")
    return first["index"]


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify a live AKB reranker endpoint")
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--provider", choices=("llama", "tei"), required=True)
    parser.add_argument("--api-key")
    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")
    if args.provider == "llama":
        endpoint = f"{base_url}/v1/rerank"
        payload = {
            "model": "qwen3-reranker-0.6b",
            "query": QUERY,
            "top_n": len(DOCUMENTS),
            "documents": DOCUMENTS,
        }
    else:
        endpoint = f"{base_url}/rerank"
        payload = {"query": QUERY, "texts": DOCUMENTS, "raw_scores": False}

    try:
        response = request_json(endpoint, payload, args.api_key)
        winner = top_index(response)
    except (OSError, ValueError, urllib.error.HTTPError) as exc:
        print(f"reranker smoke failed: {exc}", file=sys.stderr)
        return 1
    if winner != 1:
        print(f"reranker smoke failed: expected document 1, received {winner}", file=sys.stderr)
        return 1
    print(json.dumps({"status": "passed", "provider": args.provider, "top_index": winner}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
