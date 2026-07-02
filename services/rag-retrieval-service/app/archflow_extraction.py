from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from app.schemas import (
    ArchflowArchitectureFieldProposal,
    ArchflowCandidateRequirement,
    ArchflowGoalFieldProposal,
    ArchflowGoalProposalValue,
    ArchflowSuggestedMetric,
    Confidence,
    ContractExtractionCitation,
    ContractExtractionProfile,
    RetrievedChunk,
)


PROFILE_NAME = "archflow_goal_extraction_v1"
ARCHITECTURE_PACKAGE_PROFILE_NAME = "architecture_package_review_v1"
ARCHITECTURE_HANDOVER_PROFILE_NAME = "architecture_handover_v1"
PROFILE_VERSION = "1"

ARCHFLOW_GOAL_FIELDS = [
    "goal",
    "capability",
    "obligation",
    "requirement",
    "metric",
    "legal_basis",
    "risk",
]

GoalField = Literal["goal", "capability", "obligation", "requirement", "metric", "legal_basis", "risk"]


@dataclass(frozen=True)
class GoalPatternSpec:
    field: GoalField
    pattern: re.Pattern[str]
    reason: str
    confidence: Confidence = "medium"
    goal_type: str = "OPERATIONAL_GOAL"
    obligation_type: Literal["SHALL", "SHOULD", "MAY"] | None = None
    title_group: str | int = 1


def archflow_goal_extraction_profiles() -> list[ContractExtractionProfile]:
    return [
        ContractExtractionProfile(
            profile=PROFILE_NAME,
            profile_version=PROFILE_VERSION,
            title="ArchFlow goal extraction",
            description=(
                "Proposes cited goals, obligations, requirements, metrics, legal basis, and risks "
                "from AKB documents. ArchFlow owns final writes after human confirmation."
            ),
            supported_external_systems=["STRATOS_ARCHFLOW"],
            fields=ARCHFLOW_GOAL_FIELDS,
        ),
        ContractExtractionProfile(
            profile=ARCHITECTURE_PACKAGE_PROFILE_NAME,
            profile_version=PROFILE_VERSION,
            title="ArchFlow architecture package review",
            description=(
                "Proposes cited review findings for target architecture, solution architecture, "
                "integration, data/security assessment, and architecture decision packages."
            ),
            supported_external_systems=["STRATOS_ARCHFLOW"],
            fields=[
                "package_scope",
                "architecture_decision",
                "integration_requirement",
                "data_security_control",
                "risk",
                "open_issue",
            ],
        ),
        ContractExtractionProfile(
            profile=ARCHITECTURE_HANDOVER_PROFILE_NAME,
            profile_version=PROFILE_VERSION,
            title="ArchFlow architecture handover review",
            description=(
                "Proposes cited handover and as-built evidence for operational takeover, "
                "owners, runbooks, acceptance evidence, and residual risks."
            ),
            supported_external_systems=["STRATOS_ARCHFLOW"],
            fields=[
                "as_built_state",
                "handover_item",
                "operational_runbook",
                "owner",
                "acceptance_evidence",
                "open_risk",
            ],
        )
    ]


def extract_archflow_goal_proposals(
    *,
    chunks: list[RetrievedChunk],
) -> tuple[list[ArchflowGoalFieldProposal], list[str], list[str]]:
    proposals: list[ArchflowGoalFieldProposal] = []
    seen: set[tuple[str, str]] = set()

    for chunk in chunks:
        for spec in _goal_pattern_specs():
            for match in spec.pattern.finditer(chunk.text):
                proposal = _proposal_from_match(chunk, match, spec)
                key = (proposal.field, proposal.proposal.title.casefold())
                if key in seen:
                    continue
                proposals.append(proposal)
                seen.add(key)

    fields = {proposal.field for proposal in proposals}
    missing_information: list[str] = []
    if "goal" not in fields and "capability" not in fields:
        missing_information.append("goal_or_capability")
    if "obligation" not in fields and "requirement" not in fields:
        missing_information.append("obligation_or_requirement")

    warnings: list[str] = []
    if not proposals:
        warnings.append("INSUFFICIENT_CITABLE_ARCHFLOW_GOAL_EVIDENCE")
    elif missing_information:
        warnings.append("MISSING_ARCHFLOW_GOAL_EXTRACTION_CATEGORIES")

    return proposals, missing_information, warnings


