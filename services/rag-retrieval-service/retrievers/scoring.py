from __future__ import annotations

import hashlib
import math
import re
import unicodedata
from collections import Counter

from app.schemas import Classification, RagQueryFilters

CLASSIFICATION_ORDER: tuple[Classification, ...] = ("public", "internal", "restricted", "confidential")
TOKEN_RE = re.compile(r"[a-z0-9_]+")
IDENTIFIER_PATTERNS = (
    re.compile(r"\b[a-z]{2,8}\s*(?:c\.?\s*)?\d{1,4}\s*/\s*\d{2,4}\b"),
    re.compile(r"\b(?:cl|clanek|article)\.?\s*\d+[a-z]?\b"),
    re.compile(r"\b(?:odst|odstavec|paragraph)\.?\s*\d+[a-z]?\b"),
    re.compile(r"\b(?:pril|priloha|annex)\.?\s*\d+[a-z]?\b"),
)
RISK_QUERY_TERMS = {"riziko", "rizika", "rizik", "risk", "risks"}
RISK_TEXT_TERMS = {
    "chybove",
    "scenare",
    "scenar",
    "selhani",
    "selze",
    "nedostupna",
    "nedostupny",
    "nedostupnost",
    "konflikt",
    "konflikty",
    "limity",
    "limit",
    "omezeni",
    "bezpecnostni",
    "riziko",
    "rizika",
    "rizikove",
}

QUERY_EXPANSION_GROUPS: tuple[tuple[str, ...], ...] = (
    ("rmo", "rozkaz ministra obrany", "rozkaz", "ministr obrany"),
    ("gestor", "vlastnik", "odpovedny", "spravce", "owner"),
    ("ucinnost", "platnost", "validita", "valid from", "valid_from"),
    ("predpis", "smernice", "narizeni", "rozkaz", "opatreni", "directive", "policy"),
    ("cl", "clanek", "article"),
    ("odst", "odstavec", "paragraph"),
    ("pril", "priloha", "annex"),
    ("vyjimka", "odchylka", "exception"),
    ("schvaleni", "schvalit", "odsouhlaseni", "approve", "approval"),
)

