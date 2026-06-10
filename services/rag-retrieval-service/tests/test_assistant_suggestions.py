from __future__ import annotations

from tests.conftest import make_client


def test_suggestions_are_derived_from_indexed_documents() -> None:
    with make_client() as client:
        response = client.get("/api/v1/assistant/suggestions?response_language=cs")
    assert response.status_code == 200
    suggestions = response.json()["suggestions"]
    assert len(suggestions) > 0
    labels = [item["label"] for item in suggestions]
    assert "Smernice pro spravu dokumentu" in labels
    prompts = [item["prompt"] for item in suggestions]
    assert any("Smernice pro spravu dokumentu" in prompt for prompt in prompts)
    # generic IT-support catalogue must not be served when index has content
    assert "Nový přístup" not in labels


def test_suggestions_use_english_prompts_for_en() -> None:
    with make_client() as client:
        response = client.get("/api/v1/assistant/suggestions?response_language=en")
    assert response.status_code == 200
    suggestions = response.json()["suggestions"]
    assert len(suggestions) > 0
    assert any("regulate" in item["prompt"] for item in suggestions)