def extract_archflow_architecture_package_proposals(
    *,
    chunks: list[RetrievedChunk],
) -> tuple[list[ArchflowArchitectureFieldProposal], list[str], list[str]]:
    specs = [
        _ArchitecturePatternSpec(
            field="package_scope",
            pattern=re.compile(
                r"((?:cílov[áa]\s+architektura|target\s+architecture|solution\s+architecture|architektonick[ýy]\s+bal[ií][cč]ek)[^.\n]{12,260})",
                re.IGNORECASE,
            ),
            reason="The cited source describes the architecture package scope.",
            confidence="high",
        ),
        _ArchitecturePatternSpec(
            field="architecture_decision",
            pattern=re.compile(
                r"((?:architektonick[ée]\s+rozhodnut[íi]|architecture\s+decision|ADR)[^.\n]{8,260})",
                re.IGNORECASE,
            ),
            reason="The cited source states an architecture decision or ADR.",
            confidence="high",
        ),
        _ArchitecturePatternSpec(
            field="integration_requirement",
            pattern=re.compile(
                r"((?:integrace|interface|API|AsyncAPI|OpenAPI|rozhran[íi])[^.\n]{8,260})",
                re.IGNORECASE,
            ),
            reason="The cited source states an integration or interface requirement.",
            confidence="medium",
        ),
        _ArchitecturePatternSpec(
            field="data_security_control",
            pattern=re.compile(
                r"((?:bezpe[cč]nost|klasifikace\s+dat|osobn[íi]\s+[úu]daje|[sš]ifrov[aá]n[íi]|auditn[íi]\s+stopa)[^.\n]{8,260})",
                re.IGNORECASE,
            ),
            reason="The cited source states a data or security control.",
            confidence="medium",
        ),
        _ArchitecturePatternSpec(
            field="risk",
            pattern=re.compile(r"((?:riziko|nesoulad)[^.\n]{8,260})", re.IGNORECASE),
            reason="The cited source states an architecture package risk.",
            confidence="medium",
        ),
        _ArchitecturePatternSpec(
            field="open_issue",
            pattern=re.compile(
                r"((?:otev[řr]en[ýy]\s+bod|nevy[řr]e[šs]en[ée]|chyb[íi]|doplnit)[^.\n]{8,260})",
                re.IGNORECASE,
            ),
            reason="The cited source states missing or unresolved package information.",
            confidence="medium",
        ),
    ]
    return _extract_architecture_proposals(
        chunks=chunks,
        specs=specs,
        required_fields={"package_scope", "architecture_decision", "integration_requirement"},
        insufficient_warning="INSUFFICIENT_CITABLE_ARCHITECTURE_PACKAGE_EVIDENCE",
        missing_warning="MISSING_ARCHITECTURE_PACKAGE_REVIEW_CATEGORIES",
    )


