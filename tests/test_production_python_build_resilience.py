from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
PYTHON_SERVICES = (
    "registry-api",
    "ingestion-service",
    "rag-retrieval-service",
    "evaluation-service",
    "governance-service",
    "llm-gateway-service",
)


class ProductionPythonBuildResilienceTests(unittest.TestCase):
    def test_managed_python_images_retry_slow_package_downloads(self) -> None:
        for service in PYTHON_SERVICES:
            dockerfile = (ROOT / "services" / service / "Dockerfile").read_text(
                encoding="utf-8"
            )
            with self.subTest(service=service):
                self.assertIn(
                    "ENV PIP_DEFAULT_TIMEOUT=300 \\\n"
                    "    PIP_RETRIES=8 \\\n"
                    "    PIP_DISABLE_PIP_VERSION_CHECK=1",
                    dockerfile,
                )


if __name__ == "__main__":
    unittest.main()
