from __future__ import annotations

from collections.abc import Mapping

from fastapi.testclient import TestClient

from app.config import load_settings
from app.main import create_app


def make_client(env: Mapping[str, str] | None = None) -> TestClient:
    base_env = {
        "AKL_ENV": "test",
        "AKL_AUTH_MODE": "disabled",
        "AKL_RAG_DEPENDENCY_MODE": "mock",
        "AKL_RAG_MOCK_CHAT_RESPONSE": "",
    }
    if env:
        base_env.update(env)
    return TestClient(create_app(load_settings(base_env)))