def extract_archflow_handover_proposals(
    *,
    chunks: list[RetrievedChunk],
) -> tuple[list[ArchflowArchitectureFieldProposal], list[str], list[str]]:
    specs = [
        _ArchitecturePatternSpec(
            field="as_built_state",
            pattern=re.compile(
                r"((?:as-built|skute[cč]n[ée]\s+proveden[íi]|realizovan[áa]\s+architektura)[^.\n]{8,260})",
                re.IGNORECASE,
            ),
            reason="The cited source states the as-built architecture state.",
            confidence="high",
        ),
        _ArchitecturePatternSpec(
            field="handover_item",
            pattern=re.compile(
                r"((?:p[řr]ed[aá]vac[íi]\s+bal[ií][cč]ek|p[řr]ed[aá]n[íi]|handover)[^.\n]{8,260})",
                re.IGNORECASE,
            ),
            reason="The cited source states a handover package item.",
            confidence="high",
        ),
        _ArchitecturePatternSpec(
            field="operational_runbook",
            pattern=re.compile(
                r"((?:provozn[íi]\s+runbook|runbook|provozn[íi]\s+postup|monitoring|z[aá]lohov[aá]n[íi])[^.\n]{8,260})",
                re.IGNORECASE,
            ),
            reason="The cited source states operational runbook or support evidence.",
            confidence="medium",
        ),
        _ArchitecturePatternSpec(
            field="owner",
            pattern=re.compile(
                r"((?:vlastn[íi]k|spr[áa]vce|garant|odpov[ěe]dn[áa]\s+role)[^.\n]{8,220})",
                re.IGNORECASE,
            ),
            reason="The cited source states an owner or accountable role.",
            confidence="medium",
        ),
        _ArchitecturePatternSpec(
            field="acceptance_evidence",
            pattern=re.compile(
                r"((?:akceptace|akcepta[cč]n[íi]\s+krit[eé]ria|test|d[oů]kaz|evidence)[^.\n]{8,260})",
                re.IGNORECASE,
            ),
            reason="The cited source states acceptance or evidence for handover.",
            confidence="medium",
        ),
        _ArchitecturePatternSpec(
            field="open_risk",
            pattern=re.compile(r"((?:rezidu[aá]ln[íi]\s+riziko|otev[řr]en[ée]\s+riziko|riziko)[^.\n]{8,260})", re.IGNORECASE),
            reason="The cited source states a residual or open handover risk.",
            confidence="medium",
        ),
    ]
    return _extract_architecture_proposals(
        chunks=chunks,
        specs=specs,
        required_fields={"as_built_state", "handover_item", "operational_runbook"},
        insufficient_warning="INSUFFICIENT_CITABLE_ARCHITECTURE_HANDOVER_EVIDENCE",
        missing_warning="MISSING_ARCHITECTURE_HANDOVER_CATEGORIES",
    )


@dataclass(frozen=True)
class _ArchitecturePatternSpec:
    field: str
    pattern: re.Pattern[str]
    reason: str
    confidence: Confidence = "medium"


def _extract_architecture_proposals(
    *,
    chunks: list[RetrievedChunk],
    specs: list[_ArchitecturePatternSpec],
    required_fields: set[str],
    insufficient_warning: str,
    missing_warning: str,
) -> tuple[list[ArchflowArchitectureFieldProposal], list[str], list[str]]:
    proposals: list[ArchflowArchitectureFieldProposal] = []
    seen: set[tuple[str, str]] = set()
    for chunk in chunks:
        for spec in specs:
            for match in spec.pattern.finditer(chunk.text):
                quoted_text = _sentence_around(chunk.text, match.start(), match.end())
                key = (spec.field, quoted_text.casefold())
                if key in seen:
                    continue
                proposals.append(
                    ArchflowArchitectureFieldProposal(
                        field=spec.field,
                        confidence=spec.confidence,
                        proposal={
                            "title": _title_from_text(quoted_text, spec.field.replace("_", " ").title()),
                            "summary": quoted_text,
                            "artifact_section": _section(chunk),
                            "artifact_evidence_type": spec.field,
                        },
                        reason=spec.reason,
                        citation=_citation_from_match(chunk, match),
                    )
                )
                seen.add(key)
    fields = {proposal.field for proposal in proposals}
    missing_information = sorted(required_fields - fields)
    warnings: list[str] = []
    if not proposals:
        warnings.append(insufficient_warning)
    elif missing_information:
        warnings.append(missing_warning)
    return proposals, missing_information, warnings


