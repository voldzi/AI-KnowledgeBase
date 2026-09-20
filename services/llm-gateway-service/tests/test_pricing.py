from app.pricing import PRICING_VERSION, estimate_openai_cost_usd


def test_luna_cost_uses_reported_input_and_output_tokens() -> None:
    assert PRICING_VERSION == "openai-2026-09-20"
    assert estimate_openai_cost_usd(
        model="gpt-5.6-luna",
        prompt_tokens=1_000_000,
        completion_tokens=1_000_000,
    ) == 1.4


def test_gpt_5_mini_snapshot_cost_uses_cached_input_discount() -> None:
    assert estimate_openai_cost_usd(
        model="gpt-5-mini-2025-08-07",
        prompt_tokens=1_000_000,
        cached_prompt_tokens=400_000,
        completion_tokens=1_000_000,
    ) == 2.16


def test_unknown_model_is_not_silently_priced() -> None:
    assert estimate_openai_cost_usd(
        model="future-model",
        prompt_tokens=10,
        completion_tokens=10,
    ) is None
