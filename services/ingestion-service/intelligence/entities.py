from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Pattern

ENTITY_EXTRACTION_PROFILE = "rule_based_v1"
MAX_ENTITIES_PER_CHUNK = 48
MAX_ENTITY_VALUE_CHARS = 180


@dataclass(frozen=True)
class EntityPattern:
    entity_type: str
    pattern: Pattern[str]
    confidence: float


ENTITY_PATTERNS: tuple[EntityPattern, ...] = (
    EntityPattern(
        "email",
        re.compile(r"(?<![\w.+-])[\w.+-]{1,80}@[A-Za-z0-9.-]{1,120}\.[A-Za-z]{2,24}(?![\w.-])"),
        0.99,
    ),
    EntityPattern(
        "url",
        re.compile(r"\bhttps?://[^\s<>()\"']{4,240}", re.IGNORECASE),
        0.97,
    ),
    EntityPattern(
        "ipv4",
        re.compile(
            r"\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}"
            r"(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b"
        ),
        0.99,
    ),
    EntityPattern(
        "phone",
        re.compile(r"(?<![\w+])(?:\+420\s*)?(?:\d{3}[\s.-]*){2}\d{3}(?!\w)"),
        0.9,
    ),
    EntityPattern(
        "date",
        re.compile(r"\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\.\s*\d{1,2}\.\s*\d{4})\b"),
        0.92,
    ),
    EntityPattern(
        "document_number",
        re.compile(
            r"\b(?:[A-ZČĎĚŇŘŠŤŮÚÝŽ]{2,8}\s*)?\d{1,6}/\d{2,4}"
            r"(?:[-/][A-Z0-9ČĎĚŇŘŠŤŮÚÝŽ]{1,12})?\b",
            re.IGNORECASE,
        ),
        0.88,
    ),
)


def build_intelligence_metadata(text: str) -> dict[str, Any]:
    entities = extract_entities(text)
    entity_types = sorted({entity["type"] for entity in entities})
    entity_values = [
        entity["normalized_value"]
        for entity in entities
        if isinstance(entity.get("normalized_value"), str)
    ]
    entity_pairs = _entity_pairs_from_entities(entities)
    return {
        "entity_extraction_profile": ENTITY_EXTRACTION_PROFILE,
        "entity_count": len(entities),
        "entity_types": entity_types,
        "entity_values": entity_values,
        "entity_pairs": entity_pairs,
        "entities": entities,
    }


def intelligence_payload_fields(metadata: dict[str, Any]) -> dict[str, list[str]]:
    intelligence = metadata.get("intelligence")
    if not isinstance(intelligence, dict):
        return {"entity_types": [], "entity_values": [], "entity_pairs": []}
    entity_types = _string_list(intelligence.get("entity_types"))
    entity_values = _string_list(intelligence.get("entity_values"))
    entity_pairs = _string_list(intelligence.get("entity_pairs"))
    if not entity_pairs:
        entity_pairs = _entity_pairs_from_entities(intelligence.get("entities"))
    return {
        "entity_types": entity_types,
        "entity_values": entity_values,
        "entity_pairs": entity_pairs,
    }


def extract_entities(text: str) -> list[dict[str, Any]]:
    entities: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for entity_pattern in ENTITY_PATTERNS:
        for match in entity_pattern.pattern.finditer(text):
            raw_value = _clean_value(match.group(0))
            if not raw_value or len(raw_value) > MAX_ENTITY_VALUE_CHARS:
                continue
            normalized_value = _normalize_value(entity_pattern.entity_type, raw_value)
            key = (entity_pattern.entity_type, normalized_value)
            if key in seen:
                continue
            seen.add(key)
            entities.append(
                {
                    "type": entity_pattern.entity_type,
                    "value": raw_value,
                    "normalized_value": normalized_value,
                    "start": match.start(),
                    "end": match.start() + len(raw_value),
                    "confidence": entity_pattern.confidence,
                    "source": "chunk_text",
                    "extraction_profile": ENTITY_EXTRACTION_PROFILE,
                }
            )
            if len(entities) >= MAX_ENTITIES_PER_CHUNK:
                return entities
    return entities


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str) and item.strip()]


def _entity_pairs_from_entities(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    pairs: list[str] = []
    seen: set[str] = set()
    for entity in value:
        if not isinstance(entity, dict):
            continue
        entity_type = entity.get("type")
        normalized_value = entity.get("normalized_value")
        if not isinstance(entity_type, str) or not isinstance(normalized_value, str):
            continue
        pair = f"{entity_type}:{normalized_value}"
        if pair in seen:
            continue
        seen.add(pair)
        pairs.append(pair)
    return pairs


def _clean_value(value: str) -> str:
    return value.strip().strip(".,;:)]}»”'\"")


def _normalize_value(entity_type: str, value: str) -> str:
    if entity_type in {"email", "url"}:
        return value.lower()
    if entity_type == "phone":
        prefix = "+" if value.strip().startswith("+") else ""
        digits = re.sub(r"\D", "", value)
        return f"{prefix}{digits}"
    if entity_type == "date":
        return re.sub(r"\s+", "", value)
    if entity_type == "document_number":
        return re.sub(r"\s+", "", value).upper()
    return re.sub(r"\s+", " ", value).strip()
