#!/usr/bin/env python3
"""Run 200 human-style assistant turns over the governed Czech-law catalog.

The script sends two turns for every immutable source in the revision-2
manifest.  The second turn is bound to the exact persisted assistant message
and evidence-frame hash whenever the first turn supplied citable evidence.
It never writes prompts, answers, bearer tokens, or cookies to the report.
"""

from __future__ import annotations

import argparse
import asyncio
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import statistics
import ssl
import time
from typing import Any
from urllib import error as urlerror
from urllib import request as urlrequest


DEFAULT_MANIFEST = Path("contracts/stratos/official-sources/czech-law-pilot.v2.json")


@dataclass(frozen=True)
class ScenarioResult:
    case_id: str
    initial_status: str
    follow_up_status: str
    initial_citation_count: int
    follow_up_citation_count: int
    expected_law_found: bool
    lineage_attempted: bool
    lineage_preserved: bool
    warnings: list[str]
    latency_ms: float


class JsonApiClient:
    def __init__(
        self,
        *,
        base_url: str,
        headers: dict[str, str],
        timeout_seconds: float,
        verify_tls: bool,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._headers = headers
        self._timeout_seconds = timeout_seconds
        self._ssl_context = (
            ssl.create_default_context()
            if verify_tls
            else ssl._create_unverified_context()  # noqa: SLF001 - explicit CLI opt-in
        )

    async def request(
        self,
        method: str,
        path: str,
        json_body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return await asyncio.to_thread(self._request, method, path, json_body)

    def _request(
        self,
        method: str,
        path: str,
        json_body: dict[str, Any] | None,
    ) -> dict[str, Any]:
        data = json.dumps(json_body).encode("utf-8") if json_body is not None else None
        request = urlrequest.Request(
            f"{self._base_url}{path}",
            data=data,
            method=method,
            headers=self._headers,
        )
        try:
            with urlrequest.urlopen(
                request,
                timeout=self._timeout_seconds,
                context=self._ssl_context,
            ) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urlerror.HTTPError as exc:
            raise RuntimeError(f"Assistant API returned HTTP {exc.code}") from exc
        if not isinstance(payload, dict):
            raise ValueError("Assistant API returned a non-object response")
        return payload


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Evaluate 100 two-turn Czech-law assistant scenarios (200 API questions)."
    )
    parser.add_argument(
        "--base-url",
        default="http://127.0.0.1:8082/api/v1",
        help="RAG Retrieval Service API base ending in /api/v1.",
    )
    parser.add_argument("--subject-id", default="eval_subject")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--timeout-seconds", type=float, default=180.0)
    parser.add_argument(
        "--bearer-token-env",
        default="AKB_EVAL_BEARER_TOKEN",
        help="Environment variable containing the bearer token; its value is never printed.",
    )
    parser.add_argument("--insecure", action="store_true")
    return parser.parse_args()


def _load_sources(path: Path) -> tuple[str, list[dict[str, Any]]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("collectionId") != "czech-law" or payload.get("revision") != "2":
        raise ValueError("The evaluator requires the immutable czech-law revision-2 manifest")
    sources = payload.get("sources")
    if not isinstance(sources, list) or len(sources) != 100:
        raise ValueError("The revision-2 manifest must contain exactly 100 sources")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return f"sha256:{digest}", sources


def _request_context() -> dict[str, Any]:
    return {
        "assistant_query_plan": {
            "version": "2026-09-16",
            "tool": "rag_document_answer",
            "quality_gates": {"citations_required": True},
            "retrieval": {"knowledge_scope": "governed_sources"},
        }
    }


async def _json_request(
    client: JsonApiClient,
    method: str,
    path: str,
    *,
    json_body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return await client.request(method, path, json_body)


def _citation_pairs(payload: dict[str, Any]) -> set[tuple[str, str]]:
    citations = payload.get("citations")
    if not isinstance(citations, list):
        return set()
    pairs: set[tuple[str, str]] = set()
    for citation in citations:
        if not isinstance(citation, dict):
            continue
        document_id = citation.get("document_id")
        version_id = citation.get("document_version_id")
        if isinstance(document_id, str) and isinstance(version_id, str):
            pairs.add((document_id, version_id))
    return pairs


def _latest_assistant_id(history: dict[str, Any]) -> str | None:
    messages = history.get("messages")
    if not isinstance(messages, list):
        return None
    for message in reversed(messages):
        if isinstance(message, dict) and message.get("role") == "assistant":
            value = message.get("message_id")
            return value if isinstance(value, str) else None
    return None


def _evidence_hash(payload: dict[str, Any]) -> str | None:
    context = payload.get("current_context")
    frame = context.get("evidence_frame") if isinstance(context, dict) else None
    value = frame.get("source_scope_hash") if isinstance(frame, dict) else None
    return value if isinstance(value, str) else None


def _warnings(*payloads: dict[str, Any]) -> list[str]:
    values: set[str] = set()
    for payload in payloads:
        raw = payload.get("warnings")
        if isinstance(raw, list):
            values.update(item for item in raw if isinstance(item, str))
    return sorted(values)


async def _run_scenario(
    client: JsonApiClient,
    semaphore: asyncio.Semaphore,
    subject_id: str,
    source: dict[str, Any],
) -> ScenarioResult:
    async with semaphore:
        started = time.perf_counter()
        year = str(source["year"])
        number = str(source["number"])
        law_reference = f"{number}/{year} Sb."
        title = str(source["title"])
        case_id = f"cz-law-{year}-{number}"
        initial = await _json_request(
            client,
            "POST",
            "/assistant/chat",
            json_body={
                "user_id": subject_id,
                "message": f"Vysvětli srozumitelně hlavní účel a oblast úpravy předpisu {title}.",
                "context": _request_context(),
                "mode": "normative_with_citations",
                "response_language": "cs",
            },
        )
        initial_pairs = _citation_pairs(initial)
        cited_titles = {
            str(item.get("document_title") or "")
            for item in initial.get("citations", [])
            if isinstance(item, dict)
        }
        expected_law_found = any(law_reference in cited_title for cited_title in cited_titles)
        conversation_id = initial.get("conversation_id")
        scope_hash = _evidence_hash(initial)
        parent_id: str | None = None
        if isinstance(conversation_id, str):
            history = await _json_request(
                client,
                "GET",
                f"/assistant/conversations/{conversation_id}",
            )
            parent_id = _latest_assistant_id(history)
        lineage_attempted = bool(initial_pairs and conversation_id and parent_id and scope_hash)
        if lineage_attempted:
            follow_up_payload = {
                "user_id": subject_id,
                "conversation_id": conversation_id,
                "parent_message_id": parent_id,
                "turn_origin": "suggested_follow_up",
                "source_bound": True,
                "source_scope_hash": scope_hash,
                "message": "Jaké konkrétní povinnosti nebo praktické dopady z tohoto předpisu vyplývají?",
                "context": _request_context(),
                "mode": "normative_with_citations",
                "response_language": "cs",
            }
        else:
            follow_up_payload = {
                "user_id": subject_id,
                "message": f"Jaké konkrétní povinnosti nebo praktické dopady stanoví předpis {title}?",
                "context": _request_context(),
                "mode": "normative_with_citations",
                "response_language": "cs",
            }
        follow_up = await _json_request(
            client,
            "POST",
            "/assistant/chat",
            json_body=follow_up_payload,
        )
        follow_up_pairs = _citation_pairs(follow_up)
        return ScenarioResult(
            case_id=case_id,
            initial_status=str(initial.get("response_type") or "unknown"),
            follow_up_status=str(follow_up.get("response_type") or "unknown"),
            initial_citation_count=len(initial_pairs),
            follow_up_citation_count=len(follow_up_pairs),
            expected_law_found=expected_law_found,
            lineage_attempted=lineage_attempted,
            lineage_preserved=lineage_attempted and bool(follow_up_pairs) and follow_up_pairs.issubset(initial_pairs),
            warnings=_warnings(initial, follow_up),
            latency_ms=round((time.perf_counter() - started) * 1000, 2),
        )


async def _run(args: argparse.Namespace) -> dict[str, Any]:
    manifest_digest, sources = _load_sources(args.manifest)
    token = os.environ.get(args.bearer_token_env, "").strip()
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    semaphore = asyncio.Semaphore(max(1, min(args.concurrency, 32)))
    started = datetime.now(timezone.utc)
    client = JsonApiClient(
        base_url=args.base_url.rstrip("/"),
        headers=headers,
        timeout_seconds=args.timeout_seconds,
        verify_tls=not args.insecure,
    )
    results = await asyncio.gather(
        *(
            _run_scenario(client, semaphore, args.subject_id, source)
            for source in sources
        ),
        return_exceptions=True,
    )
    normalized: list[ScenarioResult] = []
    errors: list[dict[str, str]] = []
    for index, result in enumerate(results):
        if isinstance(result, BaseException):
            source = sources[index]
            errors.append({
                "case_id": f"cz-law-{source['year']}-{source['number']}",
                "error_type": result.__class__.__name__,
            })
        else:
            normalized.append(result)
    durations = [result.latency_ms for result in normalized]
    lineage_cases = [result for result in normalized if result.lineage_attempted]
    passed = [
        result for result in normalized
        if result.expected_law_found and result.lineage_preserved
    ]
    return {
        "contract_version": "assistant-source-continuity-eval-1",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "started_at": started.isoformat(),
        "manifest_digest": manifest_digest,
        "scenario_count": len(sources),
        "question_count": len(sources) * 2,
        "completed_scenarios": len(normalized),
        "error_scenarios": len(errors),
        "expected_law_match_rate": round(
            sum(result.expected_law_found for result in normalized) / max(1, len(normalized)), 4
        ),
        "lineage_attempt_rate": round(len(lineage_cases) / max(1, len(normalized)), 4),
        "lineage_preservation_rate": round(
            sum(result.lineage_preserved for result in lineage_cases) / max(1, len(lineage_cases)), 4
        ),
        "strict_pass_rate": round(len(passed) / max(1, len(normalized)), 4),
        "latency_ms": {
            "median": round(statistics.median(durations), 2) if durations else 0,
            "p95": round(sorted(durations)[max(0, int(len(durations) * 0.95) - 1)], 2) if durations else 0,
        },
        "quality_gate": "passed" if len(passed) == len(sources) and not errors else "failed",
        "cases": [asdict(result) for result in normalized],
        "errors": errors,
    }


def main() -> int:
    args = _arguments()
    report = asyncio.run(_run(args))
    serialized = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized, encoding="utf-8")
    print(json.dumps({
        key: report[key]
        for key in (
            "scenario_count",
            "question_count",
            "completed_scenarios",
            "error_scenarios",
            "expected_law_match_rate",
            "lineage_preservation_rate",
            "strict_pass_rate",
            "quality_gate",
        )
    }, ensure_ascii=False, indent=2))
    return 0 if report["quality_gate"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
