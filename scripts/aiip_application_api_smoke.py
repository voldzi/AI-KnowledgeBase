#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


def request_json(url: str, *, data: bytes, headers: dict[str, str], timeout: float) -> tuple[int, dict[str, str], dict[str, Any]]:
    request = urllib.request.Request(url, data=data, headers=headers)
    try:
        response = urllib.request.urlopen(request, timeout=timeout)
        return response.status, dict(response.headers), json.load(response)
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), json.load(exc)


def main() -> int:
    parser = argparse.ArgumentParser(description="Safe production smoke for the AKB AIIP application contract.")
    parser.add_argument("--base-url", default="https://stratos.zeleznalady.cz/akb/api/integrations/aiip/v1")
    parser.add_argument("--token-url", default="https://login.zeleznalady.cz/realms/stratos/protocol/openid-connect/token")
    parser.add_argument("--secret-file", default="/srv/akl/env/aiip-service.client-secret")
    parser.add_argument("--fixtures", default="docs/integration/fixtures/aiip-application-api")
    parser.add_argument("--timeout", type=float, default=75.0)
    args = parser.parse_args()

    secret = Path(args.secret_file).read_text(encoding="utf-8").strip()
    token_body = urllib.parse.urlencode(
        {"grant_type": "client_credentials", "client_id": "aiip-service", "client_secret": secret}
    ).encode()
    token = json.load(urllib.request.urlopen(urllib.request.Request(args.token_url, data=token_body), timeout=15))["access_token"]
    prefix = f"prod-aiip-{int(time.time())}"

    def call(path: str, body: dict[str, Any], key: str, request_id: str):
        return request_json(
            f"{args.base_url}{path}",
            data=json.dumps(body, separators=(",", ":"), ensure_ascii=True).encode(),
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "X-Request-ID": request_id,
                "X-Correlation-ID": f"corr-{request_id}",
                "Idempotency-Key": key,
            },
            timeout=args.timeout,
        )

    fixture_root = Path(args.fixtures)
    harmonize = json.loads((fixture_root / "harmonize.request.json").read_text(encoding="utf-8"))
    harmonize_key = f"{prefix}-harmonize"
    status, _, body = call("/harmonize", harmonize, harmonize_key, f"req-{prefix}-harmonize")
    first_body = body
    checks = [{
        "check": "harmonize", "status": status,
        "suggestions": len(body.get("result", {}).get("suggestions", [])),
        "requested_model": body.get("model", {}).get("requested_model"),
        "actual_model": body.get("model", {}).get("actual_model"),
        "fallback": body.get("model", {}).get("fallback_applied"),
        "audit": bool(body.get("audit_event_id")),
        "total_tokens": body.get("usage", {}).get("total_tokens"),
        "error": body.get("error", {}).get("code"),
    }]
    status, headers, body = call("/harmonize", harmonize, harmonize_key, f"req-{prefix}-harmonize")
    checks.append({
        "check": "replay", "status": status,
        "replayed": headers.get("Idempotency-Replayed"), "identical": body == first_body,
        "error": body.get("error", {}).get("code"),
    })
    conflict = dict(harmonize)
    conflict["locale"] = "en"
    status, _, body = call("/harmonize", conflict, harmonize_key, f"req-{prefix}-conflict")
    checks.append({"check": "conflict", "status": status, "error": body.get("error", {}).get("code")})
    restricted = dict(harmonize)
    restricted["classification"] = "restricted"
    status, _, body = call("/harmonize", restricted, f"{prefix}-restricted", f"req-{prefix}-restricted")
    checks.append({
        "check": "classification", "status": status,
        "error": body.get("error", {}).get("code"), "audit": body.get("error", {}).get("audit_event_id"),
    })
    duplicates = json.loads((fixture_root / "duplicates.request.json").read_text(encoding="utf-8"))
    status, _, body = call("/duplicates/search", duplicates, f"{prefix}-duplicates", f"req-{prefix}-duplicates")
    candidates = body.get("result", {}).get("candidates", [])
    checks.append({
        "check": "duplicates", "status": status, "candidates": len(candidates),
        "citations": sum(len(candidate.get("citations", [])) for candidate in candidates),
        "index_version": body.get("retrieval_index_version"),
        "audit": bool(body.get("audit_event_id")), "error": body.get("error", {}).get("code"),
    })
    for check in checks:
        print(json.dumps(check, sort_keys=True))
    expected = {
        "harmonize": (200, None), "replay": (200, None),
        "conflict": (409, "IDEMPOTENCY_KEY_REUSED"),
        "classification": (403, "CLASSIFICATION_NOT_ALLOWED"), "duplicates": (200, None),
    }
    valid = all((check["status"], check.get("error")) == expected[check["check"]] for check in checks)
    valid = valid and checks[0]["audit"] and checks[1]["identical"] and checks[1]["replayed"] == "true"
    valid = valid and checks[3]["audit"] is None and checks[4]["audit"]
    return 0 if valid else 1


if __name__ == "__main__":
    raise SystemExit(main())
