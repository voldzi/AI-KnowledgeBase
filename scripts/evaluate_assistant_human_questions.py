#!/usr/bin/env python3
"""Run 200 governed, human-style Czech-law chat turns with content checks.

Two source-bound turns are sent for every immutable source in the czech-law
revision-2 manifest. The durable report never stores prompts, answers, source
text, bearer tokens or cookies. It records content-integrity signals, citation
reauthorization, source continuity, latency and metered model cost.
"""

from __future__ import annotations

import argparse
import asyncio
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import statistics
import sys
import threading
import time
from typing import Any
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools.akb_chat_mcp import AkbClient  # noqa: E402


DEFAULT_MANIFEST = ROOT / "contracts/stratos/official-sources/czech-law-pilot.v2.json"
HARD_WARNING_CODES = {
    "EVIDENCE_VERIFIER_UNAVAILABLE",
    "RERANKER_UNAVAILABLE",
    "LLM_GATEWAY_UNAVAILABLE",
    "SOURCE_AUTHORITY_UNAVAILABLE",
}
TECHNICAL_ID = re.compile(r"\b(?:chunk|doc|ver)_[a-f0-9]{8,}\b", re.IGNORECASE)
EVIDENCE_POLARITY_TOKENS = {
    "ne",
    "neni",
    "nejsou",
    "nesmi",
    "nesmeji",
    "nemusi",
    "nikdy",
    "nelze",
    "nikoli",
    "nikoliv",
    "bez",
}
_PERIOD_SENTINEL = "\uf000"
_LEGAL_ABBREVIATION = re.compile(
    r"\b(?:č|sb|odst|písm|čl|např|tj|tzn|resp|popř|str|čj|sp|zn|tzv|apod|atd)\.",
    re.IGNORECASE,
)


class LockedCredentials:
    """Serialize refresh-token rotation while allowing concurrent API calls."""

    def __init__(self, delegate: Any) -> None:
        self._delegate = delegate
        self._lock = threading.Lock()

    def token(self, *, minimum_validity_seconds: float = 30.0) -> str:
        with self._lock:
            return self._delegate.token(
                minimum_validity_seconds=minimum_validity_seconds
            )


def _args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Evaluate 100 two-turn Czech-law scenarios (200 human-style questions)."
    )
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--concurrency", type=int, default=3)
    parser.add_argument("--timeout-seconds", type=float, default=420.0)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--resume", action="store_true")
    return parser.parse_args()


def _manifest(path: Path) -> tuple[str, list[dict[str, Any]]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("collectionId") != "czech-law" or payload.get("revision") != "2":
        raise ValueError("The evaluator requires immutable czech-law revision 2")
    sources = payload.get("sources")
    if not isinstance(sources, list) or len(sources) != 100:
        raise ValueError("The czech-law revision-2 manifest must contain exactly 100 sources")
    return f"sha256:{hashlib.sha256(path.read_bytes()).hexdigest()}", sources


def _normalized(value: str) -> str:
    return " ".join(value.casefold().split())


def _evidence_tokens(value: str) -> Counter[str]:
    # PDF text extraction may place a soft hyphen at the end of a rendered
    # line.  Remove the marker together with the following layout whitespace
    # so that a word such as ``záko\u00ad\n\nnem`` remains ``zákonem``.
    value = re.sub(r"\u00ad\s*", "", value)
    normalized = unicodedata.normalize("NFKD", value.casefold())
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    return Counter(re.findall(r"[a-z0-9]+", normalized))


def _quote_reappears_in_source(quote: str, source: str) -> bool:
    quote_tokens = _evidence_tokens(quote)
    source_tokens = _evidence_tokens(source)
    if not quote_tokens:
        return False
    matched = sum((quote_tokens & source_tokens).values())
    # The authorized citation viewer intentionally normalizes the stored
    # retrieval chunk for display and can omit one PDF layout token.  The RAG
    # service has already required the verifier quote to be an exact substring
    # of the immutable authorized chunk.  This independent reopening check
    # therefore allows only a small display-normalization loss, while numbers
    # and polarity markers must still survive exactly.
    quote_critical = {
        token
        for token in quote_tokens
        if token.isdigit() or token in EVIDENCE_POLARITY_TOKENS
    }
    source_critical = {
        token
        for token in source_tokens
        if token.isdigit() or token in EVIDENCE_POLARITY_TOKENS
    }
    return (
        matched / sum(quote_tokens.values()) >= 0.90
        and quote_critical <= source_critical
    )


def _percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, round((len(ordered) - 1) * fraction)))
    return round(ordered[index], 1)