def _goal_pattern_specs() -> list[GoalPatternSpec]:
    return [
        GoalPatternSpec(
            field="goal",
            pattern=re.compile(
                r"(?:strategick[ýy]\s+c[ií]l|c[ií]l)\s*[:\-]\s*(?P<title>[^.\n]{8,220})",
                re.IGNORECASE,
            ),
            title_group="title",
            goal_type="STRATEGIC_GOAL",
            reason="The cited source explicitly labels a goal.",
            confidence="high",
        ),
        GoalPatternSpec(
            field="capability",
            pattern=re.compile(
                r"(?:schopnost|capability)\s*[:\-]\s*(?P<title>[^.\n]{8,220})",
                re.IGNORECASE,
            ),
            title_group="title",
            goal_type="CAPABILITY",
            reason="The cited source explicitly labels a capability.",
            confidence="high",
        ),
        GoalPatternSpec(
            field="obligation",
            pattern=re.compile(
                r"((?:organizace|[úu]r[řr]ad|spr[áa]vce|vlastn[íi]k|gestor|org[áa]n)[^.\n]{0,90}"
                r"(?:mus[íi]|je\s+povinen|je\s+povinna|zajist[íi]|mus[íi]\s+zajistit)[^.\n]{10,240})",
                re.IGNORECASE,
            ),
            goal_type="OBLIGATION",
            obligation_type="SHALL",
            reason="The cited source states an obligation for the organization or accountable role.",
            confidence="high",
        ),
        GoalPatternSpec(
            field="requirement",
            pattern=re.compile(
                r"(?:po[zž]adavek|requirement)\s*[:\-]\s*(?P<title>[^.\n]{8,240})",
                re.IGNORECASE,
            ),
            title_group="title",
            goal_type="REQUIREMENT",
            obligation_type="SHALL",
            reason="The cited source explicitly labels a requirement.",
            confidence="high",
        ),
        GoalPatternSpec(
            field="metric",
            pattern=re.compile(
                r"(?:metrika|kpi|ukazatel)\s*[:\-]\s*(?P<title>[^.\n]{3,220})",
                re.IGNORECASE,
            ),
            title_group="title",
            goal_type="METRIC",
            reason="The cited source explicitly labels a metric or KPI.",
            confidence="medium",
        ),
        GoalPatternSpec(
            field="legal_basis",
            pattern=re.compile(
                r"((?:pr[áa]vn[íi]\s+opora|metodick[áa]\s+opora|vypl[ýy]v[áa]\s+z|podle\s+z[áa]kona|podle\s+vyhl[áa][sš]ky)[^.\n]{10,240})",
                re.IGNORECASE,
            ),
            goal_type="LEGAL_BASIS",
            reason="The cited source states a legal or methodological basis.",
            confidence="medium",
        ),
        GoalPatternSpec(
            field="risk",
            pattern=re.compile(
                r"((?:riziko\s+nepln[eě]n[íi]|riziko|nesoulad)[^.\n]{10,240})",
                re.IGNORECASE,
            ),
            goal_type="RISK",
            reason="The cited source states a risk or non-compliance scenario.",
            confidence="medium",
        ),
    ]


def _proposal_from_match(
    chunk: RetrievedChunk,
    match: re.Match[str],
    spec: GoalPatternSpec,
) -> ArchflowGoalFieldProposal:
    title = _clean_value(str(match.group(spec.title_group)))
    if spec.field == "metric":
        title, metric = _metric_from_title(title)
        value = ArchflowGoalProposalValue(
            goal_type=spec.goal_type,
            title=title,
            description=_sentence_around(chunk.text, match.start(), match.end()),
            parent_hint=_parent_hint(chunk),
            priority=_priority(chunk.text),
            suggested_metrics=[metric],
        )
    elif spec.field == "requirement":
        requirement = ArchflowCandidateRequirement(
            title=title,
            requirement_type=_requirement_type(title),
            acceptance_criteria=_acceptance_criteria(title),
        )
        value = ArchflowGoalProposalValue(
            goal_type=spec.goal_type,
            title=title,
            description=_sentence_around(chunk.text, match.start(), match.end()),
            parent_hint=_parent_hint(chunk),
            priority=_priority(chunk.text),
            obligation_type=spec.obligation_type,
            candidate_requirements=[requirement],
        )
    elif spec.field == "legal_basis":
        value = ArchflowGoalProposalValue(
            goal_type=spec.goal_type,
            title=_title_from_text(title, "Právní nebo metodická opora"),
            description=title,
            parent_hint=_parent_hint(chunk),
            priority=_priority(chunk.text),
            legal_basis=title,
        )
    elif spec.field == "risk":
        value = ArchflowGoalProposalValue(
            goal_type=spec.goal_type,
            title=_title_from_text(title, "Riziko neplnění nebo nesouladu"),
            description=title,
            parent_hint=_parent_hint(chunk),
            priority=_priority(chunk.text),
            risk=title,
        )
    else:
        value = ArchflowGoalProposalValue(
            goal_type=spec.goal_type,
            title=_title_from_text(title, title),
            description=_sentence_around(chunk.text, match.start(), match.end()),
            parent_hint=_parent_hint(chunk),
            priority=_priority(chunk.text),
            obligation_type=spec.obligation_type,
        )

    return ArchflowGoalFieldProposal(
        field=spec.field,
        confidence=spec.confidence,
        proposal=value,
        reason=spec.reason,
        citation=_citation_from_match(chunk, match),
    )


