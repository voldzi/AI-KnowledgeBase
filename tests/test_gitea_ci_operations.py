from __future__ import annotations

import argparse
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import export_gitea_ci_metrics as metrics  # noqa: E402
import maintain_gitea_ci_cache as cache  # noqa: E402


def write_bytes(path: Path, size: int, mtime: float) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x" * size)
    path.chmod(0o600)
    os.utime(path, (mtime, mtime))


class CacheRetentionTests(unittest.TestCase):
    def test_selection_applies_age_then_size_limit(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            now = time.time()
            write_bytes(root / "pip" / "old.whl", 4, now - 20 * 86400)
            write_bytes(root / "pnpm-store" / "newer.bin", 6, now - 2 * 86400)
            write_bytes(root / "pnpm-store" / "newest.bin", 7, now - 1 * 86400)

            selected, before, after, unknown = cache.select_evictions(
                root, retention_days=14, max_bytes=8, now=now
            )

            self.assertEqual(before, 17)
            self.assertEqual(after, 7)
            self.assertEqual(unknown, [])
            self.assertEqual(
                [(Path(item["path"]).name, item["reason"]) for item in selected],
                [("old.whl", "retention"), ("newer.bin", "size_limit")],
            )

    def test_selection_reports_unknown_root_entries(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            write_bytes(root / "unexpected" / "value", 2, time.time())
            _selected, _before, _after, unknown = cache.select_evictions(
                root, retention_days=14, max_bytes=10, now=time.time()
            )
            self.assertEqual(unknown, ["unexpected"])


class MetricExportTests(unittest.TestCase):
    def test_render_reports_runner_cache_and_main_without_token(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            token_file = root / "token"
            token_file.write_text("redacted-test-token", encoding="utf-8")
            token_file.chmod(0o600)
            write_bytes(root / "cache" / "pip" / "entry", 12, time.time())
            payloads = iter(
                [
                    {
                        "runners": [
                            {
                                "id": 6,
                                "name": "stratos-gitea-ci-vm125-akb",
                                "status": "online",
                                "busy": False,
                            }
                        ]
                    },
                    {
                        "workflow_runs": [
                            {
                                "id": 73,
                                "head_sha": "abc123",
                                "completed_at": "2026-08-08T08:00:00Z",
                            }
                        ]
                    },
                    {"commit": {"id": "abc123"}},
                ]
            )
            args = argparse.Namespace(
                gitea_url="https://git.home.cz",
                repository="AKB/ai-knowledgebase",
                runner_id=6,
                service="stratos-gitea-ci-runner.service",
                cache_root=root / "cache",
                token_file=token_file,
            )

            with mock.patch.object(metrics, "get_json", side_effect=lambda *_args: next(payloads)):
                with mock.patch.object(metrics, "systemd_state", return_value=1):
                    rendered = metrics.render_metrics(args)

            self.assertIn("akb_gitea_ci_runner_online", rendered)
            self.assertIn('runner_name="stratos-gitea-ci-vm125-akb"', rendered)
            self.assertIn("akb_gitea_ci_cache_bytes", rendered)
            self.assertIn("akb_gitea_ci_main_last_success_matches_head", rendered)
            self.assertNotIn("redacted-test-token", rendered)


if __name__ == "__main__":
    unittest.main()