CONCEPT_BONUSES: tuple[tuple[set[str], set[str], float], ...] = (
    (
        RISK_QUERY_TERMS,
        RISK_TEXT_TERMS,
        0.25,
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


_EXPANSION_TOKEN_GROUPS: tuple[set[str], ...] = tuple(
    {token for term in group for token in tokenize(term)} for group in QUERY_EXPANSION_GROUPS
)


def expand_query_text(query: str) -> str:
    """Append conservative domain synonyms for controlled-document search."""
    stripped = query.strip()
    if not stripped:
        return ""
    normalized_query = normalize_text(stripped)
    additions: list[str] = []
    seen = {normalize_text(stripped)}
    for group in QUERY_EXPANSION_GROUPS:
        if not any(_contains_normalized_term(normalized_query, term) for term in group):
            continue
        for term in group:
            normalized_term = normalize_text(term)
            if normalized_term in seen or _contains_normalized_term(normalized_query, term):
                continue
            additions.append(term)
            seen.add(normalized_term)
    if not additions:
        return stripped
    return " ".join([stripped, *additions])


def extract_query_identifiers(query: str) -> list[str]:
    normalized = normalize_text(query)
    identifiers: list[str] = []
    seen: set[str] = set()
    for pattern in IDENTIFIER_PATTERNS:
        for match in pattern.finditer(normalized):
            identifier = _normalize_identifier(match.group(0))
            if identifier and identifier not in seen:
                identifiers.append(identifier)
                seen.add(identifier)
    return identifiers


def _contains_normalized_term(normalized_text: str, term: str) -> bool:
    normalized_term = normalize_text(term).strip()
    if not normalized_term:
        return False
    pattern = rf"(?<![a-z0-9]){re.escape(normalized_term)}(?![a-z0-9])"
    return re.search(pattern, normalized_text) is not None


def _normalize_identifier(value: str) -> str:
    collapsed = re.sub(r"\s*/\s*", "/", value.strip())
    collapsed = re.sub(r"^([a-z]{2,8})\s+c\.?\s+(\d)", r"\1 \2", collapsed)
    collapsed = re.sub(r"\.", "", collapsed)
    collapsed = re.sub(r"\s+", " ", collapsed)
    return collapsed.strip()


STEM_MATCH_WEIGHT = 0.85
STEM_MIN_PREFIX = 4
STEM_MAX_SUFFIX = 3


def sparse_score(query: str, text: str) -> float:
    query_tokens = set(tokenize(query))
    if not query_tokens:
        return 0.0
    text_counts = Counter(tokenize(text))
    if not text_counts:
        return 0.0
    text_tokens = set(text_counts)

    matched_weight = 0.0
    matched_tf = 0
    for token in query_tokens:
        if token in text_counts:
            matched_weight += 1.0
            matched_tf += text_counts[token]
            continue
        stem_tf = _stem_match_tf(token, text_counts)
        if stem_tf:
            matched_weight += STEM_MATCH_WEIGHT
            matched_tf += stem_tf

    coverage = matched_weight / len(query_tokens)
    tf_bonus = min(0.08, 0.02 * math.log1p(matched_tf))
    phrase_bonus = 0.15 if normalize_text(query).strip() in normalize_text(text) else 0.0
    return min(1.0, coverage + tf_bonus + phrase_bonus + _concept_bonus(query_tokens, text_tokens))


def _stem_match_tf(query_token: str, text_counts: Counter[str]) -> int:
    """Inflection-tolerant match for fusional languages (Czech): two tokens
    match when they share a prefix of at least STEM_MIN_PREFIX chars and
    differ only in a short suffix (vyjimka/vyjimku, smernice/smernici)."""
    if len(query_token) < STEM_MIN_PREFIX:
        return 0
    total = 0
    for text_token, count in text_counts.items():
        if len(text_token) < STEM_MIN_PREFIX:
            continue
        longest = max(len(query_token), len(text_token))
        required_prefix = max(STEM_MIN_PREFIX, longest - STEM_MAX_SUFFIX)
        shortest = min(len(query_token), len(text_token))
        if shortest < required_prefix:
            continue
        if query_token[:required_prefix] == text_token[:required_prefix]:
            total += count
    return total


def _concept_bonus(query_tokens: set[str], text_tokens: set[str]) -> float:
    bonus = 0.0
    for query_terms, text_terms, value in CONCEPT_BONUSES:
        if query_tokens.intersection(query_terms) and text_tokens.intersection(text_terms):
            bonus += value
    bonus += _risk_signal_bonus(query_tokens, text_tokens)
    bonus += _expansion_group_bonus(query_tokens, text_tokens)
    return min(0.5, bonus)


def _risk_signal_bonus(query_tokens: set[str], text_tokens: set[str]) -> float:
    if not query_tokens.intersection(RISK_QUERY_TERMS):
        return 0.0
    risk_signal_count = len(text_tokens.intersection(RISK_TEXT_TERMS))
    if risk_signal_count < 2:
        return 0.0
    return min(0.25, risk_signal_count * 0.05)


def _expansion_group_bonus(query_tokens: set[str], text_tokens: set[str]) -> float:
    bonus = 0.0
    for group in _EXPANSION_TOKEN_GROUPS:
        if query_tokens.intersection(group) and text_tokens.intersection(group):
            bonus += 0.12
    return min(0.3, bonus)


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

    document_id = payload.get("document_id")
    if filters.document_ids and document_id not in filters.document_ids:
        return False

    document_version_id = payload.get("document_version_id")
    if filters.document_version_ids and document_version_id not in filters.document_version_ids:
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
