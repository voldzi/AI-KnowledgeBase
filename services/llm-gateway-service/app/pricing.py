from __future__ import annotations

from dataclasses import dataclass


PRICING_VERSION = "openai-2026-09-23"


@dataclass(frozen=True)
class TokenPrice:
    input_per_million_usd: float
    output_per_million_usd: float
    cached_input_per_million_usd: float | None = None


# Operator-reviewed snapshot of the public OpenAI API price table. Unknown
# models deliberately return no estimate instead of silently using a guess.
OPENAI_TOKEN_PRICES: dict[str, TokenPrice] = {
    "gpt-6-sol": TokenPrice(2.00, 10.00, 0.20),
    "gpt-6-luna": TokenPrice(0.10, 0.50, 0.01),
    "gpt-6-astra": TokenPrice(10.0, 50.0),
    "gpt-5.6-sol": TokenPrice(4.0, 20.0),
    "gpt-5.6": TokenPrice(4.0, 20.0),
    "gpt-5.6-terra": TokenPrice(2.0, 12.0),
    "gpt-5.6-luna": TokenPrice(0.20, 1.20),
    "gpt-5-mini": TokenPrice(0.25, 2.00, 0.025),
    "gpt-5-mini-2025-08-07": TokenPrice(0.25, 2.00, 0.025),
}


def estimate_openai_cost_usd(
    *, model: str, prompt_tokens: int, completion_tokens: int, cached_prompt_tokens: int = 0
) -> float | None:
    price = OPENAI_TOKEN_PRICES.get(model)
    if price is None:
        return None
    cached = min(max(cached_prompt_tokens, 0), max(prompt_tokens, 0))
    uncached = max(prompt_tokens - cached, 0)
    cached_rate = price.cached_input_per_million_usd
    input_cost = uncached * price.input_per_million_usd
    input_cost += cached * (cached_rate if cached_rate is not None else price.input_per_million_usd)
    output_cost = max(completion_tokens, 0) * price.output_per_million_usd
    return round((input_cost + output_cost) / 1_000_000, 8)
