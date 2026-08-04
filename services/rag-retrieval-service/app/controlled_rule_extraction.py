from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass, replace
from decimal import Decimal, InvalidOperation

from app.schemas import (
    ContractExtractionProfile,
    ControlledRuleCitation,
    ControlledRuleProposal,
    RetrievedChunk,
)


PROFILE_NAME = "controlled_document_rules_v1"
PROFILE_VERSION = "3"

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
_RETENTION_RE = re.compile(
    r"\b(?:po\s+dobu|nejméně)\s+(?P<value>\d{1,4})\s+"
    r"(?P<unit>kalendářních\s+dnů|pracovních\s+dnů|dnů|měsíců|let)\b",
    re.IGNORECASE,
)
_SUPPLIER_COUNT_RE = re.compile(
    r"\bnejmene\s+(?P<count>\d+|jednu|jedne|dv[eě]|dvou|tri|ctyri|pet)\s+"
    r"(?:porovnatelnych\s+|cenovych\s+)*(?:nabidek|dodavatelu)\b",
    re.IGNORECASE,
)
_ENUMERATED_CLAUSE_RE = re.compile(r"^[a-z]\)|^\d+[.)]", re.IGNORECASE)
_PUBLIC_PROCUREMENT_LEGAL_CONTEXT = (
    " vzmr ",
    " verejna zakazka maleho rozsahu ",
    " verejnou zakazkou maleho rozsahu ",
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
    (
        "required_document",
        (" písemn", " doklad", " dokumentac", " objednávk", " smlouv"),
    ),
    (
        "audit_evidence",
        (" archiv", " uchov", " evidenc", " průzkum trhu ", " cenové nabíd"),
    ),
    (
        "approval_step",
        (" předběžn", " schválen", " souhlas", " podpis", " kontrola závazku "),
    ),
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
            "required_document",
            "audit_evidence",
            "approval_step",
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
    bound_kind: str | None = None


def extract_controlled_rule_proposals(
    *,
    chunks: list[RetrievedChunk],
    domain: str | None = None,
    max_rules: int = 250,
) -> tuple[list[ControlledRuleProposal], list[str], list[str]]:
    proposals: list[ControlledRuleProposal] = []
    seen: set[str] = set()
    warnings: list[str] = []
    unmapped_candidate_count = 0

    for chunk in chunks:
        for candidate in _candidates(chunk.text):
            normative_key = _normative_key(candidate, domain=domain)
            if normative_key is None:
                unmapped_candidate_count += 1
                continue
            candidate = _canonical_candidate(candidate, normative_key)
            identity = _rule_identity(candidate, normative_key)
            if identity in seen:
                continue
            seen.add(identity)
            proposals.append(_proposal(candidate, chunk, identity, normative_key))
            if len(proposals) >= max_rules:
                warnings.append("CONTROLLED_RULE_PROPOSAL_LIMIT_REACHED")
                break
        if len(proposals) >= max_rules:
            break

    missing_information: list[str] = []
    if not proposals:
        missing_information.append("NO_CITABLE_CONTROLLED_RULES_FOUND")
    if unmapped_candidate_count:
        warnings.append("CONTROLLED_RULE_UNMAPPED_CANDIDATES_SKIPPED")
    return proposals, missing_information, warnings


def _candidates(text: str) -> list[_Candidate]:
    result: list[_Candidate] = []
    sentences = _sentences(text)
    for index, (sentence, sentence_start) in enumerate(sentences):
        if _is_noise(sentence):
            continue
        normalized = f" {_fold(sentence)} "
        amount_matches = list(_AMOUNT_RE.finditer(sentence))
        for match in amount_matches:
            amount = _decimal_amount(match.group("amount"))
            if amount is None:
                continue
            cited_sentence = _financial_context(sentences, index)
            result.append(
                _Candidate(
                    category="financial_limit",
                    sentence=cited_sentence,
                    value=float(amount) if amount % 1 else int(amount),
                    unit="currency",
                    currency=_currency(match.group("currency")),
                    vat_basis=_vat_basis(cited_sentence),
                    confidence=0.9 if _has_limit_context(normalized) else 0.76,
                    match_start=sentence_start + match.start(),
                    match_end=sentence_start + match.end(),
                    bound_kind=_bound_kind(sentence, match.start()),
                )
            )

        deadline_matches = [
            *_DEADLINE_RE.finditer(sentence),
            *_RETENTION_RE.finditer(sentence),
        ]
        for match in deadline_matches:
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

        count_match = _SUPPLIER_COUNT_RE.search(_fold(sentence))
        if count_match:
            result.append(
                _Candidate(
                    category="condition",
                    sentence=sentence,
                    value=_supplier_count(count_match.group("count")),
                    unit="count",
                    currency=None,
                    vat_basis="not_applicable",
                    confidence=0.9,
                    match_start=sentence_start,
                    match_end=sentence_start + len(sentence),
                )
            )

        if amount_matches or deadline_matches or count_match:
            continue
        category = next(
            (
                candidate_category
                for candidate_category, markers in _CATEGORY_MARKERS
                if any(f" {_fold(marker)} " in normalized for marker in markers)
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
    normative_key: str,
) -> ControlledRuleProposal:
    sentence = _clean_space(candidate.sentence)
    conditions = [sentence] if _contains_condition(sentence) else []
    exceptions = [sentence] if candidate.category == "exception" else []
    roles = sorted({_clean_space(match.group(0)) for match in _ROLE_RE.finditer(sentence)})
    evidence = sorted({_clean_space(match.group(0)) for match in _EVIDENCE_RE.finditer(sentence)})
    return ControlledRuleProposal(
        rule_id=f"rule:{candidate.category}:{identity[:20]}",
        normative_key=normative_key,
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
        is_roman_ordinal = (
            character == "."
            and position > 0
            and text[position - 1] in "IVX"
            and position + 1 < len(text)
            and text[position + 1].isspace()
        )
        if character not in ".!?;\n" or is_numeric_separator or is_roman_ordinal:
            continue
        sentence = _clean_space(text[start : position + 1])
        if len(sentence) >= 12:
            result.append((sentence, start))
        start = position + 1
    trailing = _clean_space(text[start:])
    if len(trailing) >= 12:
        result.append((trailing, start))
    return result


def _rule_identity(candidate: _Candidate, normative_key: str) -> str:
    canonical = "|".join(
        (
            normative_key,
            candidate.category,
            _fold(candidate.sentence),
            str(candidate.value),
            candidate.unit or "",
            candidate.currency or "",
        )
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _normative_key(candidate: _Candidate, *, domain: str | None) -> str | None:
    if domain == "public_procurement":
        return _public_procurement_normative_key(candidate)
    subject = _fold(candidate.sentence)
    subject = re.sub(r"\b\d[\d .,\u00a0]*\b", " amount ", subject)
    subject = re.sub(r"[^a-z0-9]+", "-", subject).strip("-")
    digest = hashlib.sha256(subject.encode("utf-8")).hexdigest()[:16]
    return f"{candidate.category}:{digest}"


def _public_procurement_normative_key(candidate: _Candidate) -> str | None:
    sentence = f" {_fold(candidate.sentence)} "
    if candidate.category == "financial_limit":
        if any(marker in sentence for marker in (" dodatku ", " dodatek ")) and " schval" in sentence:
            return "public_procurement.contract.amendment.approval_threshold"
        if " pruzkum trhu" in sentence or (
            " cenov" in sentence and " nabid" in sentence
        ):
            return "public_procurement.market_research.threshold"
        if " trzist" in sentence:
            return "public_procurement.marketplace.threshold"
        if " centralni evidenc" in sentence:
            return "public_procurement.central_evidence.threshold"
        if " registru smluv" in sentence:
            return "public_procurement.publication.contract_register.threshold"
        if " profilu zadavatele" in sentence or " 219 zzvz" in sentence:
            return "public_procurement.publication.contracting_profile.threshold"
        if " pisemn" in sentence and " smlouv" in sentence:
            return "public_procurement.contract.written_form.threshold"
        if " 1. kategorie" in sentence or " i. kategorie" in sentence:
            return "public_procurement.internal_category_1.upper_threshold"
        if (
            " 2. kategorie" in sentence or " ii. kategorie" in sentence
        ) and candidate.bound_kind == "lower":
            return None
        if " vzmr " in sentence or " maleho rozsahu " in sentence:
            if " staveb" in sentence:
                return "public_procurement.vzmr.works.threshold"
            return "public_procurement.vzmr.supplies_services.threshold"
        if (
            " prim" in sentence and " nakup" in sentence
            or " nakup do " in sentence
            or " objednavk" in sentence
        ):
            return "public_procurement.direct_purchase.threshold"
        return None
    if candidate.category == "condition" and candidate.unit == "count":
        return "public_procurement.supplier_quotes.minimum_count"
    if candidate.category == "deadline" and any(
        marker in sentence for marker in (" uchov", " archiv", " skart")
    ):
        return "public_procurement.retention.period"
    if " nen " in sentence or " narodni elektronick" in sentence:
        return "public_procurement.nen.registration.required"
    if candidate.category == "approval_step":
        return "public_procurement.approval.workflow"
    if candidate.category == "exception":
        return "public_procurement.exception.conditions"
    if candidate.category in {"required_document", "audit_evidence"}:
        return "public_procurement.documentation.required"
    return None


def _canonical_candidate(candidate: _Candidate, normative_key: str) -> _Candidate:
    category_by_key = {
        "public_procurement.approval.workflow": "approval_step",
        "public_procurement.documentation.required": "required_document",
    }
    category = category_by_key.get(normative_key)
    return replace(candidate, category=category) if category else candidate


def _supplier_count(value: str) -> int:
    folded = _fold(value)
    words = {
        "jednu": 1,
        "jedne": 1,
        "dve": 2,
        "dvou": 2,
        "tri": 3,
        "ctyri": 4,
        "pet": 5,
    }
    return int(folded) if folded.isdigit() else words[folded]


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
        for marker in (
            " pokud ",
            " jestlize ",
            " v pripade ",
            " za podminky ",
            " do ",
            " nad ",
            " vyssi nez ",
            " presahne-li ",
            " nepresahne ",
        )
    )


def _bound_kind(sentence: str, match_start: int) -> str | None:
    prefix = f" {_fold(sentence[max(0, match_start - 80):match_start])} "
    lower_position = max(
        (
            prefix.rfind(marker)
            for marker in (" vyssi nez ", " nad ", " presahuje ", " presahujici ")
        ),
        default=-1,
    )
    upper_position = max(
        (
            prefix.rfind(marker)
            for marker in (
                " do ",
                " nizsi nebo rovna ",
                " rovna nebo nizsi ",
                " nejvyse ",
                " nepresahuje ",
            )
        ),
        default=-1,
    )
    if lower_position >= 0 or upper_position >= 0:
        return "upper" if upper_position > lower_position else "lower"
    return None


def _financial_context(
    sentences: list[tuple[str, int]],
    index: int,
) -> str:
    """Keep the threshold together with its immediate duty or exception."""

    current = sentences[index][0]
    parts = [current]
    folded_current = f" {_fold(current)} "
    if (
        _ENUMERATED_CLAUSE_RE.match(current)
        and any(
            marker in folded_current
            for marker in (" dodavk", " sluzb", " stavebn")
        )
    ):
        # Official legal PDFs often put the introductory sentence and each
        # lettered alternative on separate lines. Preserve the nearest legal
        # heading, while skipping sibling amount clauses so their values and
        # subject types cannot bleed into one another.
        for offset in range(1, 5):
            previous_index = index - offset
            if previous_index < 0:
                break
            previous = sentences[previous_index][0]
            if _AMOUNT_RE.search(previous):
                continue
            folded_previous = f" {_fold(previous)} "
            if any(marker in folded_previous for marker in _PUBLIC_PROCUREMENT_LEGAL_CONTEXT):
                parts.insert(0, previous)
                break
    for offset in (1, 2):
        next_index = index + offset
        if next_index >= len(sentences):
            break
        candidate = sentences[next_index][0]
        folded = f" {_fold(candidate)} "
        if _is_noise(candidate) or _AMOUNT_RE.search(candidate):
            break
        if not any(
            marker in folded
            for marker in (
                " musí ",
                " je povinen ",
                " provede ",
                " zajisti ",
                " uchova ",
                " archivuje ",
                " doklada ",
                " neni-li ",
                " pokud ",
                " v pripade ",
                " cenove nabidky ",
                " pruzkum trhu ",
            )
        ):
            break
        parts.append(candidate)
    return _clean_space(" ".join(parts))[:2000]


def _is_noise(sentence: str) -> bool:
    folded = f" {_fold(sentence)} "
    if sentence.count("|") >= 2:
        return True
    if " lze obecne povazovat " in folded or " pro ucely teto smernice se rozumi " in folded:
        return True
    words = re.findall(r"[a-zá-ž0-9]+", sentence.casefold())
    if len(words) < 4:
        return True
    return False


def _fold(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    return _clean_space(
        "".join(character for character in normalized if not unicodedata.combining(character))
    ).casefold()


def _clean_space(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()
