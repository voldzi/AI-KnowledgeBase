from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import date
from typing import Any, Callable

from app.schemas import (
    ContractExtractionCitation,
    ContractExtractionProfile,
    ContractFieldProposal,
    RetrievedChunk,
)


PROFILE_NAME = "contract_financial_v1"
PROFILE_VERSION = "1"

CONTRACT_FINANCIAL_FIELDS = [
    "contract_number",
    "title",
    "supplier_name",
    "customer_name",
    "signature_date",
    "effective_date",
    "valid_from",
    "valid_to",
    "total_amount_without_vat",
    "total_amount_with_vat",
    "vat_rate",
    "currency",
    "payment_due_days",
    "payment_frequency",
    "recurring_amount",
    "one_time_amount",
    "payment_schedule",
    "indexation_clause",
    "penalty_clause",
    "sla",
    "deadline",
    "obligation",
    "risk",
    "procurement_reference",
    "budget_rp_candidate",
    "cashflow_candidate",
]

REQUIRED_FIELDS = {
    "contract_number",
    "supplier_name",
    "customer_name",
    "total_amount_without_vat",
    "payment_due_days",
}


@dataclass(frozen=True)
class PatternSpec:
    field: str
    pattern: re.Pattern[str]
    reason: str
    confidence: str = "medium"
    unit_from_group: str | None = None
    normalizer: Callable[[str], Any] | None = None
    value_group: int | str = 1


def contract_extraction_profiles() -> list[ContractExtractionProfile]:
    return [
        ContractExtractionProfile(
            profile=PROFILE_NAME,
            profile_version=PROFILE_VERSION,
            title="Contract financial extraction",
            description=(
                "Proposes cited structured contract parameters for Budget & Contract. "
                "The profile returns only proposed values with source citations; source applications own final writes."
            ),
            supported_external_systems=["STRATOS_BUDGET"],
            fields=CONTRACT_FINANCIAL_FIELDS,
        )
    ]


def extract_contract_financial_proposals(
    *,
    chunks: list[RetrievedChunk],
) -> tuple[list[ContractFieldProposal], list[str], list[str]]:
    proposals: list[ContractFieldProposal] = []
    seen_fields: set[str] = set()

    for chunk in chunks:
        for spec in _pattern_specs():
            if spec.field in seen_fields and spec.field != "payment_schedule":
                continue
            match = spec.pattern.search(chunk.text)
            if match is None:
                continue
            value = _clean_value(str(match.group(spec.value_group)))
            if not value:
                continue
            unit = _clean_value(match.group(spec.unit_from_group)) if spec.unit_from_group and match.groupdict().get(spec.unit_from_group) else None
            normalized = spec.normalizer(value) if spec.normalizer else value
            proposals.append(
                ContractFieldProposal(
                    field=spec.field,
                    proposed_value=value,
                    normalized_value=normalized,
                    unit=unit,
                    confidence=spec.confidence,  # type: ignore[arg-type]
                    reason=spec.reason,
                    citation=_citation_from_match(chunk, match),
                )
            )
            seen_fields.add(spec.field)

    title_proposal = _title_proposal(chunks, seen_fields)
    if title_proposal is not None:
        proposals.insert(0, title_proposal)
        seen_fields.add("title")

    currency_proposal = _currency_proposal(proposals, seen_fields)
    if currency_proposal is not None:
        proposals.append(currency_proposal)
        seen_fields.add("currency")

    schedule = _payment_schedule(chunks)
    if schedule and "payment_schedule" not in seen_fields:
        proposals.append(schedule)
        seen_fields.add("payment_schedule")

    missing_information = sorted(REQUIRED_FIELDS - seen_fields)
    warnings: list[str] = []
    if not proposals:
        warnings.append("INSUFFICIENT_CITABLE_CONTRACT_EVIDENCE")
    if missing_information:
        warnings.append("MISSING_REQUIRED_CONTRACT_FIELDS")
    return proposals, missing_information, warnings


