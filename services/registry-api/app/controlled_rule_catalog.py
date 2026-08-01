from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json


CATALOG_VERSION = "public-procurement-normative-catalog-1.0.0"


@dataclass(frozen=True)
class NormativeKeyDefinition:
    key: str
    category: str
    title: str
    description: str
    aliases: tuple[str, ...] = ()


PUBLIC_PROCUREMENT_NORMATIVE_KEYS: tuple[NormativeKeyDefinition, ...] = (
    NormativeKeyDefinition(
        key="public_procurement.vzmr.supplies_services.threshold",
        category="financial_limit",
        title="Limit VZMR pro dodávky a služby",
        description="Rozhodný finanční limit pro veřejné zakázky malého rozsahu na dodávky a služby.",
        aliases=(
            "public_procurement.vzmr.supplies.threshold",
            "public_procurement.vzmr.services.threshold",
        ),
    ),
    NormativeKeyDefinition(
        key="public_procurement.vzmr.works.threshold",
        category="financial_limit",
        title="Limit VZMR pro stavební práce",
        description="Rozhodný finanční limit pro veřejné zakázky malého rozsahu na stavební práce.",
    ),
    NormativeKeyDefinition(
        key="public_procurement.internal_category_1.upper_threshold",
        category="financial_limit",
        title="Horní limit interní kategorie VZMR I",
        description="Horní hodnota interního zjednodušeného postupu pro první kategorii veřejných zakázek malého rozsahu.",
    ),
    NormativeKeyDefinition(
        key="public_procurement.direct_purchase.threshold",
        category="financial_limit",
        title="Limit přímého nákupu",
        description="Nejvyšší hodnota, do které interní pravidlo připouští přímý nákup.",
    ),
    NormativeKeyDefinition(
        key="public_procurement.market_research.threshold",
        category="financial_limit",
        title="Limit průzkumu trhu",
        description="Hodnota, od které se vyžaduje průzkum trhu nebo srovnání nabídek.",
    ),
    NormativeKeyDefinition(
        key="public_procurement.marketplace.threshold",
        category="financial_limit",
        title="Limit elektronického tržiště",
        description="Hodnota nebo podmínka použití schváleného elektronického tržiště.",
    ),
    NormativeKeyDefinition(
        key="public_procurement.central_evidence.threshold",
        category="financial_limit",
        title="Limit centrální evidence veřejných zakázek",
        description="Hodnota, od které musí být zakázka vedena v centrální evidenci organizace.",
    ),
    NormativeKeyDefinition(
        key="public_procurement.publication.contract_register.threshold",
        category="financial_limit",
        title="Limit zveřejnění v registru smluv",
        description="Hodnota, od které interní postup vyžaduje zveřejnění smlouvy v registru smluv.",
    ),
    NormativeKeyDefinition(
        key="public_procurement.publication.contracting_profile.threshold",
        category="financial_limit",
        title="Limit zveřejnění na profilu zadavatele",
        description="Hodnota, od které musí být smlouva zveřejněna na profilu zadavatele podle rozhodného předpisu.",
    ),
    NormativeKeyDefinition(
        key="public_procurement.supplier_quotes.minimum_count",
        category="condition",
        title="Minimální počet nabídek",
        description="Minimální počet dodavatelů nebo nabídek požadovaných pro příslušný postup.",
    ),
    NormativeKeyDefinition(
        key="public_procurement.nen.registration.required",
        category="obligation",
        title="Povinnost použít NEN",
        description="Podmínky povinného použití Národního elektronického nástroje.",
    ),
    NormativeKeyDefinition(
        key="public_procurement.contract.written_form.threshold",
        category="financial_limit",
        title="Limit písemné smlouvy",
        description="Hodnota, od které musí být závazek zachycen písemnou smlouvou.",
    ),
    NormativeKeyDefinition(
        key="public_procurement.contract.amendment.approval_threshold",
        category="financial_limit",
        title="Limit schválení dodatku",
        description="Hodnota, od které dodatek ke smlouvě vyžaduje určený schvalovací postup.",
    ),
    NormativeKeyDefinition(
        key="public_procurement.approval.workflow",
        category="approval_step",
        title="Schvalovací postup",
        description="Povinné schvalovací kroky a role pro zadání veřejné zakázky.",
    ),
    NormativeKeyDefinition(
        key="public_procurement.exception.conditions",
        category="exception",
        title="Podmínky výjimky",
        description="Podmínky, za kterých lze použít výjimku z běžného postupu.",
    ),
    NormativeKeyDefinition(
        key="public_procurement.documentation.required",
        category="required_document",
        title="Povinná dokumentace",
        description="Dokumenty a důkazy, které musí být uchovány k zadávacímu postupu.",
    ),
    NormativeKeyDefinition(
        key="public_procurement.retention.period",
        category="deadline",
        title="Doba uchování dokumentace",
        description="Minimální doba uchování dokumentace veřejné zakázky.",
    ),
)


_DEFINITIONS = {item.key: item for item in PUBLIC_PROCUREMENT_NORMATIVE_KEYS}
_ALIASES = {
    alias: item.key
    for item in PUBLIC_PROCUREMENT_NORMATIVE_KEYS
    for alias in item.aliases
}


def canonical_normative_key(key: str) -> str:
    return _ALIASES.get(key, key)


def normative_key_definition(key: str) -> NormativeKeyDefinition | None:
    return _DEFINITIONS.get(canonical_normative_key(key))


def normative_key_is_registered(domain: str, key: str) -> bool:
    if domain != "public_procurement":
        return True
    return normative_key_definition(key) is not None


def normative_key_category_matches(domain: str, key: str, category: str) -> bool:
    if domain != "public_procurement":
        return True
    definition = normative_key_definition(key)
    return definition is not None and definition.category == category


def catalog_payload() -> dict[str, object]:
    return {
        "version": CATALOG_VERSION,
        "domain": "public_procurement",
        "definitions": [
            {
                "key": item.key,
                "category": item.category,
                "title": item.title,
                "description": item.description,
                "aliases": list(item.aliases),
            }
            for item in PUBLIC_PROCUREMENT_NORMATIVE_KEYS
        ],
    }


def catalog_sha256() -> str:
    canonical = json.dumps(
        catalog_payload(),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return sha256(canonical.encode("utf-8")).hexdigest()
