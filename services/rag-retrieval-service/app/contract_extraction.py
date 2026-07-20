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
PROFILE_VERSION_V1 = "1"
PROFILE_VERSION_V2 = "2"
PROFILE_VERSION = PROFILE_VERSION_V2

CONTRACT_FINANCIAL_FIELDS_V2 = [
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
    "payment_rules",
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

CONTRACT_FINANCIAL_FIELDS_V1 = [
    *CONTRACT_FINANCIAL_FIELDS_V2[:13],
    "payment_frequency",
    "recurring_amount",
    "one_time_amount",
    "payment_schedule",
    *CONTRACT_FINANCIAL_FIELDS_V2[14:],
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
    profiles = [
        ContractExtractionProfile(
            profile=PROFILE_NAME,
            profile_version=PROFILE_VERSION_V2,
            title="Contract financial extraction with payment rules",
            description=(
                "Proposes cited structured contract parameters for Budget & Contract. "
                "Version 2 returns typed, fail-closed payment rules; source applications own final writes."
            ),
            supported_external_systems=["STRATOS_BUDGET"],
            fields=CONTRACT_FINANCIAL_FIELDS_V2,
        ),
        ContractExtractionProfile(
            profile=PROFILE_NAME,
            profile_version=PROFILE_VERSION_V1,
            title="Contract financial extraction",
            description=(
                "Stable version 1 contract extraction retained for deployment compatibility. "
                "New integrations should request version 2 payment rules."
            ),
            supported_external_systems=["STRATOS_BUDGET"],
            fields=CONTRACT_FINANCIAL_FIELDS_V1,
        ),
    ]
    return sorted(profiles, key=lambda profile: profile.profile_version)


def extract_contract_financial_proposals(
    *,
    chunks: list[RetrievedChunk],
    profile_version: str = PROFILE_VERSION_V2,
) -> tuple[list[ContractFieldProposal], list[str], list[str]]:
    if profile_version not in {PROFILE_VERSION_V1, PROFILE_VERSION_V2}:
        raise ValueError(f"Unsupported contract extraction profile version: {profile_version}")
    proposals: list[ContractFieldProposal] = []
    seen_fields: set[str] = set()

    for chunk in chunks:
        for spec in _pattern_specs(profile_version=profile_version):
            if spec.field in seen_fields:
                continue
            match = spec.pattern.search(chunk.text)
            if match is None:
                continue
            value = _clean_value(str(match.group(spec.value_group)))
            if not value:
                continue
            unit = _clean_value(match.group(spec.unit_from_group)) if spec.unit_from_group and match.groupdict().get(spec.unit_from_group) else None
            normalized = spec.normalizer(value) if spec.normalizer else value
            if spec.normalizer is not None and normalized is None:
                continue
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

    if profile_version == PROFILE_VERSION_V2:
        payment_rules = _payment_rules(chunks)
        if payment_rules and "payment_rules" not in seen_fields:
            proposals.append(payment_rules)
            seen_fields.add("payment_rules")
    else:
        payment_schedule = _payment_schedule_v1(chunks)
        if payment_schedule and "payment_schedule" not in seen_fields:
            proposals.append(payment_schedule)
            seen_fields.add("payment_schedule")

    missing_information = sorted(REQUIRED_FIELDS - seen_fields)
    warnings: list[str] = []
    if not proposals:
        warnings.append("INSUFFICIENT_CITABLE_CONTRACT_EVIDENCE")
    if missing_information:
        warnings.append("MISSING_REQUIRED_CONTRACT_FIELDS")
    return proposals, missing_information, warnings


def _pattern_specs(*, profile_version: str) -> list[PatternSpec]:
    specs = [
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
            pattern=re.compile(
                r"(?:splatnost|due\s+date)[^0-9]{0,50}(\d{1,3})"
                r"(?:\s*\([^)]{0,80}\))?\s*(?:dn[uůy]?|days)",
                re.IGNORECASE,
            ),
            reason="Payment due date was found in the cited source.",
            confidence="high",
            unit_from_group=None,
            normalizer=_normalize_due_days,
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
    if profile_version == PROFILE_VERSION_V1:
        payment_due_index = next(
            index
            for index, spec in enumerate(specs)
            if spec.field == "payment_due_days"
        )
        specs[payment_due_index + 1 : payment_due_index + 1] = _payment_pattern_specs_v1()
    return specs


def _payment_pattern_specs_v1() -> list[PatternSpec]:
    return [
        PatternSpec(
            field="payment_frequency",
            pattern=re.compile(
                r"(měsíčně|mesicne|čtvrtletně|ctvrtletne|ročně|rocne|monthly|quarterly|annually)",
                re.IGNORECASE,
            ),
            reason="Payment frequency keyword was found in the cited source.",
            normalizer=_normalize_frequency,
        ),
        PatternSpec(
            field="recurring_amount",
            pattern=re.compile(
                r"(?:měsíční|mesicni|pauš[aá]l|pausal|recurring)[^.\n]{0,100}?"
                r"(?P<value>[0-9][0-9\s.,]*)\s*(?P<unit>Kč|CZK|EUR)",
                re.IGNORECASE,
            ),
            reason="Recurring amount was found in the cited source.",
            unit_from_group="unit",
            normalizer=_normalize_number,
            value_group="value",
        ),
        PatternSpec(
            field="one_time_amount",
            pattern=re.compile(
                r"(?:jednor[aá]zov[aá]|one[- ]time)[^.\n]{0,100}?"
                r"(?P<value>[0-9][0-9\s.,]*)\s*(?P<unit>Kč|CZK|EUR)",
                re.IGNORECASE,
            ),
            reason="One-time amount was found in the cited source.",
            unit_from_group="unit",
            normalizer=_normalize_number,
            value_group="value",
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


@dataclass(frozen=True)
class PaymentRuleSpec:
    rule_type: str
    periodicity_months: int | None
    payment_timing: str
    pattern: re.Pattern[str]
    amount_basis: str
    generates_cashflow: bool = True
    is_call_off: bool = False


def _payment_schedule_v1(chunks: list[RetrievedChunk]) -> ContractFieldProposal | None:
    schedule_items: list[dict[str, Any]] = []
    first_chunk: RetrievedChunk | None = None
    first_match: re.Match[str] | None = None
    pattern = re.compile(
        r"(měsíčně|mesicne|čtvrtletně|ctvrtletne|ročně|rocne|monthly|quarterly|annually)"
        r"[^.\n]{0,80}?(?P<value>[0-9][0-9\s.,]*)\s*(?P<unit>Kč|CZK|EUR)",
        re.IGNORECASE,
    )
    for chunk in chunks:
        for match in pattern.finditer(chunk.text):
            frequency = _clean_value(match.group(1))
            amount = _clean_value(match.group("value"))
            currency = _clean_value(match.group("unit"))
            normalized_amount = _normalize_number(amount)
            if normalized_amount is None:
                continue
            schedule_items.append(
                {
                    "frequency": frequency,
                    "normalized_frequency": _normalize_frequency(frequency),
                    "amount": normalized_amount,
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


def _payment_rule_specs() -> list[PaymentRuleSpec]:
    amount = r"(?P<value>[0-9][0-9\s.,]*)\s*(?P<unit>Kč|CZK|EUR)"
    rules = [
        PaymentRuleSpec(
            rule_type="MONTHLY",
            periodicity_months=1,
            payment_timing="UNSPECIFIED",
            pattern=re.compile(
                rf"(?:měsíčně|mesicne|měsíční|mesicni|každý\s+měsíc|kazdy\s+mesic|monthly)"
                rf"[^.\n;]{{0,120}}?{amount}",
                re.IGNORECASE,
            ),
            amount_basis="PER_PERIOD",
        ),
        PaymentRuleSpec(
            rule_type="QUARTERLY",
            periodicity_months=3,
            payment_timing="UNSPECIFIED",
            pattern=re.compile(
                rf"(?:čtvrtletně|ctvrtletne|čtvrtletní|ctvrtletni|quarterly)"
                rf"[^.\n;]{{0,120}}?{amount}",
                re.IGNORECASE,
            ),
            amount_basis="PER_PERIOD",
        ),
        PaymentRuleSpec(
            rule_type="HALF_YEARLY",
            periodicity_months=6,
            payment_timing="UNSPECIFIED",
            pattern=re.compile(
                rf"(?:pololetně|pololetne|pololetní|pololetni|každých\s+šest\s+měsíců|semi[- ]?annually)"
                rf"[^.\n;]{{0,120}}?{amount}",
                re.IGNORECASE,
            ),
            amount_basis="PER_PERIOD",
        ),
        PaymentRuleSpec(
            rule_type="YEARLY",
            periodicity_months=12,
            payment_timing="UNSPECIFIED",
            pattern=re.compile(
                rf"(?:ročně|rocne|roční|rocni|každý\s+rok|kazdy\s+rok|annually|yearly)"
                rf"[^.\n;]{{0,120}}?{amount}",
                re.IGNORECASE,
            ),
            amount_basis="PER_PERIOD",
        ),
        PaymentRuleSpec(
            rule_type="ONE_OFF",
            periodicity_months=None,
            payment_timing="UNSPECIFIED",
            pattern=re.compile(
                rf"(?:jednorázově|jednorazove|jednorázová|jednorazova|jednorázový|jednorazovy|one[- ]time)"
                rf"[^.\n;]{{0,140}}?{amount}",
                re.IGNORECASE,
            ),
            amount_basis="ONE_OFF",
        ),
        PaymentRuleSpec(
            rule_type="ACCEPTANCE",
            periodicity_months=None,
            payment_timing="ON_ACCEPTANCE",
            pattern=re.compile(
                rf"(?:po\s+(?:řádné\s+)?(?:akceptaci|převzetí|prevzeti)|akceptačního\s+protokolu)"
                rf"[^.\n;]{{0,160}}?{amount}",
                re.IGNORECASE,
            ),
            amount_basis="ONE_OFF",
        ),
        PaymentRuleSpec(
            rule_type="MILESTONE",
            periodicity_months=None,
            payment_timing="ON_MILESTONE",
            pattern=re.compile(
                rf"(?:milník|milnik|dílčí\s+plnění|dilci\s+plneni|etapa)"
                rf"[^.\n;]{{0,160}}?{amount}",
                re.IGNORECASE,
            ),
            amount_basis="ONE_OFF",
        ),
        PaymentRuleSpec(
            rule_type="TIME_AND_MATERIAL",
            periodicity_months=None,
            payment_timing="UNSPECIFIED",
            pattern=re.compile(
                rf"(?:time\s+and\s+material|člověkoden|clovekoden|člověkohodina|clovekohodina|hodinová\s+sazba)"
                rf"[^.\n;]{{0,140}}?{amount}",
                re.IGNORECASE,
            ),
            amount_basis="UNIT_PRICE",
            generates_cashflow=False,
        ),
    ]
    # Amount-first recurring clauses are safe only when the amount is explicitly
    # described as a recurring flat fee. Generic "price/amount/payment" wording
    # also occurs in clauses where a total contract price is merely invoiced in
    # instalments and must not be treated as the amount of every period.
    amount_first_prefix = r"(?:pauš[aá]l(?:n[ií]\s+(?:cena|částka|castka))?)"
    for rule_type, periodicity_months, frequency in [
        (
            "MONTHLY",
            1,
            r"(?:měsíčně|mesicne|měsíční|mesicni|monthly|"
            r"za\s+(?:jeden|každý)\s+(?:kalendářní\s+)?měsíc)",
        ),
        (
            "QUARTERLY",
            3,
            r"(?:čtvrtletně|ctvrtletne|čtvrtletní|ctvrtletni|quarterly|"
            r"za\s+(?:jedno|každé)\s+(?:kalendářní\s+)?čtvrtletí)",
        ),
        (
            "HALF_YEARLY",
            6,
            r"(?:pololetně|pololetne|pololetní|pololetni|semi[- ]?annually|"
            r"za\s+(?:jedno|každé)\s+pololetí)",
        ),
        (
            "YEARLY",
            12,
            r"(?:ročně|rocne|roční|rocni|annually|yearly|"
            r"za\s+(?:jeden|každý)\s+(?:kalendářní\s+)?rok)",
        ),
    ]:
        rules.append(
            PaymentRuleSpec(
                rule_type=rule_type,
                periodicity_months=periodicity_months,
                payment_timing="UNSPECIFIED",
                pattern=re.compile(
                    rf"{amount_first_prefix}[^.\n;]{{0,80}}?{amount}"
                    rf"[^.\n;]{{0,100}}?{frequency}",
                    re.IGNORECASE,
                ),
                amount_basis="PER_PERIOD",
            )
        )
    return rules


def _payment_rules(chunks: list[RetrievedChunk]) -> ContractFieldProposal | None:
    rules: list[dict[str, Any]] = []
    seen: set[tuple[str, float | int | None, str | None, str, int | str]] = set()
    first_chunk: RetrievedChunk | None = None
    first_match: re.Match[str] | None = None
    due_days, terms_citation = _payment_terms(chunks)

    for chunk in chunks:
        for spec in _payment_rule_specs():
            for match in spec.pattern.finditer(chunk.text):
                value = _normalize_number(_clean_value(match.group("value")))
                currency = _normalized_currency(_clean_value(match.group("unit")))
                key = (spec.rule_type, value, currency, chunk.chunk_id, match.start())
                if key in seen:
                    continue
                seen.add(key)
                citation = _citation_from_match(chunk, match)
                context = citation.quoted_text
                payment_timing = _payment_timing(context, spec.payment_timing)
                due_date = _explicit_due_date_from_text(context)
                if due_date is not None and spec.rule_type == "ONE_OFF":
                    payment_timing = "FIXED_DATE"
                variable_drawdown = _variable_drawdown_pattern().search(context) is not None
                ambiguous_total = (
                    spec.periodicity_months is not None
                    and _is_ambiguous_total_amount_context(context)
                )
                generates_cashflow = (
                    spec.generates_cashflow
                    and not variable_drawdown
                    and not ambiguous_total
                    and payment_timing not in {"ON_CALL", "UNSPECIFIED"}
                    and (
                        payment_timing not in {"FIXED_DATE", "ON_ACCEPTANCE", "ON_MILESTONE"}
                        or due_date is not None
                    )
                )
                rules.append(
                    {
                        "rule_type": spec.rule_type,
                        "name": _payment_rule_name(spec.rule_type),
                        "amount": value,
                        "amount_basis": spec.amount_basis,
                        "vat_basis": _vat_basis(_context_around_match(chunk.text, match)),
                        "currency": currency,
                        "periodicity_months": spec.periodicity_months,
                        "payment_timing": payment_timing,
                        **({"due_date": due_date} if due_date is not None else {}),
                        "payment_terms_days": due_days,
                        "is_call_off": spec.is_call_off,
                        "generates_cashflow": generates_cashflow,
                        "requires_confirmation": True,
                        "citation": citation.model_dump(mode="json"),
                        **(
                            {"payment_terms_citation": terms_citation.model_dump(mode="json")}
                            if terms_citation is not None
                            else {}
                        ),
                    }
                )
                first_chunk = first_chunk or chunk
                first_match = first_match or match

        for clause in _payment_clause_specs():
            for match in clause.pattern.finditer(chunk.text):
                citation = _citation_from_match(chunk, match)
                if _has_rule_for_clause(rules, clause.rule_type, chunk.chunk_id, citation.quoted_text):
                    continue
                rules.append(
                    {
                        "rule_type": clause.rule_type,
                        "name": _payment_rule_name(clause.rule_type),
                        "amount": None,
                        "amount_basis": clause.amount_basis,
                        "vat_basis": "UNSPECIFIED",
                        "currency": None,
                        "periodicity_months": clause.periodicity_months,
                        "payment_timing": _payment_timing(citation.quoted_text, clause.payment_timing),
                        "payment_terms_days": due_days,
                        "is_call_off": False,
                        "generates_cashflow": False,
                        "requires_confirmation": True,
                        "citation": citation.model_dump(mode="json"),
                        **(
                            {"payment_terms_citation": terms_citation.model_dump(mode="json")}
                            if terms_citation is not None
                            else {}
                        ),
                    }
                )
                first_chunk = first_chunk or chunk
                first_match = first_match or match

        for match in _dated_installment_pattern().finditer(chunk.text):
            value = _normalize_number(_clean_value(match.group("value")))
            currency = _normalized_currency(_clean_value(match.group("unit")))
            key = ("MILESTONE", value, currency, chunk.chunk_id, match.start())
            if key in seen:
                continue
            seen.add(key)
            citation = _citation_from_match(chunk, match)
            rules.append(
                {
                    "rule_type": "MILESTONE",
                    "name": _payment_rule_name("MILESTONE"),
                    "amount": value,
                    "amount_basis": "ONE_OFF",
                    "vat_basis": _vat_basis(_context_around_match(chunk.text, match)),
                    "currency": currency,
                    "periodicity_months": None,
                    "payment_timing": "FIXED_DATE",
                    "due_date": _normalize_date(_clean_value(match.group("due_date"))),
                    "payment_terms_days": due_days,
                    "is_call_off": False,
                    "generates_cashflow": True,
                    "requires_confirmation": True,
                    "citation": citation.model_dump(mode="json"),
                    **(
                        {"payment_terms_citation": terms_citation.model_dump(mode="json")}
                        if terms_citation is not None
                        else {}
                    ),
                }
            )
            first_chunk = first_chunk or chunk
            first_match = first_match or match

        for match in _variable_drawdown_pattern().finditer(chunk.text):
            rule_type = "TIME_AND_MATERIAL" if _looks_like_time_and_material(match.group(0)) else "CALL_OFF"
            citation = _citation_from_match(chunk, match)
            key = (rule_type, None, None, chunk.chunk_id, citation.quoted_text)
            if key in seen:
                continue
            seen.add(key)
            rules.append(
                {
                    "rule_type": rule_type,
                    "name": _payment_rule_name(rule_type),
                    "amount": None,
                    "amount_basis": "VARIABLE_DRAWDOWN",
                    "vat_basis": "UNSPECIFIED",
                    "currency": None,
                    "periodicity_months": None,
                    "payment_timing": "ON_CALL" if rule_type == "CALL_OFF" else "UNSPECIFIED",
                    "payment_terms_days": due_days,
                    "is_call_off": rule_type == "CALL_OFF",
                    "generates_cashflow": False,
                    "requires_confirmation": True,
                    "citation": citation.model_dump(mode="json"),
                    **(
                        {"payment_terms_citation": terms_citation.model_dump(mode="json")}
                        if terms_citation is not None
                        else {}
                    ),
                }
            )
            first_chunk = first_chunk or chunk
            first_match = first_match or match

    rules = _deduplicate_payment_rules(rules)
    if not rules or first_chunk is None or first_match is None:
        return None
    return ContractFieldProposal(
        field="payment_rules",
        proposed_value=rules,
        normalized_value=rules,
        confidence="medium",
        reason=(
            "Cited payment clauses were normalized into independent proposed rules. "
            "Every rule requires confirmation in Budget before it can generate cashflow."
        ),
        citation=_citation_from_match(first_chunk, first_match),
        warnings=["HUMAN_CONFIRMATION_REQUIRED"],
    )


def _dated_installment_pattern() -> re.Pattern[str]:
    return re.compile(
        r"(?P<value>[0-9][0-9\s.,]*)\s*(?P<unit>Kč|CZK|EUR)"
        r"[^.\n;]{0,90}?(?:splatn[aá]\s+dne|splatn[aá]\s+k|uhradit\s+do)"
        r"\s*(?P<due_date>\d{1,2}\.\s*\d{1,2}\.\s*\d{4}|\d{4}-\d{2}-\d{2})",
        re.IGNORECASE,
    )


def _payment_clause_specs() -> list[PaymentRuleSpec]:
    return [
        PaymentRuleSpec(
            rule_type="MONTHLY",
            periodicity_months=1,
            payment_timing="UNSPECIFIED",
            pattern=re.compile(
                r"\b(?:měsíčně|mesicne|měsíční|mesicni|monthly|"
                r"za\s+každý\s+(?:ukončený\s+)?měsíc|za\s+kazdy\s+(?:ukonceny\s+)?mesic)\b",
                re.IGNORECASE,
            ),
            amount_basis="PER_PERIOD",
            generates_cashflow=False,
        ),
        PaymentRuleSpec(
            rule_type="QUARTERLY",
            periodicity_months=3,
            payment_timing="UNSPECIFIED",
            pattern=re.compile(r"\b(?:čtvrtletně|ctvrtletne|čtvrtletní|ctvrtletni|quarterly)\b", re.IGNORECASE),
            amount_basis="PER_PERIOD",
            generates_cashflow=False,
        ),
        PaymentRuleSpec(
            rule_type="HALF_YEARLY",
            periodicity_months=6,
            payment_timing="UNSPECIFIED",
            pattern=re.compile(r"\b(?:pololetně|pololetne|pololetní|pololetni|semi[- ]?annually)\b", re.IGNORECASE),
            amount_basis="PER_PERIOD",
            generates_cashflow=False,
        ),
        PaymentRuleSpec(
            rule_type="YEARLY",
            periodicity_months=12,
            payment_timing="UNSPECIFIED",
            pattern=re.compile(
                r"\b(?:ročně|rocne|roční|rocni|annually|yearly|"
                r"za\s+každý\s+(?:ukončený\s+)?rok|za\s+kazdy\s+(?:ukonceny\s+)?rok)\b",
                re.IGNORECASE,
            ),
            amount_basis="PER_PERIOD",
            generates_cashflow=False,
        ),
        PaymentRuleSpec(
            rule_type="ACCEPTANCE",
            periodicity_months=None,
            payment_timing="ON_ACCEPTANCE",
            pattern=re.compile(
                r"(?:oprávněn\s+fakturovat|opravnen\s+fakturovat|cenu[^.;]{0,80}hradit|fakturace)"
                r"[^.;]{0,220}(?:akceptační|akceptacni|akceptaci|převzetí|prevzeti)",
                re.IGNORECASE,
            ),
            amount_basis="ONE_OFF",
            generates_cashflow=False,
        ),
    ]


def _variable_drawdown_pattern() -> re.Pattern[str]:
    return re.compile(
        r"(?:dle\s+skutečn[eé]ho\s+čerpání|dle\s+skutecneho\s+cerpani|"
        r"na\s+základě\s+dílčích\s+objednávek|na\s+zaklade\s+dilcich\s+objednavek|"
        r"na\s+výzvu\s+objednatele|na\s+vyzvu\s+objednatele|"
        r"bez\s+garantovan[eé]ho\s+odběru|bez\s+garantovaneho\s+odberu|"
        r"time\s+and\s+material|člověkoden|clovekoden|člověkohodina|clovekohodina)",
        re.IGNORECASE,
    )


def _payment_terms(chunks: list[RetrievedChunk]) -> tuple[int | None, ContractExtractionCitation | None]:
    pattern = re.compile(
        r"(?:splatnost|due\s+date)[^0-9]{0,50}(\d{1,3})"
        r"(?:\s*\([^)]{0,80}\))?\s*(?:dn[uůy]?|days)",
        re.IGNORECASE,
    )
    for chunk in chunks:
        match = pattern.search(chunk.text)
        if match is not None:
            due_days = _normalize_due_days(match.group(1))
            if due_days is not None:
                return due_days, _citation_from_match(chunk, match)
    return None, None


def _payment_timing(text: str, default: str) -> str:
    normalized = _ascii_text(text)
    if re.search(r"\b(zaloh|predem|advance)\w*", normalized):
        return "ADVANCE"
    if re.search(r"\b(zpetne|po skonceni|arrears)\b", normalized):
        return "ARREARS"
    return default


def _explicit_due_date_from_text(text: str) -> str | None:
    date_value = r"(?P<due_date>\d{1,2}\.\s*\d{1,2}\.\s*\d{4}|\d{4}-\d{2}-\d{2})"
    match = re.search(
        rf"(?:splatn[aá]\s+(?:dne|k)|uhradit\s+do|payment\s+due(?:\s+on)?)\s*{date_value}",
        text,
        re.IGNORECASE,
    )
    if match is None:
        return None
    return _normalize_date(match.group("due_date"))


def _is_ambiguous_total_amount_context(text: str) -> bool:
    normalized = _ascii_text(text)
    if not re.search(
        r"\b(?:celkova|celkem|maximalni|nejvyssi|nepresahne|neprekroci)"
        r"(?:\s+\w+){0,3}\s+(?:cena|castka|hodnota)\b",
        normalized,
    ):
        return False
    return not bool(
        re.search(
            r"\b(?:mesicni|ctvrtletni|pololetni|rocni)\s+"
            r"(?:pausal|platba|castka|cena)\b|\bpausal(?:ni)?\b",
            normalized,
        )
    )


def _context_around_match(text: str, match: re.Match[str], radius: int = 100) -> str:
    return text[max(0, match.start() - radius) : min(len(text), match.end() + radius)]


def _vat_basis(text: str) -> str:
    normalized = _ascii_text(text)
    without_vat = bool(re.search(r"\bbez\s+dph\b|\bwithout\s+vat\b", normalized))
    with_vat = bool(
        re.search(
            r"\bvcetne\s+dph\b|\bs\s+dph\b|\bwith\s+vat\b|\bincluding\s+vat\b",
            normalized,
        )
    )
    if without_vat == with_vat:
        return "UNSPECIFIED"
    return "WITHOUT_VAT" if without_vat else "WITH_VAT"


def _payment_rule_name(rule_type: str) -> str:
    return {
        "MONTHLY": "Měsíční platba",
        "QUARTERLY": "Čtvrtletní platba",
        "HALF_YEARLY": "Pololetní platba",
        "YEARLY": "Roční platba",
        "ONE_OFF": "Jednorázová platba",
        "ACCEPTANCE": "Platba po akceptaci",
        "MILESTONE": "Milníková platba",
        "TIME_AND_MATERIAL": "Čerpání podle skutečnosti",
        "CALL_OFF": "Čerpání na objednávku",
    }.get(rule_type, "Platební pravidlo")


def _looks_like_time_and_material(text: str) -> bool:
    return bool(re.search(r"time\s+and\s+material|clovekoden|clovekohodina", _ascii_text(text)))


def _normalized_currency(value: str) -> str:
    return "CZK" if value.casefold() in {"kč", "czk"} else value.upper()


def _has_rule_for_clause(rules: list[dict[str, Any]], rule_type: str, chunk_id: str, quoted_text: str) -> bool:
    return any(
        rule.get("rule_type") == rule_type
        and isinstance(rule.get("citation"), dict)
        and rule["citation"].get("chunk_id") == chunk_id
        and rule["citation"].get("quoted_text") == quoted_text
        for rule in rules
    )


def _deduplicate_payment_rules(rules: list[dict[str, Any]]) -> list[dict[str, Any]]:
    priorities = {
        "ACCEPTANCE": 5,
        "MILESTONE": 4,
        "ONE_OFF": 3,
        "TIME_AND_MATERIAL": 2,
        "CALL_OFF": 1,
    }
    result: list[dict[str, Any]] = []
    positions: dict[tuple[Any, ...], int] = {}
    for rule in rules:
        citation = rule.get("citation") if isinstance(rule.get("citation"), dict) else {}
        key = (
            rule.get("amount"),
            rule.get("currency"),
            citation.get("chunk_id"),
            citation.get("quoted_text"),
        )
        existing_position = positions.get(key)
        if existing_position is None:
            positions[key] = len(result)
            result.append(rule)
            continue
        existing = result[existing_position]
        existing_score = (
            priorities.get(str(existing.get("rule_type")), 0),
            int(existing.get("payment_timing") in {"ON_ACCEPTANCE", "ON_MILESTONE"}),
            int(bool(existing.get("due_date"))),
        )
        candidate_score = (
            priorities.get(str(rule.get("rule_type")), 0),
            int(rule.get("payment_timing") in {"ON_ACCEPTANCE", "ON_MILESTONE"}),
            int(bool(rule.get("due_date"))),
        )
        preferred, supplement = (rule, existing) if candidate_score > existing_score else (existing, rule)
        preferred = dict(preferred)
        if not preferred.get("due_date") and supplement.get("due_date"):
            preferred["due_date"] = supplement["due_date"]
        if (
            preferred.get("due_date")
            and preferred.get("amount") is not None
            and preferred.get("amount_basis") not in {"UNIT_PRICE", "VARIABLE_DRAWDOWN"}
            and preferred.get("payment_timing") in {"FIXED_DATE", "ON_ACCEPTANCE", "ON_MILESTONE"}
        ):
            preferred["generates_cashflow"] = True
        result[existing_position] = preferred
    return result


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
    left = _previous_sentence_boundary(text, start)
    right = _next_sentence_boundary(text, end)
    if right == -1:
        right = min(len(text), end + 160)
    return _short_quote(text[left + 1 : right + 1])


def _previous_sentence_boundary(text: str, start: int) -> int:
    newline = text.rfind("\n", 0, start)
    position = text.rfind(".", 0, start)
    while position > newline and _is_numeric_separator(text, position):
        position = text.rfind(".", 0, position)
    return max(newline, position)


def _next_sentence_boundary(text: str, end: int) -> int:
    newline = text.find("\n", end)
    position = text.find(".", end)
    while position != -1 and _is_numeric_separator(text, position):
        position = text.find(".", position + 1)
    candidates = [candidate for candidate in (newline, position) if candidate != -1]
    return min(candidates) if candidates else -1


def _is_numeric_separator(text: str, position: int) -> bool:
    previous = position - 1
    while previous >= 0 and text[previous].isspace():
        previous -= 1
    following = position + 1
    while following < len(text) and text[following].isspace():
        following += 1
    return (
        previous >= 0
        and following < len(text)
        and text[previous].isdigit()
        and text[following].isdigit()
    )


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
    normalized = re.sub(r"[^0-9,.]", "", value.replace("\xa0", ""))
    if not normalized or not re.search(r"\d", normalized):
        return None
    separators = [index for index, char in enumerate(normalized) if char in {",", "."}]
    decimal_separator_index: int | None = None
    if separators:
        last_separator = separators[-1]
        trailing_digits = len(normalized) - last_separator - 1
        has_both_separator_types = "," in normalized and "." in normalized
        if trailing_digits in {1, 2}:
            decimal_separator_index = last_separator
        elif has_both_separator_types and trailing_digits != 3:
            decimal_separator_index = last_separator

    digits: list[str] = []
    for index, char in enumerate(normalized):
        if char.isdigit():
            digits.append(char)
        elif index == decimal_separator_index:
            digits.append(".")
    canonical = "".join(digits)
    if not canonical:
        return None
    number = float(canonical)
    return int(number) if number.is_integer() else number


def _normalize_int(value: str) -> int | None:
    number = _normalize_number(value)
    if number is None:
        return None
    return int(number)


def _normalize_due_days(value: str) -> int | None:
    number = _normalize_int(value)
    if number is None or not 1 <= number <= 365:
        return None
    return number


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


def _ascii_text(value: str) -> str:
    return re.sub(r"\s+", " ", _strip_accents(value).casefold()).strip()