def _visible_answer_statements(answer: str) -> set[str]:
    """Mirror the RAG claim boundaries without treating substrings as claims."""
    statements: set[str] = set()
    for raw_line in answer.splitlines() or [answer]:
        line = raw_line.strip()
        if not line:
            continue
        protected = _LEGAL_ABBREVIATION.sub(
            lambda match: match.group(0).replace(".", _PERIOD_SENTINEL),
            line,
        )
        protected = re.sub(r"(?<=\d)\.(?=\s+\d)", _PERIOD_SENTINEL, protected)
        protected = re.sub(
            r"\b(?:[A-Za-zÁ-Žá-ž]\.){2,}",
            lambda match: match.group(0).replace(".", _PERIOD_SENTINEL),
            protected,
        )
        for part in re.split(r"(?<=[.!?])\s+", protected):
            statement = _normalized(part.replace(_PERIOD_SENTINEL, "."))
            if statement:
                statements.add(statement)
    return statements


def _response(chat: dict[str, Any]) -> dict[str, Any]:
    data = chat.get("data")
    response = data.get("response") if isinstance(data, dict) else None
    return response if isinstance(response, dict) else {}


def _citation_id(value: Any) -> str | None:
    if not isinstance(value, dict):
        return None
    chunk_id = value.get("chunk_id") or value.get("chunkId")
    return chunk_id if isinstance(chunk_id, str) and chunk_id else None


def _citation_pair(value: Any) -> tuple[str, str] | None:
    if not isinstance(value, dict):
        return None
    document_id = value.get("document_id") or value.get("documentId")
    version_id = value.get("document_version_id") or value.get("documentVersionId")
    if isinstance(document_id, str) and isinstance(version_id, str):
        return document_id, version_id
    return None


def _citation_title(value: Any) -> str:
    if not isinstance(value, dict):
        return ""
    title = value.get("document_title") or value.get("documentTitle")
    return title if isinstance(title, str) else ""


def _source_context(check: dict[str, Any]) -> dict[str, Any]:
    data = check.get("data")
    context = data.get("source_context") if isinstance(data, dict) else None
    return context if isinstance(context, dict) else {}


def _reopened_source_text(check: dict[str, Any]) -> str:
    """Return the complete reauthorized viewer window for one citation."""
    context = _source_context(check)
    return "\n\n".join(
        value
        for key in ("before_text", "chunk_text", "after_text")
        if isinstance((value := context.get(key)), str) and value.strip()
    )


def _source_scope_hash(response: dict[str, Any]) -> str | None:
    current = response.get("current_context")
    frame = current.get("evidence_frame") if isinstance(current, dict) else None
    value = frame.get("source_scope_hash") if isinstance(frame, dict) else None
    return value if isinstance(value, str) and value else None


def _claim_content_checks(
    response: dict[str, Any], citation_checks: dict[str, dict[str, Any]]
) -> tuple[list[str], int, int]:
    failures: list[str] = []
    claims = [item for item in response.get("claims", []) if isinstance(item, dict)]
    supported = [item for item in claims if item.get("supported") is True]
    answer = response.get("answer") if isinstance(response.get("answer"), str) else ""
    normalized_answer = _normalized(answer)
    visible_statements = _visible_answer_statements(answer)
    if response.get("response_type") == "answer" and len(normalized_answer) < 60:
        failures.append("ANSWER_TOO_SHORT")
    if TECHNICAL_ID.search(answer):
        failures.append("TECHNICAL_ID_EXPOSED")
    if not supported:
        failures.append("NO_SUPPORTED_CLAIM")
    for claim in claims:
        text = claim.get("claim") if isinstance(claim.get("claim"), str) else ""
        visible = bool(text) and _normalized(text) in visible_statements
        if claim.get("supported") is True and not visible:
            failures.append("SUPPORTED_CLAIM_MISSING_FROM_ANSWER")
        if claim.get("supported") is not True and visible:
            failures.append("UNSUPPORTED_CLAIM_VISIBLE")
    for claim in supported:
        chunk_ids = claim.get("chunk_ids")
        quote = claim.get("quoted_support")
        if not isinstance(chunk_ids, list) or not chunk_ids or not isinstance(quote, str) or not quote:
            failures.append("SUPPORTED_CLAIM_RECEIPT_INCOMPLETE")
            continue
        quote_parts = [part for part in quote.split("\n\n") if part.strip()]
        for chunk_id in chunk_ids:
            check = citation_checks.get(str(chunk_id), {})
            if not check.get("ok"):
                failures.append("CLAIM_CITATION_NOT_REAUTHORIZED")
                continue
            source_text = _reopened_source_text(check)
            if not source_text or not any(
                _quote_reappears_in_source(part, source_text) for part in quote_parts
            ):
                failures.append("CLAIM_QUOTE_NOT_IN_REOPENED_SOURCE")
    return sorted(set(failures)), len(supported), len(claims)


