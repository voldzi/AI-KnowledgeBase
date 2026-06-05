import http.client
import json
import os
import threading
import unittest
from http.server import ThreadingHTTPServer

from akl_platform_status import server


class PlatformStatusTests(unittest.TestCase):
    def setUp(self):
        self.config = server.Config(
            service_name="platform-infrastructure",
            service_version="test",
            environment="test",
            auth_mode="mock",
            host="127.0.0.1",
            port=0,
            ready_timeout_seconds=0.2,
            ready_checks=(),
        )
        handler = server.PlatformStatusHandler
        handler.config = self.config
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.httpd.server_address[1]

    def tearDown(self):
        self.httpd.shutdown()
        self.thread.join(timeout=2)
        self.httpd.server_close()

    def request(self, path, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=2)
        connection.request("GET", path, headers=headers or {})
        response = connection.getresponse()
        body = response.read()
        connection.close()
        return response, body

    def test_health_returns_correlation_headers(self):
        response, body = self.request(
            "/health",
            {"X-Request-ID": "req-test", "X-Correlation-ID": "corr-test"},
        )
        payload = json.loads(body)
        self.assertEqual(response.status, 200)
        self.assertEqual(response.getheader("X-Request-ID"), "req-test")
        self.assertEqual(response.getheader("X-Correlation-ID"), "corr-test")
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["correlation_id"], "corr-test")

    def test_ready_without_checks_is_ready(self):
        response, body = self.request("/ready")
        payload = json.loads(body)
        self.assertEqual(response.status, 200)
        self.assertEqual(payload["status"], "ready")
        self.assertEqual(payload["checks"], [])

    def test_missing_path_uses_standard_error_shape(self):
        response, body = self.request("/missing")
        payload = json.loads(body)
        self.assertEqual(response.status, 404)
        self.assertEqual(payload["error"]["code"], "NOT_FOUND")
        self.assertIn("trace_id", payload["error"])

    def test_parse_ready_checks(self):
        checks = server.parse_ready_checks("qdrant=http://qdrant:6333/readyz,minio=http://minio:9000/minio/health/ready")
        self.assertEqual(
            checks,
            (
                ("qdrant", "http://qdrant:6333/readyz"),
                ("minio", "http://minio:9000/minio/health/ready"),
            ),
        )

    def test_production_rejects_mock_auth(self):
        old_env = dict(os.environ)
        try:
            os.environ["AKL_ENV"] = "production"
            os.environ["AKL_AUTH_MODE"] = "mock"
            with self.assertRaises(RuntimeError):
                server.load_config()
        finally:
            os.environ.clear()
            os.environ.update(old_env)


if __name__ == "__main__":
    unittest.main()
