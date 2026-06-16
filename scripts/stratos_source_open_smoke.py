#!/usr/bin/env python3
"""Smoke test for STRATOS source-open through the AKB web bridge.

The script intentionally never prints bearer tokens or signed download URLs.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


def main() -> int:
    preload_parser = argparse.ArgumentParser(add_help=False)
    preload_parser.add_argument("--env-file", action="append", default=[])
    preload_args, _remaining_args = preload_parser.parse_known_args()
    for env_file in preload_args.env_file:
        load_env_file(env_file)

    parser = argparse.ArgumentParser(description="Verify AKB STRATOS source-open and PDF download.")
    parser.add_argument(
        "--env-file",
        action="append",
        default=preload_args.env_file,
        help="Optional dotenv file to load before reading smoke configuration. May be passed more than once.",
    )
    parser.add_argument("--document-id", default=os.getenv("AKB_SMOKE_DOCUMENT_ID"), help="AKB document id.")
    parser.add_argument(
        "--version-id",
        default=os.getenv("AKB_SMOKE_DOCUMENT_VERSION_ID"),
        help="AKB document version id.",
    )
    parser.add_argument(
        "--web-base-url",
        default=os.getenv("BUDGET_AKB_WEB_BASE_URL") or os.getenv("AKB_WEB_BASE_URL") or "http://akl-web-1:3000/akb",
        help="AKB web base URL, including the /akb base path.",
    )
    parser.add_argument(
        "--token-url",
        default=first_env("STRATOS_AKB_OIDC_TOKEN_URL", "AKB_OIDC_TOKEN_URL"),
        help="OIDC token endpoint. Defaults to <issuer>/protocol/openid-connect/token.",
    )
    parser.add_argument(
        "--client-id",
        default=first_env("STRATOS_AKB_OIDC_CLIENT_ID", "AKB_SERVICE_CLIENT_ID") or "stratos-akb-service",
        help="OIDC confidential service client id.",
    )
    parser.add_argument(
        "--scope",
        default=first_env("STRATOS_AKB_OIDC_SCOPE", "AKB_OIDC_SCOPE"),
        help="Optional OIDC scope for the client-credentials token request.",
    )
    parser.add_argument(
        "--audience",
        default=first_env("STRATOS_AKB_OIDC_AUDIENCE", "AKB_OIDC_AUDIENCE", "AKL_OIDC_AUDIENCE"),
        help="Optional OIDC audience for the client-credentials token request.",
    )
    args = parser.parse_args()

    if not args.document_id:
        fail("Missing --document-id or AKB_SMOKE_DOCUMENT_ID.")
    if not args.version_id:
        fail("Missing --version-id or AKB_SMOKE_DOCUMENT_VERSION_ID.")

    client_secret = (
        os.getenv("STRATOS_AKB_OIDC_CLIENT_SECRET")
        or os.getenv("AKB_SERVICE_CLIENT_SECRET")
        or os.getenv("STRATOS_AKB_SERVICE_CLIENT_SECRET")
        or os.getenv("STRATOS_AKB_CLIENT_SECRET")
    )
    if not client_secret:
        fail("Missing STRATOS_AKB_OIDC_CLIENT_SECRET or AKB_SERVICE_CLIENT_SECRET.")

    token_url = args.token_url or token_url_from_issuer()
    access_token = fetch_service_token(
        token_url,
        args.client_id,
        client_secret,
        scope=args.scope,
        audience=args.audience,
    )

    web_base_url = args.web_base_url.rstrip("/")
    source_open_url = (
        f"{web_base_url}/api/stratos/documents/{urllib.parse.quote(args.document_id)}/source-open"
        f"?version_id={urllib.parse.quote(args.version_id)}"
    )
    source_open_status, source_open_headers, source_open_bytes = http_request(
        source_open_url,
        method="POST",
        headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
    )
    source_open_content_type = source_open_headers.get("content-type", "")
    if source_open_status != 201:
        fail(f"source-open returned {source_open_status}, expected 201.")
    if not source_open_content_type.startswith("application/json"):
        fail(f"source-open returned content-type {source_open_content_type!r}, expected application/json.")

    source_open_body = json.loads(source_open_bytes.decode("utf-8"))
    source_open = source_open_body.get("source_open") or {}
    if source_open.get("available") is not True:
        fail(f"source-open returned available={source_open.get('available')!r}.")
    download_url = source_open.get("download_url")
    if not isinstance(download_url, str) or not download_url:
        fail("source-open did not return source_open.download_url.")
    file_info = source_open.get("file") or {}
    if file_info.get("mime_type") != "application/pdf":
        fail(f"source-open returned MIME {file_info.get('mime_type')!r}, expected application/pdf.")

    resolved_download_url = urllib.parse.urljoin(f"{web_base_url}/", download_url)
    download_status, download_headers, download_bytes = http_request(
        resolved_download_url,
        method="GET",
        headers={"Authorization": f"Bearer {access_token}", "Accept": "application/pdf"},
    )
    download_content_type = download_headers.get("content-type", "")
    if download_status != 200:
        fail(f"download returned {download_status}, expected 200.")
    if not download_content_type.startswith("application/pdf"):
        fail(f"download returned content-type {download_content_type!r}, expected application/pdf.")
    if not download_bytes.startswith(b"%PDF"):
        fail("download response does not start with a PDF header.")

    print(
        json.dumps(
            {
                "ok": True,
                "document_id": args.document_id,
                "document_version_id": args.version_id,
                "web_base_url": web_base_url,
                "source_open_status": source_open_status,
                "download_status": download_status,
                "download_content_type": download_content_type,
                "download_url_path": urllib.parse.urlparse(resolved_download_url).path,
                "file": {
                    "filename": file_info.get("filename"),
                    "mime_type": file_info.get("mime_type"),
                },
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


def token_url_from_issuer() -> str:
    issuer = (os.getenv("AKL_WEB_OIDC_ISSUER") or os.getenv("AKL_OIDC_ISSUER") or "").rstrip("/")
    if not issuer:
        fail("Missing STRATOS_AKB_OIDC_TOKEN_URL, AKB_OIDC_TOKEN_URL, or AKL_WEB_OIDC_ISSUER.")
    return f"{issuer}/protocol/openid-connect/token"


def fetch_service_token(
    token_url: str,
    client_id: str,
    client_secret: str,
    *,
    scope: str | None,
    audience: str | None,
) -> str:
    token_request = {
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
    }
    if scope:
        token_request["scope"] = scope
    if audience:
        token_request["audience"] = audience
    body = urllib.parse.urlencode(token_request).encode("utf-8")
    status, _headers, response_body = http_request(
        token_url,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
        body=body,
    )
    if status != 200:
        fail(f"OIDC token endpoint returned {status}, expected 200.")
    payload = json.loads(response_body.decode("utf-8"))
    access_token = payload.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        fail("OIDC token response did not contain access_token.")
    return access_token


def http_request(
    url: str,
    *,
    method: str,
    headers: dict[str, str] | None = None,
    body: bytes | None = None,
) -> tuple[int, dict[str, str], bytes]:
    request = urllib.request.Request(url, method=method, headers=headers or {}, data=body)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, {key.lower(): value for key, value in response.headers.items()}, response.read()
    except urllib.error.HTTPError as error:
        return error.code, {key.lower(): value for key, value in error.headers.items()}, error.read()
    except urllib.error.URLError as error:
        fail(f"Request to {redact_url(url)} failed: {error.reason}")


def redact_url(url: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    redacted_query = urllib.parse.urlencode(
        [(key, "REDACTED" if key.lower() in {"token", "access_token"} else value) for key, value in query]
    )
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, redacted_query, parsed.fragment))


def first_env(*names: str) -> str | None:
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    return None


def load_env_file(path: str) -> None:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            for raw_line in handle:
                line = raw_line.strip()
                if not line or line.startswith("#"):
                    continue
                if line.startswith("export "):
                    line = line[len("export ") :].strip()
                if "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                if not key or not key.replace("_", "").isalnum() or key[0].isdigit():
                    continue
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
                    value = value[1:-1]
                os.environ.setdefault(key, value)
    except OSError as error:
        fail(f"Unable to read env file {path!r}: {error.strerror}.")


def fail(message: str) -> None:
    print(json.dumps({"ok": False, "error": message}, ensure_ascii=False), file=sys.stderr)
    raise SystemExit(1)


if __name__ == "__main__":
    raise SystemExit(main())
