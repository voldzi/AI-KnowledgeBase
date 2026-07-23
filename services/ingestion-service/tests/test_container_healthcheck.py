from pathlib import Path


def test_container_healthcheck_is_liveness_only() -> None:
    dockerfile = (Path(__file__).parents[1] / "Dockerfile").read_text(encoding="utf-8")

    healthcheck = dockerfile.split("HEALTHCHECK", maxsplit=1)[1]
    assert "http://127.0.0.1:8090/health" in healthcheck
    assert "app.readiness_probe" not in healthcheck
