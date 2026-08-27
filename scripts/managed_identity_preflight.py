#!/usr/bin/env python3
"""Prepare disabled managed clients and optionally check public discovery. No writes."""
from __future__ import annotations

import argparse
import json
import re
import ssl
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("DISCOVERY_REDIRECT_DENIED")


def https_url(value: str) -> str:
    url = urlsplit(value)
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment or "*" in value or "\\" in value or re.search(r"[\s\x00-\x1f\x7f]", value):
        raise ValueError("EXACT_HTTPS_URL_REQUIRED")
    return value.rstrip("/")


def prepare(issuer: str, approved_issuer: str, web_base: str, chat_base: str) -> dict:
    if issuer != approved_issuer or https_url(issuer) != issuer:
        raise ValueError("EXPLICIT_ISSUER_APPROVAL_REQUIRED")
    web, chat = https_url(web_base), https_url(chat_base)
    if urlsplit(web).netloc == urlsplit(chat).netloc:
        raise ValueError("STANDALONE_CHAT_REQUIRES_A_SEPARATE_ORIGIN")
    clients = []
    for client_id, label, base in (("akl-web", "AKB", web), ("akb-chat-web", "AKB Chat", chat)):
        clients.append({
            "clientId": client_id, "label": label, "kind": "browser", "audience": "akl-api",
            "scopes": ["openid", "profile", "email"], "redirectUris": [base + "/api/auth/callback"],
            "postLogoutUris": [base], "enabled": False, "reason": "AKB managed identity joint preflight",
        })
    for domain in ("budget", "projectflow", "archflow"):
        clients.append({
            "clientId": "svc-akb-director-copilot-" + domain, "label": "AKB Director " + domain,
            "kind": "service", "audience": domain + "-api", "scopes": ["director-copilot:read"],
            "redirectUris": [], "postLogoutUris": [], "enabled": False, "reason": "AKB managed identity joint preflight",
        })
    clients.append({
        "clientId": "svc-budget-controlled-rules", "label": "Budget controlled rules", "kind": "service",
        "audience": "akl-api", "scopes": ["controlled-rules-read"], "redirectUris": [], "postLogoutUris": [],
        "enabled": False, "reason": "AKB managed identity joint preflight",
    })
    return {
        "mode": "proposal_only", "issuer": issuer, "clients": clients,
        "browser_protocol": {"grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"], "token_endpoint_auth_method": "none", "code_challenge_method": "S256"},
        "service_protocol": {"grant_types": ["client_credentials"], "token_endpoint_auth_method": "client_secret_post"},
        "activation": "BLOCKED_PENDING_JOINT_PREFLIGHT_AND_WORKER_IDENTITY_CONTRACT",
    }


def validate_discovery(issuer: str, body: object) -> None:
    if not isinstance(body, dict) or body.get("issuer") != issuer:
        raise ValueError("DISCOVERY_ISSUER_INVALID")
    for field, values in {
        "code_challenge_methods_supported": ["S256"], "response_types_supported": ["code"],
        "id_token_signing_alg_values_supported": ["RS256"],
        "token_endpoint_auth_methods_supported": ["none", "client_secret_post"],
        "grant_types_supported": ["authorization_code", "refresh_token", "client_credentials"],
    }.items():
        if not isinstance(body.get(field), list) or any(value not in body[field] for value in values):
            raise ValueError("DISCOVERY_CAPABILITY_MISSING")
    base = urlsplit(issuer)
    for field in ("authorization_endpoint", "token_endpoint", "jwks_uri", "userinfo_endpoint", "revocation_endpoint", "end_session_endpoint"):
        endpoint = body.get(field)
        if not isinstance(endpoint, str):
            raise ValueError("DISCOVERY_ENDPOINT_INVALID")
        target = urlsplit(https_url(endpoint))
        if target.netloc != base.netloc or not target.path.startswith(base.path + "/"):
            raise ValueError("DISCOVERY_ENDPOINT_INVALID")


def read_discovery(issuer: str, ca_file: str | None = None) -> dict:
    context = ssl.create_default_context(cafile=ca_file)
    opener = build_opener(NoRedirect(), HTTPSHandler(context=context))
    request = Request(issuer + "/.well-known/openid-configuration", headers={"Accept": "application/json"})
    with opener.open(request, timeout=5) as response:
        if response.status != 200:
            raise ValueError("DISCOVERY_HTTP_ERROR")
        raw = response.read(65_537)
    if len(raw) > 65_536:
        raise ValueError("DISCOVERY_TOO_LARGE")
    body = json.loads(raw)
    validate_discovery(issuer, body)
    return {"status": "passed", "http_status": 200, "tls_verified": True, "redirects_allowed": False}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--issuer", required=True)
    parser.add_argument("--approved-issuer", required=True)
    parser.add_argument("--web-base", required=True)
    parser.add_argument("--chat-base", required=True)
    parser.add_argument("--check-discovery", action="store_true", help="Perform one public, TLS-verified GET; no credentials or configuration writes")
    parser.add_argument("--ca-file", help="Approved CA bundle outside Git; never disable certificate validation")
    args = parser.parse_args()
    try:
        result = prepare(args.issuer, args.approved_issuer, args.web_base, args.chat_base)
        result["discovery"] = read_discovery(args.issuer, args.ca_file) if args.check_discovery else {"status": "not_run"}
    except Exception:
        print(json.dumps({"status": "failed", "reason_code": "MANAGED_PREFLIGHT_INPUT_OR_DISCOVERY_INVALID"}))
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
