from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

from app.schemas import (
    ContractExtractionProfile,
    ControlledRuleCitation,
    ControlledRuleProposal,
    RetrievedChunk,
)


PROFILE_NAME = "controlled_document_rules_v1"
PROFILE_VERSION = "1"

_AMOUNT_RE = re.compile(
    r"(?P<amount>\d[\d \u00a0.]*?(?:,\d{1,2})?)\s*"
    r"(?P<currency>Kč|CZK|EUR)\b",
    re.IGNORECASE,
)
_DEADLINE_RE = re.compile(
    r"\b(?:nejpozději\s+)?(?:do|ve\s+lhůtě)\s+"
    r"(?P<value>\d{1,4})\s+"
    r"(?P<unit>kalendářních\s+dnů|pracovních\s+dnů|dnů|měsíců|let)\b",
    re.IGNORECASE,
)

_CATEGORY_MARKERS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("prohibition", (" nesmí ", " zakazuje se ", " není dovoleno ")),
    (
        "obligation",
        (
            " musí ",
            " je povinen ",
            " jsou povinni ",
            " je nutné ",
            " vyžaduje se ",
        ),
    ),
    (
        "responsibility",
        (" odpovídá ", " zajišťuje ", " schvaluje ", " gestor ", " správce "),
    ),
    ("permission", (" může ", " je oprávněn ", " lze ")),
    ("exception", (" výjim", " s výjimkou ", " nevztahuje se ")),
)

_ROLE_RE = re.compile(
    r"\b("
    r"gestor|schvalovatel|příkazce operace|správce rozpočtu|zadavatel|"
    r"vedoucí zaměstnanec|ředitel|vlastník|odpovědná osoba"
    r")\b",
    re.IGNORECASE,
)
_EVIDENCE_RE = re.compile(
    r"\b("
    r"objednávk\w*|smlouv\w*|protokol\w*|záznam\w*|formulář\w*|"
    r"příloh\w*|doklad\w*|evidenc\w*"
    r")\b",
    re.IGNORECASE,
)


def controlled_rule_extraction_profile() -> ContractExtractionProfile:
    return ContractExtractionProfile(
        profile=PROFILE_NAME,
        profile_version=PROFILE_VERSION,
        title="Controlled-document rule extraction",
        description=(
            "Proposes cited limits, duties, prohibitions, responsibilities and "
            "deadlines from exact controlled-document versions. A gestor must "
            "accept or edit each rule before another application may consume it."
        ),
        supported_external_systems=["STRATOS_PLATFORM"],
        fields=[
            "financial_limit",
            "deadline",
            "obligation",
            "prohibition",
            "responsibility",
            "permission",
            "exception",
        ],
    )


@dataclass(frozen=True)
class _Candidate:
    category: str
    sentence: str
    value: object
    unit: str | None
    currency: str | None
    vat_basis: str
    confidence: float
    match_start: int
    match_end: int


def extract_controlled_rule_proposals(
    *,
    chunks: list[RetrievedChunk],
    max_rules: int = 250,
) -> tuple[list[ControlledRuleProposal], list[str], list[str]]:
    proposals: list[ControlledRuleProposal] = []
    seen: set[str] = set()
    warnings: list[str] = []

    for chunk in chunks:
        for candidate in _candidates(chunk.text):
            identity = _rule_identity(candidate)
            if identity in seen:
                continue
            seen.add(identity)
            proposals.append(_proposal(candidate, chunk, identity))
            if len(proposals) >= max_rules:
                warnings.append("CONTROLLED_RULE_PROPOSAL_LIMIT_REACHED")
                break
        if len(proposals) >= max_rules:
            break

    missing_information: list[str] = []
    if not proposals:
        missing_information.append("NO_CITABLE_CONTROLLED_RULES_FOUND")
    return proposals, missing_information, warnings


def _candidates(text: str) -> list[_Candidate]:
    result: list[_Candidate] = []
    for sentence, sentence_start in _sentences(text):
        normalized = f" {_fold(sentence)} "
        amount_matches = list(_AMOUNT_RE.finditer(sentence))
        for match in amount_matches:
            amount = _decimal_amount(match.group("amount"))
            if amount is None:
                continue
            result.append(
                _Candidate(
                    category="financial_limit",
                    sentence=sentence,
                    value=float(amount) if amount % 1 else int(amount),
                    unit="currency",
                    currency=_currency(match.group("currency")),
                    vat_basis=_vat_basis(sentence),
                    confidence=0.9 if _has_limit_context(normalized) else 0.76,
                    match_start=sentence_start + match.start(),
                    match_end=sentence_start + match.end(),
                )
            )

        for match in _DEADLINE_RE.finditer(sentence):
            result.append(
                _Candidate(
                    category="deadline",
                    sentence=sentence,
                    value=int(match.group("value")),
                    unit=_clean_space(match.group("unit")).lower(),
                    currency=None,
                    vat_basis="not_applicable",
                    confidence=0.86,
                    match_start=sentence_start + match.start(),
                    match_end=sentence_start + match.end(),
                )
            )

        if amount_matches or _DEADLINE_RE.search(sentence):
            continue
        category = next(
            (
                candidate_category
                for candidate_category, markers in _CATEGORY_MARKERS
                if any(marker in normalized for marker in markers)
            ),
            None,
        )
        if category is None:
            continue
        result.append(
            _Candidate(
                category=category,
                sentence=sentence,
                value=_clean_space(sentence),
                unit=None,
                currency=None,
                vat_basis="not_applicable",
                confidence=0.78 if category in {"obligation", "prohibition"} else 0.7,
                match_start=sentence_start,
                match_end=sentence_start + len(sentence),
            )
        )
    return result