def _turn_report(
    *,
    chat: dict[str, Any],
    citation_checks: dict[str, dict[str, Any]],
    law_reference: str,
) -> dict[str, Any]:
    response = _response(chat)
    citations = [item for item in response.get("citations", []) if isinstance(item, dict)]
    warnings = sorted({item for item in response.get("warnings", []) if isinstance(item, str)})
    failures: list[str] = []
    if not chat.get("ok") or chat.get("status") != 200:
        failures.append("CHAT_REQUEST_FAILED")
    if response.get("response_type") != "answer":
        failures.append("ANSWER_NOT_RETURNED")
    if not citations:
        failures.append("CITATION_REQUIRED")
    if not any(law_reference in _citation_title(citation) for citation in citations):
        failures.append("EXPECTED_LAW_NOT_CITED")
    if any(not check.get("ok") for check in citation_checks.values()):
        failures.append("CITATION_REAUTHORIZATION_FAILED")
    failures.extend(code for code in HARD_WARNING_CODES if code in warnings)
    content_failures, supported_count, claim_count = _claim_content_checks(
        response, citation_checks
    )
    failures.extend(content_failures)
    usage = response.get("llm_usage") if isinstance(response.get("llm_usage"), dict) else {}
    cost = usage.get("estimated_cost_usd")
    return {
        "passed": not failures,
        "status": chat.get("status"),
        "response_type": response.get("response_type"),
        "confidence": response.get("confidence"),
        "evidence_status": response.get("evidence_status"),
        "verification_model": response.get("verification_model"),
        "citation_count": len(citations),
        "citation_open_count": sum(bool(check.get("ok")) for check in citation_checks.values()),
        "claim_count": claim_count,
        "supported_claim_count": supported_count,
        "warnings": warnings,
        "failures": sorted(set(failures)),
        "latency_ms": float(chat.get("latency_ms") or 0),
        "total_tokens": int(usage.get("total_tokens") or 0),
        "estimated_cost_usd": float(cost) if isinstance(cost, (int, float)) else None,
        "citation_pairs": sorted(
            {pair for citation in citations if (pair := _citation_pair(citation)) is not None}
        ),
        "message_id": response.get("message_id"),
        "conversation_id": response.get("conversation_id"),
        "source_scope_hash": _source_scope_hash(response),
    }


async def _request(
    client: AkbClient, method: str, path: str, body: dict[str, Any] | None = None
) -> dict[str, Any]:
    return await asyncio.to_thread(client.request, method, path, body)


async def _citation_checks(
    client: AkbClient, citations: list[Any]
) -> dict[str, dict[str, Any]]:
    chunk_ids = sorted({value for item in citations if (value := _citation_id(item))})
    results = await asyncio.gather(
        *(_request(client, "GET", f"/api/assistant/citations/{chunk_id}/open") for chunk_id in chunk_ids),
        return_exceptions=True,
    )
    return {
        chunk_id: result if isinstance(result, dict) else {"ok": False, "status": None}
        for chunk_id, result in zip(chunk_ids, results, strict=True)
    }


def _chat_body(message: str, **extra: Any) -> dict[str, Any]:
    return {
        "message": message,
        "response_language": "cs",
        "context": {
            "assistant_query_plan": {
                "version": "2026-09-19",
                "tool": "rag_document_answer",
                "quality_gates": {"citations_required": True},
                "retrieval": {"knowledge_scope": "governed_sources"},
            }
        },
        **extra,
    }