def _pattern_specs() -> list[PatternSpec]:
    return [
        PatternSpec(
            field="contract_number",
            pattern=re.compile(r"(?:smlouva|contract)\s*(?:c\.|č\.|cislo|číslo|number|no\.?)?\s*[:#-]\s*([A-Za-z0-9][A-Za-z0-9./_-]{2,})", re.IGNORECASE),
            reason="Explicit contract number label was found in the cited source.",
            confidence="high",
        ),
        PatternSpec(
            field="supplier_name",
            pattern=re.compile(
                r"(?:dodavatel|zhotovitel|prodávající|prodavajici|supplier)\s*[:\-]\s*(.+?)(?=\s+(?:objednatel|odběratel|odberatel|kupující|kupujici|customer)\s*[:\-]|\n|$)",
                re.IGNORECASE,
            ),
            reason="Supplier label was found in the cited source.",
            confidence="high",
        ),
        PatternSpec(
            field="customer_name",
            pattern=re.compile(
                r"(?:objednatel|odběratel|odberatel|kupující|kupujici|customer)\s*[:\-]\s*(.+?)(?=\s+(?:datum\s+podpisu|účinnost|ucinnost|cena|platnost)\s*[:\-]|\n|$)",
                re.IGNORECASE,
            ),
            reason="Customer label was found in the cited source.",
            confidence="high",
        ),
        PatternSpec(
            field="signature_date",
            pattern=re.compile(r"(?:datum\s+podpisu|podeps[aá]no|signed)\s*[:\-]?\s*(\d{1,2}\.\s*\d{1,2}\.\s*\d{4}|\d{4}-\d{2}-\d{2})", re.IGNORECASE),
            reason="Signature date label was found in the cited source.",
            normalizer=_normalize_date,
        ),
        PatternSpec(
            field="effective_date",
            pattern=re.compile(r"(?:účinnost|ucinnost|effective\s+date|účinn[aá]\s+od|ucinna\s+od)\s*(?:od|:|-)?\s*(\d{1,2}\.\s*\d{1,2}\.\s*\d{4}|\d{4}-\d{2}-\d{2})", re.IGNORECASE),
            reason="Effective date label was found in the cited source.",
            normalizer=_normalize_date,
        ),
        PatternSpec(
            field="valid_from",
            pattern=re.compile(r"(?:platnost\s+od|valid\s+from)\s*[:\-]?\s*(\d{1,2}\.\s*\d{1,2}\.\s*\d{4}|\d{4}-\d{2}-\d{2})", re.IGNORECASE),
            reason="Validity start label was found in the cited source.",
            normalizer=_normalize_date,
        ),
        PatternSpec(
            field="valid_to",
            pattern=re.compile(r"(?:platnost\s+do|valid\s+to|do)\s*[:\-]?\s*(\d{1,2}\.\s*\d{1,2}\.\s*\d{4}|\d{4}-\d{2}-\d{2})", re.IGNORECASE),
            reason="Validity end label was found in the cited source.",
            normalizer=_normalize_date,
        ),
        PatternSpec(
            field="total_amount_without_vat",
            pattern=re.compile(r"(?:cena|hodnota|pln[eě]n[ií])[^.\n]{0,100}?(?:bez\s+DPH)[^0-9]{0,20}(?P<value>[0-9][0-9\s.,]*)\s*(?P<unit>Kč|CZK|EUR)", re.IGNORECASE),
            reason="Total amount without VAT was explicitly labelled in the cited source.",
            confidence="high",
            unit_from_group="unit",
            normalizer=_normalize_number,
            value_group="value",
        ),
        PatternSpec(
            field="total_amount_with_vat",
            pattern=re.compile(r"(?:cena|hodnota|pln[eě]n[ií])[^.\n]{0,100}?(?:včetně\s+DPH|vcetne\s+DPH|s\s+DPH)[^0-9]{0,20}(?P<value>[0-9][0-9\s.,]*)\s*(?P<unit>Kč|CZK|EUR)", re.IGNORECASE),
            reason="Total amount with VAT was explicitly labelled in the cited source.",
            confidence="high",
            unit_from_group="unit",
            normalizer=_normalize_number,
            value_group="value",
        ),
        PatternSpec(
            field="vat_rate",
            pattern=re.compile(r"(?:DPH|VAT)[^\d%]{0,30}(\d{1,2}(?:[,.]\d+)?)\s*%", re.IGNORECASE),
            reason="VAT rate was explicitly labelled in the cited source.",
            unit_from_group=None,
            normalizer=_normalize_number,
        ),
        PatternSpec(
            field="payment_due_days",
            pattern=re.compile(r"(?:splatnost|due\s+date)[^0-9]{0,50}(\d{1,3})\s*(?:dn[uůy]?|days)", re.IGNORECASE),
            reason="Payment due date was found in the cited source.",
            confidence="high",
            unit_from_group=None,
            normalizer=_normalize_int,
        ),
        PatternSpec(
            field="payment_frequency",
            pattern=re.compile(r"(měsíčně|mesicne|čtvrtletně|ctvrtletne|ročně|rocne|monthly|quarterly|annually)", re.IGNORECASE),
            reason="Payment frequency keyword was found in the cited source.",
            normalizer=_normalize_frequency,
        ),
        PatternSpec(
            field="recurring_amount",
            pattern=re.compile(r"(?:měsíční|mesicni|pauš[aá]l|pausal|recurring)[^.\n]{0,100}?(?P<value>[0-9][0-9\s.,]*)\s*(?P<unit>Kč|CZK|EUR)", re.IGNORECASE),
            reason="Recurring amount was found in the cited source.",
            unit_from_group="unit",
            normalizer=_normalize_number,
            value_group="value",
        ),
        PatternSpec(
            field="one_time_amount",
            pattern=re.compile(r"(?:jednor[aá]zov[aá]|one[- ]time)[^.\n]{0,100}?(?P<value>[0-9][0-9\s.,]*)\s*(?P<unit>Kč|CZK|EUR)", re.IGNORECASE),
            reason="One-time amount was found in the cited source.",
            unit_from_group="unit",
            normalizer=_normalize_number,
            value_group="value",
        ),
        PatternSpec(
            field="indexation_clause",
            pattern=re.compile(r"((?:indexace|infla[cč]n[ií]\s+dolo[zž]ka|inflation)[^.\n]{0,220})", re.IGNORECASE),
            reason="Indexation clause keyword was found in the cited source.",
            confidence="low",
        ),
        PatternSpec(
            field="penalty_clause",
            pattern=re.compile(r"((?:smluvn[ií]\s+pokuta|sankce|penalt)[^.\n]{0,220})", re.IGNORECASE),
            reason="Penalty clause keyword was found in the cited source.",
            confidence="low",
        ),
        PatternSpec(
            field="sla",
            pattern=re.compile(r"((?:SLA|dostupnost|servisn[ií]\s+[uú]rove[nň])[^.\n]{0,220})", re.IGNORECASE),
            reason="SLA keyword was found in the cited source.",
            confidence="low",
        ),
        PatternSpec(
            field="deadline",
            pattern=re.compile(r"((?:term[ií]n|deadline|lh[uů]ta)[^.\n]{0,220})", re.IGNORECASE),
            reason="Deadline keyword was found in the cited source.",
            confidence="low",
        ),
        PatternSpec(
            field="obligation",
            pattern=re.compile(r"((?:dodavatel\s+je\s+povinen|zhotovitel\s+je\s+povinen|povinnost)[^.\n]{0,220})", re.IGNORECASE),
            reason="Obligation keyword was found in the cited source.",
            confidence="low",
        ),
        PatternSpec(
            field="risk",
            pattern=re.compile(r"((?:riziko|omezen[ií]|výjimka|vyjimka)[^.\n]{0,220})", re.IGNORECASE),
            reason="Risk keyword was found in the cited source.",
            confidence="low",
        ),
        PatternSpec(
            field="procurement_reference",
            pattern=re.compile(r"(?:VZ|NEN|veřejn[aé]\s+zak[aá]zk[ay])\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9./_-]{2,})", re.IGNORECASE),
            reason="Procurement reference label was found in the cited source.",
        ),
        PatternSpec(
            field="budget_rp_candidate",
            pattern=re.compile(r"(?:rozpo[cč]tov[aé]\s+polo[zž]ka|RP)\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9./_-]{2,})", re.IGNORECASE),
            reason="Budget or RP reference label was found in the cited source.",
        ),
    ]


