from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest


MODULE_PATH = Path(__file__).parents[1] / "tools" / "gte_reranker_server.py"
SPEC = importlib.util.spec_from_file_location("gte_reranker_server", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class GteRerankerRequestValidationTests(unittest.TestCase):
    def test_accepts_bounded_request(self) -> None:
        query, texts = MODULE._validate_request(
            {"query": " dotaz ", "texts": [" dokument "]},
            max_texts=32,
            max_text_chars=100,
        )
        self.assertEqual(query, "dotaz")
        self.assertEqual(texts, ["dokument"])

    def test_rejects_too_many_texts(self) -> None:
        with self.assertRaisesRegex(ValueError, "between 1 and 2"):
            MODULE._validate_request(
                {"query": "dotaz", "texts": ["a", "b", "c"]},
                max_texts=2,
                max_text_chars=100,
            )

    def test_rejects_oversized_text(self) -> None:
        with self.assertRaisesRegex(ValueError, "character limit"):
            MODULE._validate_request(
                {"query": "dotaz", "texts": ["prilis dlouhy"]},
                max_texts=2,
                max_text_chars=5,
            )

    def test_diagnostic_headers_expose_runtime_without_content(self) -> None:
        headers = MODULE._diagnostic_headers(
            {
                "device": "mps",
                "queue_ms": 1.25,
                "inference_ms": 18.5,
                "total_ms": 19.75,
                "text_count": 8,
            }
        )

        self.assertEqual(headers["X-AKB-Reranker-Device"], "mps")
        self.assertEqual(headers["X-AKB-Reranker-Queue-Ms"], "1.25")
        self.assertEqual(headers["X-AKB-Reranker-Inference-Ms"], "18.5")
        self.assertEqual(headers["X-AKB-Reranker-Text-Count"], "8")
        self.assertNotIn("query", " ".join(headers).lower())


if __name__ == "__main__":
    unittest.main()