async def _scenario(
    client: AkbClient, semaphore: asyncio.Semaphore, source: dict[str, Any]
) -> dict[str, Any]:
    async with semaphore:
        year = str(source["year"])
        number = str(source["number"])
        title = str(source["title"])
        law_reference = f"{number}/{year} Sb."
        case_id = f"cz-law-{year}-{number}"
        started = time.monotonic()
        initial = await _request(
            client,
            "POST",
            "/api/assistant/chat",
            _chat_body(
                f"Vysvětli běžnému zaměstnanci hlavní účel a oblast úpravy předpisu {title}. "
                "Uveď jen to, co lze doložit jeho aktuální verzí."
            ),
        )
        initial_response = _response(initial)
        initial_citations = initial_response.get("citations", [])
        initial_checks = await _citation_checks(
            client, initial_citations if isinstance(initial_citations, list) else []
        )
        initial_report = _turn_report(
            chat=initial, citation_checks=initial_checks, law_reference=law_reference
        )
        conversation_id = initial_report.pop("conversation_id", None)
        parent_message_id = initial_report.pop("message_id", None)
        source_scope_hash = initial_report.pop("source_scope_hash", None)
        lineage_ready = all(
            isinstance(value, str) and value
            for value in (conversation_id, parent_message_id, source_scope_hash)
        )
        if lineage_ready:
            follow_up = await _request(
                client,
                "POST",
                "/api/assistant/chat",
                _chat_body(
                    "Jaké konkrétní povinnosti, práva nebo praktické dopady z tohoto předpisu "
                    "vyplývají pro běžnou praxi?",
                    conversation_id=conversation_id,
                    parent_message_id=parent_message_id,
                    source_bound=True,
                    source_scope_hash=source_scope_hash,
                    turn_origin="suggested_follow_up",
                ),
            )
            follow_response = _response(follow_up)
            follow_citations = follow_response.get("citations", [])
            follow_checks = await _citation_checks(
                client, follow_citations if isinstance(follow_citations, list) else []
            )
            follow_report = _turn_report(
                chat=follow_up, citation_checks=follow_checks, law_reference=law_reference
            )
            follow_report.pop("conversation_id", None)
            follow_report.pop("message_id", None)
            follow_report.pop("source_scope_hash", None)
        else:
            follow_report = {
                "passed": False,
                "status": None,
                "response_type": None,
                "confidence": None,
                "evidence_status": None,
                "verification_model": None,
                "citation_count": 0,
                "citation_open_count": 0,
                "claim_count": 0,
                "supported_claim_count": 0,
                "warnings": [],
                "failures": ["LINEAGE_CONTEXT_MISSING"],
                "latency_ms": 0.0,
                "total_tokens": 0,
                "estimated_cost_usd": None,
                "citation_pairs": [],
            }
        initial_pairs = {tuple(item) for item in initial_report["citation_pairs"]}
        follow_pairs = {tuple(item) for item in follow_report["citation_pairs"]}
        lineage_preserved = bool(initial_pairs and follow_pairs and follow_pairs <= initial_pairs)
        if not lineage_preserved:
            follow_report["failures"] = sorted(
                set([*follow_report["failures"], "SOURCE_LINEAGE_NOT_PRESERVED"])
            )
            follow_report["passed"] = False
        return {
            "case_id": case_id,
            "law_reference": law_reference,
            "initial": initial_report,
            "follow_up": follow_report,
            "lineage_ready": lineage_ready,
            "lineage_preserved": lineage_preserved,
            "passed": bool(initial_report["passed"] and follow_report["passed"]),
            "elapsed_ms": round((time.monotonic() - started) * 1000, 1),
        }


