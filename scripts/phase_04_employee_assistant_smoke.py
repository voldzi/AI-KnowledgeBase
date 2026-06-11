#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any


RAG_URL = os.getenv("AKL_SMOKE_RAG_URL", "http://localhost:8082").rstrip("/")
WEB_URL = os.getenv("AKL_SMOKE_WEB_URL", "http://localhost:3002").rstrip("/")
SUBJECT_ID = os.getenv("AKL_SMOKE_SUBJECT_ID", "user_dev")
ROLES = os.getenv("AKL_SMOKE_ROLES", "admin,document_manager,reader")


def main() -> int:
    print("Phase 04 employee assistant smoke test")
    check_health()
    suggestions = check_assistant_suggestions()
    english_suggestions = check_english_assistant_suggestions()
    clarification = check_clarification_flow()
    english_clarification = check_english_clarification_flow()
    answer = check_employee_answer_with_citation(clarification["conversation_id"])
    check_web_assistant_route()
    check_web_assistant_api()

    print("OK suggestions=", len(suggestions["suggestions"]))
    print("OK english_suggestions=", len(english_suggestions["suggestions"]))
    print("OK clarification_questions=", len(clarification["questions"]))
    print("OK english_clarification_questions=", len(english_clarification["questions"]))
    print("OK response_type=", answer["response_type"])
    print("OK cited_chunk_id=", answer["citations"][0]["chunk_id"])
    print("OK web_assistant=", WEB_URL + "/assistant")
    return 0


def check_health() -> None:
    for endpoint in (f"{RAG_URL}/health", f"{WEB_URL}/api/health"):
        body = request_json("GET", endpoint)
        if body.get("status") != "ok":
            raise RuntimeError(f"Healthcheck failed for {endpoint}: {body}")
    print("OK healthchecks")


def check_assistant_suggestions() -> dict[str, Any]:
    body = request_json("GET", f"{RAG_URL}/api/v1/assistant/suggestions")
    suggestions = body.get("suggestions") or []
    if len(suggestions) < 1:
        raise RuntimeError(f"Assistant suggestions are empty: {body}")
    return body


def check_english_assistant_suggestions() -> dict[str, Any]:
    body = request_json("GET", f"{RAG_URL}/api/v1/assistant/suggestions?response_language=en")
    suggestions = body.get("suggestions") or []
    if len(suggestions) < 1:
        raise RuntimeError(f"English assistant suggestions are empty: {body}")
    if any("platform architecture" in str(suggestion.get("prompt", "")).lower() for suggestion in suggestions):
        raise RuntimeError(f"English assistant suggestions still contain a legacy platform architecture prompt: {body}")
    return body


def check_clarification_flow() -> dict[str, Any]:
    body = request_json(
        "POST",
        f"{RAG_URL}/api/v1/assistant/chat",
        {
            "user_id": SUBJECT_ID,
            "message": "Potřebuji přístup.",
            "context": {"domain": "IT", "user_role": "employee"},
        },
    )
    if body.get("response_type") != "clarification_needed":
        raise RuntimeError(f"Expected clarification_needed, got: {body}")
    question_ids = {question.get("id") for question in body.get("questions", [])}
    if not {"system", "request_type"}.issubset(question_ids):
        raise RuntimeError(f"Clarification questions do not include system/request_type: {body}")
    return body


def check_english_clarification_flow() -> dict[str, Any]:
    body = request_json(
        "POST",
        f"{RAG_URL}/api/v1/assistant/chat",
        {
            "user_id": SUBJECT_ID,
            "message": "I need access.",
            "context": {"domain": "IT", "user_role": "employee"},
            "response_language": "en",
        },
    )
    if body.get("response_type") != "clarification_needed":
        raise RuntimeError(f"Expected English clarification_needed, got: {body}")
    if body.get("message") != "I need to clarify the question.":
        raise RuntimeError(f"Expected English clarification message, got: {body}")
    questions = body.get("questions", [])
    if not any(question.get("question") == "Which system is this about?" for question in questions):
        raise RuntimeError(f"English clarification questions are not localized: {body}")
    return body


def check_employee_answer_with_citation(conversation_id: str) -> dict[str, Any]:
    body = request_json(
        "POST",
        f"{RAG_URL}/api/v1/assistant/clarify",
        {
            "user_id": SUBJECT_ID,
            "conversation_id": conversation_id,
            "message": "Jaké povinnosti platí pro informační systémy veřejné správy?",
            "context": {
                "system": "ISVS",
                "request_type": "informace",
                "user_role": "employee",
            },
        },
    )
    if body.get("response_type") != "answer":
        raise RuntimeError(f"Expected answer from assistant, got: {body}")
    if not body.get("citations"):
        raise RuntimeError(f"Assistant answer has no citations: {body}")
    return body


def check_web_assistant_route() -> None:
    html = request_text("GET", f"{WEB_URL}/assistant")
    if "Znalostní asistent STRATOS" not in html and "STRATOS knowledge assistant" not in html:
        raise RuntimeError("Web assistant route did not render the employee assistant shell")


def check_web_assistant_api() -> None:
    suggestions = request_json("GET", f"{WEB_URL}/api/assistant/suggestions?language=en")
    if not suggestions.get("suggestions"):
        raise RuntimeError(f"Web assistant suggestions are empty: {suggestions}")
    if any("platform architecture" in str(suggestion.get("prompt", "")).lower() for suggestion in suggestions["suggestions"]):
        raise RuntimeError(f"Web assistant suggestions still contain a legacy platform architecture prompt: {suggestions}")
    body = request_json(
        "POST",
        f"{WEB_URL}/api/assistant/chat",
        {
            "message": "I need access.",
            "context": {},
            "response_language": "en",
        },
    )
    response = body.get("response") or {}
    if response.get("response_type") != "clarification_needed":
        raise RuntimeError(f"Web assistant chat did not request clarification: {body}")
    if response.get("message") != "I need to clarify the question.":
        raise RuntimeError(f"Web assistant chat did not return an English clarification: {body}")


def request_json(
    method: str,
    url: str,
    payload: dict[str, Any] | None = None,
    *,
    expected_status: int = 200,
) -> dict[str, Any]:
    raw, status = request_raw(method, url, payload)
    body = json.loads(raw) if raw else {}
    if status != expected_status:
        raise RuntimeError(f"{method} {url} returned HTTP {status}, expected {expected_status}: {body}")
    return body


def request_text(method: str, url: str, payload: dict[str, Any] | None = None, *, expected_status: int = 200) -> str:
    raw, status = request_raw(method, url, payload)
    if status != expected_status:
        raise RuntimeError(f"{method} {url} returned HTTP {status}, expected {expected_status}: {raw[:500]}")
    return raw


def request_raw(method: str, url: str, payload: dict[str, Any] | None = None) -> tuple[str, int]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Accept": "application/json,text/html",
            "Content-Type": "application/json",
            "X-Request-ID": "phase04-employee-assistant-smoke",
            "X-Correlation-ID": "phase04-employee-assistant-smoke",
            "X-AKL-Subject": SUBJECT_ID,
            "X-AKL-Roles": ROLES,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            return response.read().decode("utf-8"), response.status
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        raise RuntimeError(f"{method} {url} failed with HTTP {exc.code}: {raw}") from exc


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"FAILED: {exc}", file=sys.stderr)
        raise SystemExit(1)