def _metric_from_title(value: str) -> tuple[str, ArchflowSuggestedMetric]:
    target_match = re.search(r"(\d+(?:[,.]\d+)?\s*%)", value)
    periodicity_match = re.search(r"(m[eě]s[ií][cč]n[eě]|ro[cč]n[eě]|quarterly|monthly|annually)", value, re.IGNORECASE)
    title = re.split(r"\s*(?:target|c[íi]l(?:ov[áa]\s+hodnota)?|=|:)\s*", value, maxsplit=1, flags=re.IGNORECASE)[0]
    title = _clean_value(title) or "Metrika"
    return (
        title,
        ArchflowSuggestedMetric(
            name=title,
            target=_clean_value(target_match.group(1)) if target_match else None,
            periodicity=_normalize_periodicity(periodicity_match.group(1)) if periodicity_match else None,
        ),
    )


def _citation_from_match(chunk: RetrievedChunk, match: re.Match[str]) -> ContractExtractionCitation:
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
        quoted_text=_sentence_around(chunk.text, match.start(), match.end()),
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


def _parent_hint(chunk: RetrievedChunk) -> str | None:
    return chunk.citation.section_path[0] if chunk.citation.section_path else None


def _priority(text: str) -> Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]:
    normalized = text.casefold()
    if "kritick" in normalized:
        return "CRITICAL"
    if "vysok" in normalized or "klíčov" in normalized or "klicov" in normalized:
        return "HIGH"
    if "nízk" in normalized or "nizk" in normalized:
        return "LOW"
    return "MEDIUM"


def _requirement_type(value: str) -> str:
    normalized = value.casefold()
    if "dostupnost" in normalized or "výkon" in normalized or "vykon" in normalized or "monitoring" in normalized:
        return "non_functional"
    return "functional"


def _acceptance_criteria(value: str) -> str:
    if re.search(r"\b(mus[íi]|zaji[sš][tť]uje|reportuje|umo[zž][nň]uje)\b", value, re.IGNORECASE):
        return value
    return f"Požadavek je splněn, pokud je prokazatelně zajištěno: {value}."


def _sentence_around(text: str, start: int, end: int, limit: int = 320) -> str:
    left = max(text.rfind(".", 0, start), text.rfind("\n", 0, start))
    right_candidates = [idx for idx in (text.find(".", end), text.find("\n", end)) if idx != -1]
    right = min(right_candidates) if right_candidates else min(len(text), end + limit)
    return _short_quote(text[left + 1 : right + 1], limit=limit)


def _short_quote(value: str, limit: int = 240) -> str:
    compact = re.sub(r"\s+", " ", value).strip()
    if len(compact) <= limit:
        return compact
    return compact[: limit - 1].rstrip() + "…"


def _title_from_text(value: str, fallback: str) -> str:
    compact = _clean_value(value)
    if not compact:
        return fallback
    if len(compact) <= 120:
        return compact
    return compact[:119].rstrip() + "…"


def _clean_value(value: str | None) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", value).strip(" \t\n\r,;.")


def _normalize_periodicity(value: str) -> str:
    normalized = value.casefold()
    if normalized in {"mesicne", "měsíčně", "monthly"}:
        return "monthly"
    if normalized in {"rocne", "ročně", "annually"}:
        return "annually"
    return normalized
