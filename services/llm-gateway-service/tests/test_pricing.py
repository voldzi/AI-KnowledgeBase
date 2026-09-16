from app.pricing import PRICING_VERSION, estimate_openai_cost_usd


def test_luna_cost_uses_reported_input_and_output_tokens() -> None:
    assert PRICING_VERSION == "openai-2026-09-16"
    assert estimate_openai_cost_usd(
        model="gpt-5.6-luna",
        prompt_tokens=1_000_000,
        completion_tokens=1_000_000,
    ) == 1.4


def test_unknown_model_is_not_silently_priced() -> None:
    assert estimate_openai_cost_usd(
        model="future-model",
        prompt_tokens=10,
        completion_tokens=10,
    ) is None