def _proposal(
    candidate: _Candidate,
    chunk: RetrievedChunk,
    identity: str,
) -> ControlledRuleProposal:
    sentence = _clean_space(candidate.sentence)
    conditions = [sentence] if _contains_condition(sentence) else []
    exceptions = [sentence] if candidate.category == "exception" else []
    roles = sorted({_clean_space(match.group(0)) for match in _ROLE_RE.finditer(sentence)})
    evidence = sorted({_clean_space(match.group(0)) for match in _EVIDENCE_RE.finditer(sentence)})
    return ControlledRuleProposal(
        rule_id=f"rule:{candidate.category}:{identity[:20]}",
        normative_key=_normative_key(candidate),
        category=candidate.category,  # type: ignore[arg-type]
        title=_title(candidate.category, sentence),
        value=candidate.value,
        unit=candidate.unit,
        currency=candidate.currency,
        vat_basis=candidate.vat_basis,  # type: ignore[arg-type]
        conditions=conditions,
        exceptions=exceptions,
        responsible_roles=roles,
        required_evidence=evidence,
        confidence=candidate.confidence,
        citation=ControlledRuleCitation(
            document_id=chunk.citation.document_id,
            document_version_id=chunk.citation.document_version_id,
            chunk_id=chunk.chunk_id,
            section_path=chunk.citation.section_path,
            page_number=chunk.citation.page_number,
            article_number=chunk.citation.article_number,
            paragraph_number=chunk.citation.paragraph_number,
            quoted_text=sentence[:2000],
        ),
    )


def _sentences(text: str) -> list[tuple[str, int]]:
    result: list[tuple[str, int]] = []
    start = 0
    for position, character in enumerate(text):
        is_numeric_separator = (
            character == "."
            and position > 0
            and position + 1 < len(text)
            and text[position - 1].isdigit()
            and text[position + 1].isdigit()
        )
        if character not in ".!?;\n" or is_numeric_separator:
            continue
        sentence = _clean_space(text[start : position + 1])
        if len(sentence) >= 12:
            result.append((sentence, start))
        start = position + 1
    trailing = _clean_space(text[start:])
    if len(trailing) >= 12:
        result.append((trailing, start))
    return result


def _rule_identity(candidate: _Candidate) -> str:
    canonical = "|".join(
        (
            candidate.category,
            _fold(candidate.sentence),
            str(candidate.value),
            candidate.unit or "",
            candidate.currency or "",
        )
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _normative_key(candidate: _Candidate) -> str:
    subject = _fold(candidate.sentence)
    subject = re.sub(r"\b\d[\d .,\u00a0]*\b", " amount ", subject)
    subject = re.sub(r"[^a-z0-9]+", "-", subject).strip("-")
    digest = hashlib.sha256(subject.encode("utf-8")).hexdigest()[:16]
    return f"{candidate.category}:{digest}"


def _title(category: str, sentence: str) -> str:
    labels = {
        "financial_limit": "Finanční limit",
        "deadline": "Lhůta",
        "obligation": "Povinnost",
        "prohibition": "Zákaz",
        "responsibility": "Odpovědnost",
        "permission": "Oprávnění",
        "exception": "Výjimka",
    }
    excerpt = sentence[:220].rstrip(" .;:")
    return f"{labels.get(category, 'Pravidlo')}: {excerpt}"[:300]


def _decimal_amount(value: str) -> Decimal | None:
    compact = value.replace("\u00a0", "").replace(" ", "").replace(".", "")
    compact = compact.replace(",", ".")
    try:
        return Decimal(compact)
    except InvalidOperation:
        return None


def _currency(value: str) -> str:
    return "CZK" if value.casefold() in {"kč", "czk"} else "EUR"


def _vat_basis(sentence: str) -> str:
    folded = _fold(sentence)
    if "bez dph" in folded:
        return "excluding_vat"
    if "vcetne dph" in folded or "s dph" in folded:
        return "including_vat"
    return "unknown"


def _has_limit_context(normalized: str) -> bool:
    return any(
        marker in normalized
        for marker in (
            " do ",
            " nad ",
            " od ",
            " nejvyse ",
            " mene nez ",
            " limit ",
            " predpokladana hodnota ",
        )
    )


def _contains_condition(sentence: str) -> bool:
    folded = f" {_fold(sentence)} "
    return any(
        marker in folded
        for marker in (" pokud ", " jestlize ", " v pripade ", " za podminky ")
    )


def _fold(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    return _clean_space(
        "".join(character for character in normalized if not unicodedata.combining(character))
    ).casefold()


def _clean_space(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()