def _summary(results: list[dict[str, Any]]) -> dict[str, Any]:
    turns = [turn for result in results for turn in (result["initial"], result["follow_up"])]
    failures = Counter(code for turn in turns for code in turn["failures"])
    warnings = Counter(code for turn in turns for code in turn["warnings"])
    latencies = [float(turn["latency_ms"]) for turn in turns if turn["latency_ms"]]
    costs = [turn["estimated_cost_usd"] for turn in turns if turn["estimated_cost_usd"] is not None]
    claim_count = sum(int(turn["claim_count"]) for turn in turns)
    supported_count = sum(int(turn["supported_claim_count"]) for turn in turns)
    return {
        "scenario_count": len(results),
        "turn_count": len(turns),
        "passed_scenarios": sum(bool(result["passed"]) for result in results),
        "passed_turns": sum(bool(turn["passed"]) for turn in turns),
        "lineage_preserved_scenarios": sum(bool(result["lineage_preserved"]) for result in results),
        "supported_claim_rate": round(supported_count / claim_count, 6) if claim_count else 0.0,
        "full_evidence_turns": sum(turn["evidence_status"] == "supported" for turn in turns),
        "partial_evidence_turns": sum(turn["evidence_status"] == "partial" for turn in turns),
        "unsupported_evidence_turns": sum(turn["evidence_status"] == "unsupported" for turn in turns),
        "latency_ms": {
            "mean": round(statistics.fmean(latencies), 1) if latencies else 0.0,
            "p50": _percentile(latencies, 0.50),
            "p95": _percentile(latencies, 0.95),
            "max": round(max(latencies), 1) if latencies else 0.0,
        },
        "total_tokens": sum(int(turn["total_tokens"]) for turn in turns),
        "estimated_cost_usd": round(sum(costs), 6) if costs else None,
        "failure_counts": dict(sorted(failures.items())),
        "warning_counts": dict(sorted(warnings.items())),
    }


def _write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def _completed_results(existing: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Resume only successful cases; transient and quality failures are retried."""
    return {
        item["case_id"]: item
        for item in existing.get("results", [])
        if (
            isinstance(item, dict)
            and isinstance(item.get("case_id"), str)
            and item.get("passed") is True
        )
    }


async def _main(args: argparse.Namespace) -> int:
    if not 1 <= args.concurrency <= 8:
        raise ValueError("concurrency must be between 1 and 8")
    if args.limit is not None and not 1 <= args.limit <= 100:
        raise ValueError("limit must be between 1 and 100")
    digest, sources = _manifest(args.manifest)
    if args.limit is not None:
        sources = sources[: args.limit]
    existing: dict[str, Any] = {}
    if args.resume and args.output.exists():
        existing = json.loads(args.output.read_text(encoding="utf-8"))
        if existing.get("manifest_sha256") != digest:
            raise ValueError("Cannot resume against a different manifest")
    completed = _completed_results(existing)
    client = AkbClient()
    client.timeout = min(600.0, max(2.0, float(args.timeout_seconds)))
    client.credentials.token()  # Prime refresh before concurrent work.
    client.credentials = LockedCredentials(client.credentials)
    semaphore = asyncio.Semaphore(args.concurrency)
    pending = [
        asyncio.create_task(_scenario(client, semaphore, source))
        for source in sources
        if f"cz-law-{source['year']}-{source['number']}" not in completed
    ]
    started_at = existing.get("started_at") or datetime.now(timezone.utc).isoformat()
    for task in asyncio.as_completed(pending):
        try:
            result = await task
        except Exception as exc:  # Keep the batch resumable without storing content.
            result = {
                "case_id": f"runtime-error-{len(completed) + 1}",
                "law_reference": "unknown",
                "passed": False,
                "lineage_ready": False,
                "lineage_preserved": False,
                "elapsed_ms": 0.0,
                "initial": {"passed": False, "failures": [exc.__class__.__name__], "warnings": [],
                            "latency_ms": 0, "claim_count": 0, "supported_claim_count": 0,
                            "evidence_status": None, "total_tokens": 0, "estimated_cost_usd": None},
                "follow_up": {"passed": False, "failures": ["NOT_RUN"], "warnings": [],
                              "latency_ms": 0, "claim_count": 0, "supported_claim_count": 0,
                              "evidence_status": None, "total_tokens": 0, "estimated_cost_usd": None},
            }
        completed[result["case_id"]] = result
        ordered = sorted(completed.values(), key=lambda item: item["case_id"])
        payload = {
            "schema_version": "1.0.0",
            "evaluation": "akb-human-questions-czech-law-v2",
            "manifest_sha256": digest,
            "started_at": started_at,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "complete": len(ordered) == len(sources),
            "configuration": {
                "requested_scenarios": len(sources),
                "requested_turns": len(sources) * 2,
                "concurrency": args.concurrency,
                "prompts_answers_sources_stored": False,
            },
            "summary": _summary(ordered),
            "results": ordered,
        }
        _write(args.output, payload)
        summary = payload["summary"]
        print(
            f"completed={len(ordered)}/{len(sources)} turns={summary['turn_count']} "
            f"passed_turns={summary['passed_turns']} cost_usd={summary['estimated_cost_usd']}",
            flush=True,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main(_args())))
