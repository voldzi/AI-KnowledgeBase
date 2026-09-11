#!/usr/bin/env python3
"""Small stdio MCP client for governed AKB Chat acceptance tests.

The server deliberately calls the public AKB web bridge.  It therefore uses
the same STRATOS access projection, TLP decisions, RAG pipeline, conversation
history and citation authorization as the browser Chat.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import http.server
import json
import os
import secrets
import socketserver
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path
from typing import Any


PROTOCOL_VERSION = "2025-11-25"
SERVER_VERSION = "1.0.0"
MAX_HTTP_BYTES = 8 * 1024 * 1024
DEFAULT_BASE_URL = "https://stratos.zeleznalady.cz/akb"
DEFAULT_ISSUER = "https://login.zeleznalady.cz/realms/stratos"
DEFAULT_CLIENT_ID = "akb-chat-mcp-user"
DEFAULT_SESSION_FILE = Path.home() / ".config" / "akb-chat-mcp" / "session.json"


class McpFailure(RuntimeError):
    pass


def _json_object(value: Any, name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise McpFailure(f"{name} must be a JSON object")
    return value


def _safe_url(value: str, *, allow_http_loopback: bool = False) -> str:
    parsed = urllib.parse.urlsplit(value.rstrip("/"))
    loopback = parsed.hostname in {"127.0.0.1", "localhost", "::1"}
    if parsed.scheme != "https" and not (allow_http_loopback and parsed.scheme == "http" and loopback):
        raise McpFailure("Only HTTPS URLs (or HTTP loopback callbacks) are allowed")
    if not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise McpFailure("Configured URL is invalid")
    return urllib.parse.urlunsplit(parsed)


def _read_secret(path: Path) -> str:
    try:
        stat = path.stat()
    except OSError as exc:
        raise McpFailure(f"Credential file is unavailable: {path}") from exc
    if stat.st_mode & 0o077:
        raise McpFailure(f"Credential file must use mode 0600: {path}")
    value = path.read_text(encoding="utf-8").strip()
    if not value or len(value) > 32_768:
        raise McpFailure("Credential file is empty or invalid")
    return value


def _decode_jwt_exp(token: str) -> float | None:
    try:
        part = token.split(".")[1]
        payload = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
        return float(payload["exp"])
    except (IndexError, KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None


class CredentialProvider:
    def __init__(self, session_file: Path):
        self.session_file = session_file
        self._token: str | None = None
        self._expires_at = 0.0

    def token(self) -> str:
        token_file = os.environ.get("AKB_CHAT_MCP_BEARER_TOKEN_FILE")
        if token_file:
            return _read_secret(Path(token_file).expanduser())
        if self._token and self._expires_at > time.time() + 30:
            return self._token
        session = _json_object(json.loads(_read_secret(self.session_file)), "session")
        refresh_token = session.get("refresh_token")
        token_endpoint = session.get("token_endpoint")
        client_id = session.get("client_id")
        if not all(isinstance(item, str) and item for item in (refresh_token, token_endpoint, client_id)):
            raise McpFailure("Stored OIDC session is incomplete; run the login command")
        response = _form_request(
            _safe_url(token_endpoint),
            {"grant_type": "refresh_token", "client_id": client_id, "refresh_token": refresh_token},
        )
        access_token = response.get("access_token")
        rotated_refresh = response.get("refresh_token", refresh_token)
        if not isinstance(access_token, str) or not isinstance(rotated_refresh, str):
            raise McpFailure("OIDC refresh response is incomplete")
        session["refresh_token"] = rotated_refresh
        _write_session(self.session_file, session)
        self._token = access_token
        self._expires_at = _decode_jwt_exp(access_token) or (time.time() + float(response.get("expires_in", 240)))
        return access_token


def _read_http_body(response: Any) -> bytes:
    body = response.read(MAX_HTTP_BYTES + 1)
    if len(body) > MAX_HTTP_BYTES:
        raise McpFailure("AKB response exceeded the configured size limit")
    return body


def _form_request(url: str, values: dict[str, str]) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=urllib.parse.urlencode(values).encode(),
        method="POST",
        headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return _json_object(json.loads(_read_http_body(response)), "OIDC response")
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError) as exc:
        raise McpFailure("OIDC token request failed") from exc


def _write_session(path: Path, session: dict[str, Any]) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        json.dump(session, stream, separators=(",", ":"))
        stream.write("\n")
    os.replace(temporary, path)
    path.chmod(0o600)


class AkbClient:
    def __init__(self) -> None:
        self.base_url = _safe_url(os.environ.get("AKB_CHAT_MCP_BASE_URL", DEFAULT_BASE_URL))
        session_file = Path(os.environ.get("AKB_CHAT_MCP_SESSION_FILE", DEFAULT_SESSION_FILE)).expanduser()
        self.credentials = CredentialProvider(session_file)
        self.timeout = min(180.0, max(2.0, float(os.environ.get("AKB_CHAT_MCP_TIMEOUT_SECONDS", "90"))))

    def request(self, method: str, path: str, body: dict[str, Any] | None = None, *, authenticated: bool = True) -> dict[str, Any]:
        if not path.startswith("/") or ".." in path:
            raise McpFailure("Invalid AKB API path")
        headers = {"Accept": "application/json", "X-Correlation-ID": f"mcp-{secrets.token_hex(12)}"}
        data = None
        if authenticated:
            headers["Authorization"] = f"Bearer {self.credentials.token()}"
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode()
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(f"{self.base_url}{path}", data=data, method=method, headers=headers)
        started = time.monotonic()
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = _read_http_body(response)
                payload = json.loads(raw) if raw else None
                return {
                    "ok": True,
                    "status": response.status,
                    "latency_ms": round((time.monotonic() - started) * 1000, 1),
                    "correlation_id": response.headers.get("X-Correlation-ID") or headers["X-Correlation-ID"],
                    "data": payload,
                }
        except urllib.error.HTTPError as exc:
            raw = exc.read(MAX_HTTP_BYTES + 1)
            try:
                payload = json.loads(raw[:MAX_HTTP_BYTES])
            except json.JSONDecodeError:
                payload = {"error": {"code": "HTTP_ERROR", "message": f"AKB returned HTTP {exc.code}"}}
            return {
                "ok": False,
                "status": exc.code,
                "latency_ms": round((time.monotonic() - started) * 1000, 1),
                "correlation_id": exc.headers.get("X-Correlation-ID") or headers["X-Correlation-ID"],
                "data": payload,
            }
        except urllib.error.URLError as exc:
            raise McpFailure("AKB is unreachable") from exc


TOOLS = [
    {
        "name": "akb_health",
        "description": "Check the deployed AKB web bridge health and readiness with measured latency.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        "annotations": {"readOnlyHint": True, "idempotentHint": True, "openWorldHint": True},
    },
    {
        "name": "akb_chat",
        "description": "Ask the real governed AKB Chat as the configured test user and return its full answer, citations, warnings and latency.",
        "inputSchema": {
            "type": "object",
            "required": ["message"],
            "properties": {
                "message": {"type": "string", "minLength": 1, "maxLength": 12000},
                "conversation_id": {"type": "string", "minLength": 1, "maxLength": 160},
                "response_language": {"type": "string", "enum": ["cs", "en"], "default": "cs"},
                "context": {"type": "object"},
            },
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": False, "idempotentHint": False, "openWorldHint": True},
    },
    {
        "name": "akb_get_citation",
        "description": "Re-authorize and resolve one citation returned by AKB Chat for the configured test user.",
        "inputSchema": {
            "type": "object",
            "required": ["chunk_id"],
            "properties": {"chunk_id": {"type": "string", "pattern": "^[A-Za-z0-9_.:-]{1,240}$"}},
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": True, "idempotentHint": True, "openWorldHint": True},
    },
    {
        "name": "akb_get_conversation",
        "description": "Read an AKB Chat conversation after applying the current user's authorization to every stored message and citation.",
        "inputSchema": {
            "type": "object",
            "required": ["conversation_id"],
            "properties": {"conversation_id": {"type": "string", "pattern": "^[A-Za-z0-9_.:-]{1,160}$"}},
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": True, "idempotentHint": True, "openWorldHint": True},
    },
    {
        "name": "akb_chat_evaluate",
        "description": "Run a bounded real-chat acceptance set and optionally re-authorize every returned citation.",
        "inputSchema": {
            "type": "object",
            "required": ["questions"],
            "properties": {
                "questions": {"type": "array", "minItems": 1, "maxItems": 20, "items": {"type": "string", "minLength": 1, "maxLength": 12000}},
                "response_language": {"type": "string", "enum": ["cs", "en"], "default": "cs"},
                "verify_citations": {"type": "boolean", "default": True},
            },
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": False, "idempotentHint": False, "openWorldHint": True},
    },
]


def _required_string(arguments: dict[str, Any], key: str, limit: int) -> str:
    value = arguments.get(key)
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise McpFailure(f"{key} is required and must be at most {limit} characters")
    return value.strip()


def _citation_id(citation: Any) -> str | None:
    if not isinstance(citation, dict):
        return None
    for key in ("chunk_id", "chunkId"):
        value = citation.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def call_tool(client: AkbClient, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    if name == "akb_health":
        health = client.request("GET", "/api/health", authenticated=False)
        ready = client.request("GET", "/api/ready", authenticated=False)
        return {"healthy": health["ok"], "ready": ready["ok"], "health": health, "readiness": ready}
    if name == "akb_chat":
        payload: dict[str, Any] = {
            "message": _required_string(arguments, "message", 12000),
            "response_language": arguments.get("response_language", "cs"),
        }
        if "conversation_id" in arguments:
            payload["conversation_id"] = _required_string(arguments, "conversation_id", 160)
        if isinstance(arguments.get("context"), dict):
            payload["context"] = arguments["context"]
        return client.request("POST", "/api/assistant/chat", payload)
    if name == "akb_get_citation":
        chunk_id = urllib.parse.quote(_required_string(arguments, "chunk_id", 240), safe="")
        return client.request("GET", f"/api/assistant/citations/{chunk_id}/open")
    if name == "akb_get_conversation":
        conversation_id = urllib.parse.quote(_required_string(arguments, "conversation_id", 160), safe="")
        return client.request("GET", f"/api/assistant/conversations/{conversation_id}")
    if name == "akb_chat_evaluate":
        questions = arguments.get("questions")
        if not isinstance(questions, list) or not 1 <= len(questions) <= 20:
            raise McpFailure("questions must contain 1 to 20 items")
        language = arguments.get("response_language", "cs")
        verify = arguments.get("verify_citations", True) is not False
        results: list[dict[str, Any]] = []
        for index, question in enumerate(questions):
            message = _required_string({"message": question}, "message", 12000)
            chat = client.request("POST", "/api/assistant/chat", {"message": message, "response_language": language})
            response = chat.get("data", {}).get("response", {}) if isinstance(chat.get("data"), dict) else {}
            citations = response.get("citations", []) if isinstance(response, dict) else []
            citation_checks = []
            if verify and isinstance(citations, list):
                for citation in citations[:30]:
                    chunk_id = _citation_id(citation)
                    if chunk_id:
                        citation_checks.append(client.request("GET", f"/api/assistant/citations/{urllib.parse.quote(chunk_id, safe='')}/open"))
            results.append({"index": index, "question": message, "chat": chat, "citation_checks": citation_checks})
        passed = sum(1 for item in results if item["chat"]["ok"] and all(check["ok"] for check in item["citation_checks"]))
        return {"passed": passed, "total": len(results), "all_passed": passed == len(results), "results": results}
    raise McpFailure(f"Unknown tool: {name}")


def _tool_result(payload: dict[str, Any], *, error: bool = False) -> dict[str, Any]:
    return {
        "content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False, indent=2)}],
        "structuredContent": payload,
        "isError": error,
    }


def dispatch(client: AkbClient, message: dict[str, Any]) -> dict[str, Any] | None:
    method = message.get("method")
    request_id = message.get("id")
    if method and str(method).startswith("notifications/"):
        return None
    try:
        if method == "initialize":
            result = {"protocolVersion": PROTOCOL_VERSION, "capabilities": {"tools": {}}, "serverInfo": {"name": "akb-chat", "version": SERVER_VERSION}}
        elif method == "ping":
            result = {}
        elif method == "tools/list":
            result = {"tools": TOOLS}
        elif method == "tools/call":
            params = _json_object(message.get("params", {}), "params")
            name = params.get("name")
            if not isinstance(name, str):
                raise McpFailure("Tool name is required")
            result = _tool_result(call_tool(client, name, _json_object(params.get("arguments", {}), "arguments")))
        else:
            return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": "Method not found"}}
        return {"jsonrpc": "2.0", "id": request_id, "result": result}
    except McpFailure as exc:
        if method == "tools/call":
            return {"jsonrpc": "2.0", "id": request_id, "result": _tool_result({"error": str(exc)}, error=True)}
        return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32602, "message": str(exc)}}
    except Exception:
        return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32603, "message": "Internal MCP error"}}


def serve_stdio() -> None:
    client = AkbClient()
    while True:
        line = sys.stdin.buffer.readline()
        if not line:
            return
        if line.lower().startswith(b"content-length:"):
            length = int(line.split(b":", 1)[1].strip())
            while sys.stdin.buffer.readline().strip():
                pass
            raw = sys.stdin.buffer.read(length)
            framed = True
        else:
            raw = line
            framed = False
        try:
            message = _json_object(json.loads(raw), "request")
            response = dispatch(client, message)
        except Exception:
            response = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}
        if response is None:
            continue
        encoded = json.dumps(response, ensure_ascii=False, separators=(",", ":")).encode()
        if framed:
            sys.stdout.buffer.write(f"Content-Length: {len(encoded)}\r\n\r\n".encode() + encoded)
        else:
            sys.stdout.buffer.write(encoded + b"\n")
        sys.stdout.buffer.flush()


def interactive_login(session_file: Path, issuer: str, client_id: str, port: int, no_browser: bool) -> None:
    issuer = _safe_url(issuer)
    discovery_url = f"{issuer}/.well-known/openid-configuration"
    with urllib.request.urlopen(discovery_url, timeout=15) as response:
        discovery = _json_object(json.loads(_read_http_body(response)), "OIDC discovery")
    authorization_endpoint = _safe_url(str(discovery.get("authorization_endpoint", "")))
    token_endpoint = _safe_url(str(discovery.get("token_endpoint", "")))
    redirect_uri = f"http://127.0.0.1:{port}/callback"
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    authorization_url = authorization_endpoint + "?" + urllib.parse.urlencode({
        "client_id": client_id, "redirect_uri": redirect_uri, "response_type": "code",
        "scope": "openid profile email", "state": state, "code_challenge": challenge,
        "code_challenge_method": "S256",
    })
    result: dict[str, str] = {}

    class Callback(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            params = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            if params.get("state", [None])[0] == state and params.get("code"):
                result["code"] = params["code"][0]
                body = "AKB MCP login completed. You can close this window.".encode()
                self.send_response(200)
            else:
                body = "AKB MCP login failed.".encode()
                self.send_response(400)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, _format: str, *args: Any) -> None:
            return

    with socketserver.TCPServer(("127.0.0.1", port), Callback) as server:
        server.timeout = 180
        print(f"Open this URL to authenticate:\n{authorization_url}", file=sys.stderr)
        if not no_browser:
            webbrowser.open(authorization_url)
        server.handle_request()
    if "code" not in result:
        raise McpFailure("OIDC login did not complete")
    tokens = _form_request(token_endpoint, {
        "grant_type": "authorization_code", "client_id": client_id, "code": result["code"],
        "redirect_uri": redirect_uri, "code_verifier": verifier,
    })
    refresh_token = tokens.get("refresh_token")
    if not isinstance(refresh_token, str):
        raise McpFailure("OIDC did not issue a refresh token")
    _write_session(session_file, {"issuer": issuer, "token_endpoint": token_endpoint, "client_id": client_id, "refresh_token": refresh_token})
    print(f"AKB MCP session stored securely in {session_file}", file=sys.stderr)


def device_login(session_file: Path, issuer: str, client_id: str, no_browser: bool) -> None:
    issuer = _safe_url(issuer)
    with urllib.request.urlopen(f"{issuer}/.well-known/openid-configuration", timeout=15) as response:
        discovery = _json_object(json.loads(_read_http_body(response)), "OIDC discovery")
    device_endpoint = _safe_url(str(discovery.get("device_authorization_endpoint", "")))
    token_endpoint = _safe_url(str(discovery.get("token_endpoint", "")))
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    authorization = _form_request(device_endpoint, {
        "client_id": client_id,
        "scope": "openid profile email",
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    })
    device_code = authorization.get("device_code")
    verification_uri = authorization.get("verification_uri_complete") or authorization.get("verification_uri")
    user_code = authorization.get("user_code")
    if not isinstance(device_code, str) or not isinstance(verification_uri, str):
        raise McpFailure("OIDC device authorization response is incomplete")
    print(f"Open this URL to authenticate:\n{verification_uri}", file=sys.stderr)
    if isinstance(user_code, str) and "user_code=" not in verification_uri:
        print(f"Enter code: {user_code}", file=sys.stderr)
    if not no_browser:
        webbrowser.open(verification_uri)
    interval = max(2, min(15, int(authorization.get("interval", 5))))
    deadline = time.monotonic() + min(600, max(60, int(authorization.get("expires_in", 600))))
    while time.monotonic() < deadline:
        time.sleep(interval)
        try:
            tokens = _form_request(token_endpoint, {
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                "client_id": client_id,
                "device_code": device_code,
                "code_verifier": verifier,
            })
            break
        except McpFailure as exc:
            # _form_request deliberately redacts the OIDC body. Polling errors
            # are expected until the user completes the central sign-in.
            if time.monotonic() + interval >= deadline:
                raise McpFailure("OIDC device login expired") from exc
    else:
        raise McpFailure("OIDC device login expired")
    refresh_token = tokens.get("refresh_token")
    if not isinstance(refresh_token, str):
        raise McpFailure("OIDC did not issue a refresh token")
    _write_session(session_file, {"issuer": issuer, "token_endpoint": token_endpoint, "client_id": client_id, "refresh_token": refresh_token})
    print(f"AKB MCP session stored securely in {session_file}", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description="Governed AKB Chat MCP server")
    subparsers = parser.add_subparsers(dest="command")
    login = subparsers.add_parser("login", help="create or refresh the local OIDC user session")
    login.add_argument("--issuer", default=os.environ.get("AKB_CHAT_MCP_OIDC_ISSUER", DEFAULT_ISSUER))
    login.add_argument("--client-id", default=os.environ.get("AKB_CHAT_MCP_OIDC_CLIENT_ID", DEFAULT_CLIENT_ID))
    login.add_argument("--session-file", type=Path, default=Path(os.environ.get("AKB_CHAT_MCP_SESSION_FILE", DEFAULT_SESSION_FILE)).expanduser())
    login.add_argument("--port", type=int, default=18766)
    login.add_argument("--no-browser", action="store_true")
    login.add_argument("--device", action="store_true", help="use the OAuth device flow instead of a loopback callback")
    arguments = parser.parse_args()
    if arguments.command == "login":
        if arguments.device:
            device_login(arguments.session_file, arguments.issuer, arguments.client_id, arguments.no_browser)
        else:
            interactive_login(arguments.session_file, arguments.issuer, arguments.client_id, arguments.port, arguments.no_browser)
    else:
        serve_stdio()


if __name__ == "__main__":
    main()
