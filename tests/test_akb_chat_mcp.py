import base64
import hashlib
import importlib.util
import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).parents[1] / "tools" / "akb_chat_mcp.py"
SPEC = importlib.util.spec_from_file_location("akb_chat_mcp", MODULE_PATH)
assert SPEC and SPEC.loader
mcp = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mcp)


class FakeClient:
    def __init__(self):
        self.calls = []

    def request(self, method, path, body=None, authenticated=True):
        self.calls.append((method, path, body, authenticated))
        if path == "/api/assistant/chat":
            return {"ok": True, "status": 200, "latency_ms": 4.2, "data": {"response": {"citations": [{"chunk_id": "chunk:1"}]}}}
        return {"ok": True, "status": 200, "latency_ms": 1.0, "data": {}}


class AkbChatMcpTests(unittest.TestCase):
    def test_tools_list_exposes_governed_chat_and_citation(self):
        response = mcp.dispatch(FakeClient(), {"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
        names = {tool["name"] for tool in response["result"]["tools"]}
        self.assertEqual(names, {"akb_health", "akb_chat", "akb_get_citation", "akb_get_conversation", "akb_chat_evaluate"})

    def test_chat_uses_public_web_bridge_contract(self):
        client = FakeClient()
        result = mcp.call_tool(client, "akb_chat", {"message": "Co říká zákon?", "response_language": "cs"})
        self.assertTrue(result["ok"])
        self.assertEqual(client.calls[0], ("POST", "/api/assistant/chat", {"message": "Co říká zákon?", "response_language": "cs"}, True))

    def test_evaluation_reauthorizes_returned_citations(self):
        client = FakeClient()
        result = mcp.call_tool(client, "akb_chat_evaluate", {"questions": ["Dotaz"]})
        self.assertTrue(result["all_passed"])
        self.assertEqual(client.calls[1][1], "/api/assistant/citations/chunk%3A1/open")

    def test_secret_file_rejects_group_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            secret = Path(directory) / "token"
            secret.write_text("secret", encoding="utf-8")
            secret.chmod(0o640)
            with self.assertRaises(mcp.McpFailure):
                mcp._read_secret(secret)

    def test_secret_file_accepts_mode_0600(self):
        with tempfile.TemporaryDirectory() as directory:
            secret = Path(directory) / "token"
            secret.write_text("secret", encoding="utf-8")
            secret.chmod(stat.S_IRUSR | stat.S_IWUSR)
            self.assertEqual(mcp._read_secret(secret), "secret")

    def test_internal_failure_does_not_expose_exception_or_token(self):
        with patch.object(mcp, "call_tool", side_effect=RuntimeError("bearer top-secret")):
            response = mcp.dispatch(FakeClient(), {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "akb_chat", "arguments": {"message": "x"}}})
        serialized = json.dumps(response)
        self.assertNotIn("top-secret", serialized)
        self.assertEqual(response["error"]["code"], -32603)

    def test_stdio_initialize_shape(self):
        response = mcp.dispatch(FakeClient(), {"jsonrpc": "2.0", "id": 3, "method": "initialize", "params": {}})
        self.assertEqual(response["result"]["protocolVersion"], mcp.PROTOCOL_VERSION)
        self.assertEqual(response["result"]["serverInfo"]["name"], "akb-chat")

    def test_device_login_uses_pkce_and_stores_only_refresh_session(self):
        class DiscoveryResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self, _limit):
                return json.dumps({
                    "device_authorization_endpoint": "https://login.example/device",
                    "token_endpoint": "https://login.example/token",
                }).encode()

        calls = []

        def form_request(url, values):
            calls.append((url, values))
            if url.endswith("/device"):
                return {
                    "device_code": "device-code",
                    "verification_uri": "https://login.example/activate",
                    "expires_in": 120,
                    "interval": 2,
                }
            return {"refresh_token": "refresh-only", "access_token": "not-persisted"}

        with tempfile.TemporaryDirectory() as directory:
            session_file = Path(directory) / "session.json"
            with (
                patch.object(mcp.urllib.request, "urlopen", return_value=DiscoveryResponse()),
                patch.object(mcp, "_form_request", side_effect=form_request),
                patch.object(mcp.time, "sleep"),
                patch.object(mcp.secrets, "token_urlsafe", return_value="fixed-verifier"),
            ):
                mcp.device_login(session_file, "https://login.example/realms/test", "client", True)

            authorization = calls[0][1]
            exchange = calls[1][1]
            expected = base64.urlsafe_b64encode(hashlib.sha256(b"fixed-verifier").digest()).rstrip(b"=").decode()
            self.assertEqual(authorization["code_challenge"], expected)
            self.assertEqual(authorization["code_challenge_method"], "S256")
            self.assertEqual(exchange["code_verifier"], "fixed-verifier")
            stored = json.loads(session_file.read_text(encoding="utf-8"))
            self.assertEqual(stored["refresh_token"], "refresh-only")
            self.assertNotIn("access_token", stored)
            self.assertEqual(stat.S_IMODE(session_file.stat().st_mode), 0o600)


if __name__ == "__main__":
    unittest.main()