def _title_proposal(chunks: list[RetrievedChunk], seen_fields: set[str]) -> ContractFieldProposal | None:
    if "title" in seen_fields or not chunks:
        return None
    chunk = chunks[0]
    title = chunk.citation.document_title.strip()
    if not title:
        return None
    return ContractFieldProposal(
        field="title",
        proposed_value=title,
        normalized_value=title,
        confidence="medium",
        reason="Document title metadata is attached to the cited authorized chunk.",
        citation=ContractExtractionCitation(
            document_id=chunk.citation.document_id,
            document_version_id=chunk.citation.document_version_id,
            chunk_id=chunk.chunk_id,
            page_number=chunk.citation.page_number,
            section_path=chunk.citation.section_path,
            section=_section(chunk),
            quoted_text=_short_quote(chunk.text),
            viewer_url=_viewer_url(chunk),
            warnings=[],
        ),
    )


def _currency_proposal(
    proposals: list[ContractFieldProposal],
    seen_fields: set[str],
) -> ContractFieldProposal | None:
    if "currency" in seen_fields:
        return None
    for proposal in proposals:
        if not proposal.unit:
            continue
        return ContractFieldProposal(
            field="currency",
            proposed_value=proposal.unit,
            normalized_value="CZK" if proposal.unit == "Kč" else proposal.unit,
            confidence=proposal.confidence,
            reason="Currency was derived from an explicitly cited monetary amount.",
            citation=proposal.citation,
        )
    return None


