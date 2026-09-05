import json
from hashlib import sha256
from pathlib import Path

from app.controlled_rule_catalog import (
    canonical_normative_key,
    catalog_payload,
    catalog_sha256,
    normative_key_category_matches,
    normative_key_is_registered,
    normative_key_source_type_matches,
)
from app.schemas import ControlledRuleConsumerResponse


def test_public_procurement_catalog_matches_repository_contract():
    contract_path = (
        Path(__file__).resolve().parents[3]
        / "contracts"
        / "controlled-rules"
        / "v1"
        / "public-procurement-normative-catalog.json"
    )
    assert json.loads(contract_path.read_text(encoding="utf-8")) == catalog_payload()
    assert len(catalog_sha256()) == 64


def test_public_procurement_catalog_canonicalizes_only_registered_aliases():
    assert canonical_normative_key(
        "public_procurement.vzmr.supplies.threshold"
    ) == "public_procurement.vzmr.supplies_services.threshold"
    assert normative_key_is_registered(
        "public_procurement",
        "public_procurement.vzmr.services.threshold",
    )
    assert normative_key_category_matches(
        "public_procurement",
        "public_procurement.vzmr.services.threshold",
        "financial_limit",
    )
    assert not normative_key_is_registered(
        "public_procurement",
        "financial_limit:generated-hash",
    )


def test_statutory_normative_keys_require_an_authoritative_legal_source():
    statutory_key = "public_procurement.vzmr.supplies_services.threshold"
    internal_key = "public_procurement.market_research.threshold"

    assert normative_key_source_type_matches(
        "public_procurement",
        statutory_key,
        "law",
    )
    assert normative_key_source_type_matches(
        "public_procurement",
        statutory_key,
        "implementing_regulation",
    )
    assert not normative_key_source_type_matches(
        "public_procurement",
        statutory_key,
        "internal_directive",
    )
    assert normative_key_source_type_matches(
        "public_procurement",
        internal_key,
        "internal_directive",
    )


def test_controlled_rule_consumer_fixtures_match_closed_response_contract():
    fixtures = (
        Path(__file__).resolve().parents[3]
        / "contracts"
        / "controlled-rules"
        / "v1"
        / "fixtures"
    )
    for fixture_path in sorted(fixtures.glob("*.response.json")):
        payload = json.loads(fixture_path.read_text(encoding="utf-8"))
        validated = ControlledRuleConsumerResponse.model_validate(payload)
        assert validated.model_dump(mode="json") == payload
        source_payload = {key: value for key, value in payload.items() if key != "source_version"}
        canonical = json.dumps(
            source_payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        assert payload["source_version"] == (
            f"sha256:{sha256(canonical.encode('utf-8')).hexdigest()}"
        )


def test_closed_consumer_outcomes_cover_migration_and_invalid_review_date():
    base = {
        "organization_id": "org_stratos",
        "domain": "public_procurement",
        "valid_on": "2026-08-01",
        "decision_eligible": False,
        "source_version": f"sha256:{'0' * 64}",
        "catalog_version": "public-procurement-normative-catalog-1.0.0",
        "catalog_sha256": catalog_sha256(),
        "sources": [],
        "rules": [],
    }
    migration = ControlledRuleConsumerResponse.model_validate(
        {
            **base,
            "status": "no_data",
            "warnings": ["CONTROLLED_RULE_EXTRACTION_V3_REQUIRED"],
        }
    )
    assert migration.decision_eligible is False
    invalid_review = ControlledRuleConsumerResponse.model_validate(
        {
            **base,
            "status": "conflict",
            "warnings": ["SOURCE_REVIEW_DATE_INVALID"],
        }
    )
    assert invalid_review.status == "conflict"
