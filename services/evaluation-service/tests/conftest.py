from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
import tempfile

from fastapi.testclient import TestClient

from app.config import load_settings
from app.main import create_app


def make_client(env: Mapping[str, str] | None = None) -> TestClient:
    temporary = tempfile.TemporaryDirectory(prefix="akb-evaluation-tests-")
    temporary_root = Path(temporary.name)
    base_env = {
        "AKL_ENV": "test",
        "AKL_AUTH_MODE": "disabled",
        "AKL_EVAL_DEPENDENCY_MODE": "mock",
        "AKL_EVAL_DATASETS_DIR": str(temporary_root / "datasets"),
        "AKL_EVAL_SEED_DATASETS_DIR": str(Path(__file__).parents[1] / "datasets"),
        "AKL_EVAL_REPORTS_DIR": str(temporary_root / "reports"),
    }
    if env:
        base_env.update(env)
    client = TestClient(create_app(load_settings(base_env)))
    client._akb_temporary_directory = temporary  # type: ignore[attr-defined]
    return client
