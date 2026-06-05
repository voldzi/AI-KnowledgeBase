from __future__ import annotations

from collections.abc import Mapping

from fastapi.testclient import TestClient

from app.config import load_settings
from app.main import create_app


def make_client(env: Mapping[str, str] | None = None) -> TestClient:
    base_env = {
        "AKL_ENV": "test",
        "AKL_AUTH_MODE": "disabled",
        "AKL_LLM_DEFAULT_PROVIDER": "mock",
        "AKL_LLM_ENABLED_PROVIDERS": "mock",
        "AKL_LLM_MODEL_PROVIDER_MAP": "{}",
        "AKL_LLM_REQUEST_TIMEOUT_SECONDS": "0.1",
        "AKL_LLM_RETRY_ATTEMPTS": "0",
        "AKL_MOCK_CHAT_RESPONSE": "Mock answer.",
    }
    if env:
        base_env.update(env)
    return TestClient(create_app(load_settings(base_env)))