def _payment_schedule(chunks: list[RetrievedChunk]) -> ContractFieldProposal | None:
    schedule_items: list[dict[str, Any]] = []
    first_chunk: RetrievedChunk | None = None
    first_match: re.Match[str] | None = None
    pattern = re.compile(
        r"(měsíčně|mesicne|čtvrtletně|ctvrtletne|ročně|rocne|monthly|quarterly|annually)[^.\n]{0,80}?(?P<value>[0-9][0-9\s.,]*)\s*(?P<unit>Kč|CZK|EUR)",
        re.IGNORECASE,
    )
    for chunk in chunks:
        for match in pattern.finditer(chunk.text):
            frequency = _clean_value(match.group(1))
            amount = _clean_value(match.group("value"))
            currency = _clean_value(match.group("unit"))
            schedule_items.append(
                {
                    "frequency": frequency,
                    "normalized_frequency": _normalize_frequency(frequency),
                    "amount": _normalize_number(amount),
                    "currency": currency,
                    "chunk_id": chunk.chunk_id,
                    "page_number": chunk.citation.page_number,
                }
            )
            first_chunk = first_chunk or chunk
            first_match = first_match or match
    if not schedule_items or first_chunk is None or first_match is None:
        return None
    return ContractFieldProposal(
        field="payment_schedule",
        proposed_value=schedule_items,
        normalized_value=schedule_items,
        confidence="medium",
        reason="Recurring payment schedule items were found in cited source text.",
        citation=_citation_from_match(first_chunk, first_match),
    )


def _citation_from_match(chunk: RetrievedChunk, match: re.Match[str]) -> ContractExtractionCitation:
    quote = _sentence_around(chunk.text, match.start(), match.end())
    warnings = []
    if not chunk.citation.page_number:
        warnings.append("PAGE_NUMBER_MISSING")
    return ContractExtractionCitation(
        document_id=chunk.citation.document_id,
        document_version_id=chunk.citation.document_version_id,
        chunk_id=chunk.chunk_id,
        page_number=chunk.citation.page_number,
        section_path=chunk.citation.section_path,
        section=_section(chunk),
        quoted_text=quote,
        viewer_url=_viewer_url(chunk),
        warnings=warnings,
    )


def _viewer_url(chunk: RetrievedChunk) -> str:
    url = f"/akb/documents/{chunk.citation.document_id}?tab=viewer&chunk_id={chunk.chunk_id}"
    if chunk.citation.page_number:
        return f"{url}#page={chunk.citation.page_number}"
    return url


def _section(chunk: RetrievedChunk) -> str | None:
    section = " / ".join(chunk.citation.section_path)
    return section or None


def _sentence_around(text: str, start: int, end: int) -> str:
    left = max(text.rfind(".", 0, start), text.rfind("\n", 0, start))
    right_candidates = [idx for idx in (text.find(".", end), text.find("\n", end)) if idx != -1]
    right = min(right_candidates) if right_candidates else min(len(text), end + 160)
    return _short_quote(text[left + 1 : right + 1])


def _short_quote(value: str, limit: int = 240) -> str:
    compact = re.sub(r"\s+", " ", value).strip()
    if len(compact) <= limit:
        return compact
    return compact[: limit - 1].rstrip() + "…"


def _clean_value(value: str | None) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", value).strip(" \t\n\r,;.")


def _normalize_number(value: str) -> int | float | None:
    normalized = value.replace("\xa0", " ").replace(" ", "").replace(",", ".")
    normalized = re.sub(r"[^0-9.]", "", normalized)
    if not normalized:
        return None
    if normalized.count(".") > 1:
        head, *tail = normalized.split(".")
        normalized = "".join([head, *tail[:-1]]) + "." + tail[-1]
    number = float(normalized)
    return int(number) if number.is_integer() else number


def _normalize_int(value: str) -> int | None:
    number = _normalize_number(value)
    if number is None:
        return None
    return int(number)


def _normalize_date(value: str) -> str | None:
    compact = re.sub(r"\s+", "", value)
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", compact):
        return compact
    match = re.fullmatch(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", compact)
    if not match:
        return None
    day, month, year = (int(part) for part in match.groups())
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def _normalize_frequency(value: str) -> str:
    normalized = _strip_accents(value.lower())
    if normalized in {"mesicne", "monthly"}:
        return "monthly"
    if normalized in {"ctvrtletne", "quarterly"}:
        return "quarterly"
    if normalized in {"rocne", "annually"}:
        return "annually"
    return normalized


def _strip_accents(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    return "".join(char for char in normalized if not unicodedata.combining(char))
