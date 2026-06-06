from __future__ import annotations

import hashlib
import math
import re
import unicodedata
from collections import Counter

from app.schemas import Classification, RagQueryFilters

CLASSIFICATION_ORDER: tuple[Classification, ...] = ("public", "internal", "restricted", "confidential")
TOKEN_RE = re.compile(r"[a-z0-9_]+")

CONCEPT_BONUSES: tuple[tuple[set[str], set[str], float], ...] = (
    (
        {"riziko", "rizika", "rizik", "risk", "risks"},
        {
            "chybove",
            "chybovy",
            "chyba",
            "chyby",
            "scenare",
            "scenar",
            "selhani",
            "selze",
            "nedostupna",
            "nedostupny",
            "problem",
            "problemy",
            "limity",
            "omezeni",
            "bezpecnostni",
        },
        0.35,
    ),
    (
        {"projekt", "projektu", "platforma", "akl"},
        {"projekt", "projektu", "platforma", "akl", "system", "sluzba", "sluzby"},
        0.10,
    ),
)


def normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value.lower())
    return "".join(char for char in normalized if not unicodedata.combining(char))


def tokenize(value: str) -> list[str]:
    return TOKEN_RE.findall(normalize_text(value))


def sparse_score(query: str, text: str) -> float:
    query_tokens = set(tokenize(query))
    if not query_tokens:
        return 0.0
    text_tokens = set(tokenize(text))
    if not text_tokens:
        return 0.0

    overlap = len(query_tokens & text_tokens) / len(query_tokens)
    phrase_bonus = 0.15 if normalize_text(query).strip() in normalize_text(text) else 0.0
    return min(1.0, overlap + phrase_bonus + _concept_bonus(query_tokens, text_tokens))


def _concept_bonus(query_tokens: set[str], text_tokens: set[str]) -> float:
    bonus = 0.0
    for query_terms, text_terms, value in CONCEPT_BONUSES:
        if query_tokens.intersection(query_terms) and text_tokens.intersection(text_terms):
            bonus += value
    return min(0.5, bonus)


def deterministic_embedding(text: str, dimensions: int = 32) -> list[float]:
    vector = [0.0] * dimensions
    counts = Counter(tokenize(text))
    if not counts:
        return vector

    for token, count in counts.items():
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        index = int.from_bytes(digest[:4], "big") % dimensions
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        vector[index] += sign * float(count)

    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0:
        return vector
    return [value / norm for value in vector]


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right:
        return 0.0
    size = min(len(left), len(right))
    dot = sum(left[index] * right[index] for index in range(size))
    left_norm = math.sqrt(sum(value * value for value in left[:size]))
    right_norm = math.sqrt(sum(value * value for value in right[:size]))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return max(0.0, min(1.0, (dot / (left_norm * right_norm) + 1.0) / 2.0))


def hybrid_score(dense: float, sparse: float, dense_weight: float) -> float:
    return max(0.0, min(1.0, dense * dense_weight + sparse * (1.0 - dense_weight)))


def classification_allowed(classification: str | None, max_classification: Classification) -> bool:
    if classification not in CLASSIFICATION_ORDER:
        return False
    return CLASSIFICATION_ORDER.index(classification) <= CLASSIFICATION_ORDER.index(max_classification)


def payload_matches_filters(payload: dict[str, object], filters: RagQueryFilters) -> bool:
    document_type = payload.get("document_type")
    if filters.document_types and document_type not in filters.document_types:
        return False

    classification = payload.get("classification")
    if not isinstance(classification, str) or not classification_allowed(classification, filters.classification_max):
        return False

    if filters.tags:
        payload_tags = payload.get("tags")
        if not isinstance(payload_tags, list):
            return False
        normalized_payload_tags = {normalize_text(str(tag)) for tag in payload_tags}
        normalized_filter_tags = {normalize_text(tag) for tag in filters.tags}
        if normalized_payload_tags.isdisjoint(normalized_filter_tags):
            return False

    if filters.only_valid:
        status = payload.get("status")
        if status is not None and status != "valid":
            return False

    return True
