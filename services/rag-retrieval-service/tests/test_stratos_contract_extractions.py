from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.contract_extraction import _normalize_number, extract_contract_financial_proposals
from app.schemas import (
    ChunkCitation,
    ContractExtractionCitation,
    ContractPaymentRuleProposal,
    RetrievedChunk,
)
from tests.conftest import make_client


def _payload(**overrides):
    payload = {
        "tenant_id": "tenant-a",
        "external_system": "STRATOS_BUDGET",
        "external_ref": "contract:256-2022-S:main",
        "entity_type": "Contract",
        "entity_id": "contract-uuid",
        "document_id": "doc_contract",
        "document_version_id": "ver_contract_1",
        "subject_id": "budget-user",
        "profile": "contract_financial_v1",
        "profile_version": "2",
        "classification_max": "internal",
        "context_tags": ["budget-contract:contract-uuid"],
        "max_chunks": 12,
    }
    payload.update(overrides)
    return payload


def _rule_dicts(proposal):
    return [
        rule.model_dump(mode="json")
        if hasattr(rule, "model_dump")
        else rule
        for rule in proposal.normalized_value
    ]


def _citation() -> ContractExtractionCitation:
    return ContractExtractionCitation(
        document_id="doc-rule-validation",
        document_version_id="ver-rule-validation-1",
        chunk_id="chunk-rule-validation",
        quoted_text="Citované platební pravidlo.",
        viewer_url="/akb/documents/doc-rule-validation",
    )


def test_contract_extraction_profiles_are_available() -> None:
    with make_client() as client:
        response = client.get("/api/v1/stratos/extractions/profiles")

    assert response.status_code == 200
    body = response.json()
    profiles = {
        profile["profile_version"]: profile
        for profile in body["profiles"]
        if profile["profile"] == "contract_financial_v1"
    }
    contract_profile_versions = [
        profile["profile_version"]
        for profile in body["profiles"]
        if profile["profile"] == "contract_financial_v1"
    ]
    assert contract_profile_versions == ["1", "2"]
    assert set(profiles) == {"1", "2"}
    assert "payment_rules" in profiles["2"]["fields"]
    assert "payment_schedule" not in profiles["2"]["fields"]
    assert "payment_schedule" in profiles["1"]["fields"]
    assert "payment_rules" not in profiles["1"]["fields"]


def test_contract_extraction_v1_remains_available_during_rolling_deployment() -> None:
    with make_client() as client:
        response = client.post(
            "/api/v1/stratos/extractions/contracts/propose",
            json=_payload(profile_version="1"),
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["profile_version"] == "1"
    fields = {proposal["field"]: proposal for proposal in body["proposals"]}
    assert "payment_rules" not in fields
    assert "payment_schedule" in fields
    assert "payment_frequency" in fields


def test_contract_extraction_omitted_version_keeps_v1_rollout_default() -> None:
    payload = _payload()
    payload.pop("profile_version")
    with make_client() as client:
        response = client.post(
            "/api/v1/stratos/extractions/contracts/propose",
            json=payload,
        )

    assert response.status_code == 200, response.text
    assert response.json()["profile_version"] == "1"


def test_contract_extraction_rejects_unknown_profile_version() -> None:
    with make_client() as client:
        response = client.post(
            "/api/v1/stratos/extractions/contracts/propose",
            json=_payload(profile_version="3"),
        )

    assert response.status_code == 422


def test_contract_extraction_proposes_cited_financial_fields() -> None:
    with make_client() as client:
        response = client.post("/api/v1/stratos/extractions/contracts/propose", json=_payload())

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] in {"PROPOSED", "PARTIAL"}
    fields = {proposal["field"]: proposal for proposal in body["proposals"]}
    assert fields["contract_number"]["proposed_value"] == "256-2022-S"
    assert fields["supplier_name"]["proposed_value"] == "AUTOCONT a.s"
    assert fields["customer_name"]["proposed_value"] == "Město Železná Lhota"
    assert fields["total_amount_without_vat"]["normalized_value"] == 1200000
    assert fields["payment_due_days"]["normalized_value"] == 30
    assert fields["currency"]["normalized_value"] == "CZK"
    rules = fields["payment_rules"]["normalized_value"]
    assert [rule["rule_type"] for rule in rules] == ["MONTHLY", "ACCEPTANCE"]
    assert rules[0]["amount"] == 100000
    assert rules[0]["name"] == "Měsíční platba"
    assert rules[0]["amount_basis"] == "PER_PERIOD"
    assert rules[0]["vat_basis"] == "UNSPECIFIED"
    assert rules[0]["periodicity_months"] == 1
    assert rules[0]["payment_timing"] == "ARREARS"
    assert rules[0]["payment_terms_days"] == 30
    assert rules[0]["generates_cashflow"] is True
    assert rules[0]["requires_confirmation"] is True
    assert rules[0]["citation"]["chunk_id"] == "chunk_contract_1"
    assert rules[1]["amount"] == 240000
    assert rules[1]["amount_basis"] == "ONE_OFF"
    assert rules[1]["payment_timing"] == "ON_ACCEPTANCE"
    assert rules[1]["due_date"] is None
    assert rules[1]["generates_cashflow"] is False
    assert fields["contract_number"]["citation"]["chunk_id"] == "chunk_contract_1"
    assert fields["contract_number"]["citation"]["viewer_url"].startswith("/akb/documents/doc_contract")
    assert "chunk_contract_1" in body["source_chunk_ids"]


def test_contract_extraction_targets_the_requested_document_and_allows_draft_versions(monkeypatch) -> None:
    from app.service import RagRetrievalService

    captured = {}
    original = RagRetrievalService._retrieve_authorized

    async def capture_retrieval(self, *, payload, query_id, auth_context=None):
        captured["filters"] = payload.filters
        return await original(self, payload=payload, query_id=query_id, auth_context=auth_context)

    monkeypatch.setattr(RagRetrievalService, "_retrieve_authorized", capture_retrieval)
    with make_client() as client:
        response = client.post("/api/v1/stratos/extractions/contracts/propose", json=_payload())

    assert response.status_code == 200, response.text
    assert captured["filters"].document_ids == ["doc_contract"]
    assert captured["filters"].document_version_ids == ["ver_contract_1"]
    assert captured["filters"].only_valid is False


def test_contract_extraction_is_idempotent_for_same_document_version() -> None:
    with make_client() as client:
        first = client.post("/api/v1/stratos/extractions/contracts/propose", json=_payload())
        second = client.post("/api/v1/stratos/extractions/contracts/propose", json=_payload())

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert second.json()["extraction_id"] == first.json()["extraction_id"]


def test_contract_extraction_versions_have_separate_idempotent_results() -> None:
    with make_client() as client:
        version_1 = client.post(
            "/api/v1/stratos/extractions/contracts/propose",
            json=_payload(profile_version="1"),
        )
        version_2 = client.post(
            "/api/v1/stratos/extractions/contracts/propose",
            json=_payload(profile_version="2"),
        )

    assert version_1.status_code == 200, version_1.text
    assert version_2.status_code == 200, version_2.text
    assert version_1.json()["extraction_id"] != version_2.json()["extraction_id"]
    fields_v1 = {proposal["field"] for proposal in version_1.json()["proposals"]}
    fields_v2 = {proposal["field"] for proposal in version_2.json()["proposals"]}
    assert "payment_schedule" in fields_v1
    assert "payment_rules" not in fields_v1
    assert "payment_rules" in fields_v2
    assert "payment_schedule" not in fields_v2


def test_contract_extraction_get_returns_stored_result() -> None:
    with make_client() as client:
        created = client.post("/api/v1/stratos/extractions/contracts/propose", json=_payload())
        extraction_id = created.json()["extraction_id"]
        fetched = client.get(f"/api/v1/stratos/extractions/{extraction_id}")

    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["extraction_id"] == extraction_id
    assert fetched.json()["proposals"]


def test_contract_extraction_feedback_marks_source_app_status() -> None:
    with make_client() as client:
        created = client.post("/api/v1/stratos/extractions/contracts/propose", json=_payload())
        extraction_id = created.json()["extraction_id"]
        feedback = client.post(
            f"/api/v1/stratos/extractions/{extraction_id}/feedback",
            json={
                "field": "contract_number",
                "ai_value": "256-2022-S",
                "final_value": "256-2022-S",
                "decision": "edited",
                "reason": "Budget normalized formatting",
                "actor": "budget-approver",
                "source_app": "STRATOS_BUDGET",
                "source_entity_id": "contract-uuid",
            },
        )

    assert feedback.status_code == 200, feedback.text
    assert feedback.json()["feedback_id"].startswith("extfb_")
    assert feedback.json()["extraction"]["status"] == "ACCEPTED_IN_SOURCE_APP"


def test_contract_extraction_returns_partial_when_target_document_has_no_citable_fields() -> None:
    with make_client() as client:
        response = client.post(
            "/api/v1/stratos/extractions/contracts/propose",
            json=_payload(
                external_ref="contract:unknown:main",
                document_id="doc_missing",
                document_version_id="ver_missing",
                context_tags=[],
            ),
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "PARTIAL"
    assert body["proposals"] == []
    assert "TARGET_DOCUMENT_NOT_RETRIEVED" in body["warnings"]


def test_contract_extraction_permission_denied_when_target_document_is_denied() -> None:
    with make_client(
        {
            "AKL_RAG_AUTHZ_MODE": "registry",
            "AKL_RAG_REGISTRY_CLIENT_MODE": "mock",
            "AKL_RAG_MOCK_DENIED_DOCUMENT_IDS": "doc_contract",
        }
    ) as client:
        response = client.post(
            "/api/v1/stratos/extractions/contracts/propose",
            json=_payload(
                external_ref="contract:denied:main",
            ),
        )

    assert response.status_code == 403


def test_contract_extraction_supersedes_previous_version_in_registry_client() -> None:
    with make_client() as client:
        first = client.post("/api/v1/stratos/extractions/contracts/propose", json=_payload())
        second = client.post(
            "/api/v1/stratos/extractions/contracts/propose",
            json=_payload(
                document_version_id="ver_contract_2",
                metadata={"test": "new version without indexed chunks"},
            ),
        )
        fetched_first = client.get(f"/api/v1/stratos/extractions/{first.json()['extraction_id']}")

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert first.json()["extraction_id"] != second.json()["extraction_id"]
    assert fetched_first.status_code == 200, fetched_first.text
    assert fetched_first.json()["status"] == "SUPERSEDED"


def test_contract_extraction_tenant_identity_is_isolated() -> None:
    with make_client() as client:
        first = client.post("/api/v1/stratos/extractions/contracts/propose", json=_payload(tenant_id="tenant-a"))
        second = client.post("/api/v1/stratos/extractions/contracts/propose", json=_payload(tenant_id="tenant-b"))

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert first.json()["extraction_id"] != second.json()["extraction_id"]


def test_payment_rules_keep_call_off_out_of_automatic_cashflow_and_preserve_dated_installments() -> None:
    chunk = RetrievedChunk(
        chunk_id="chunk-payment-rules",
        score=0.95,
        retrieval_method="hybrid",
        text=(
            "Částka 80 000 Kč je splatná dne 15. 9. 2026. "
            "Další služby budou čerpány na základě dílčích objednávek bez garantovaného odběru. "
            "Splatnost faktur činí 21 dnů."
        ),
        citation=ChunkCitation(
            document_id="doc-payment-rules",
            document_version_id="ver-payment-rules-1",
            document_title="Test platebních pravidel",
            version_label="1",
            page_number=7,
            section_path=["Cena", "Platební kalendář"],
        ),
    )

    proposals, _, _ = extract_contract_financial_proposals(chunks=[chunk])
    payment_rules = next(proposal for proposal in proposals if proposal.field == "payment_rules")
    rules = _rule_dicts(payment_rules)

    assert rules[0]["rule_type"] == "MILESTONE"
    assert rules[0]["due_date"] == "2026-09-15"
    assert rules[0]["payment_timing"] == "FIXED_DATE"
    assert rules[0]["payment_terms_days"] == 21
    assert rules[0]["generates_cashflow"] is True
    assert rules[1]["rule_type"] == "CALL_OFF"
    assert rules[1]["amount"] is None
    assert rules[1]["is_call_off"] is True
    assert rules[1]["generates_cashflow"] is False
    assert rules[1]["citation"]["page_number"] == 7


def test_payment_frequency_without_cited_amount_stays_a_non_cashflow_proposal() -> None:
    chunk = RetrievedChunk(
        chunk_id="chunk-yearly-service",
        score=0.91,
        retrieval_method="hybrid",
        text=(
            "Cenu služeb bude hradit objednatel vždy za každý ukončený rok zpětně. "
            "Lhůta splatnosti faktury činí 21 (slovy: dvacet jedna) dnů, "
            "v prosinci pak 30 dnů."
        ),
        citation=ChunkCitation(
            document_id="doc-yearly-service",
            document_version_id="ver-yearly-service-1",
            document_title="Roční podpora",
            version_label="1",
            page_number=11,
            section_path=["Platební podmínky"],
        ),
    )

    proposals, _, _ = extract_contract_financial_proposals(chunks=[chunk])
    payment_rules = next(proposal for proposal in proposals if proposal.field == "payment_rules")
    yearly_rule = next(rule for rule in _rule_dicts(payment_rules) if rule["rule_type"] == "YEARLY")

    assert yearly_rule["amount"] is None
    assert yearly_rule["periodicity_months"] == 12
    assert yearly_rule["payment_terms_days"] == 21
    assert yearly_rule["generates_cashflow"] is False
    assert yearly_rule["requires_confirmation"] is True


def test_payment_rule_without_safe_timing_never_requests_automatic_cashflow() -> None:
    chunk = RetrievedChunk(
        chunk_id="chunk-monthly-unspecified",
        score=0.92,
        retrieval_method="hybrid",
        text="Měsíční platba bez DPH činí 10 000 Kč.",
        citation=ChunkCitation(
            document_id="doc-monthly-unspecified",
            document_version_id="ver-monthly-unspecified-1",
            document_title="Měsíční služba",
            version_label="1",
            page_number=4,
            section_path=["Cena"],
        ),
    )

    proposals, _, _ = extract_contract_financial_proposals(chunks=[chunk])
    payment_rules = next(proposal for proposal in proposals if proposal.field == "payment_rules")
    monthly_rule = next(rule for rule in _rule_dicts(payment_rules) if rule["rule_type"] == "MONTHLY")

    assert monthly_rule["amount"] == 10000
    assert monthly_rule["vat_basis"] == "WITHOUT_VAT"
    assert monthly_rule["payment_timing"] == "UNSPECIFIED"
    assert monthly_rule["generates_cashflow"] is False
    assert monthly_rule["requires_confirmation"] is True


def test_variable_monthly_drawdown_never_requests_automatic_cashflow() -> None:
    chunk = RetrievedChunk(
        chunk_id="chunk-variable-monthly",
        score=0.96,
        retrieval_method="hybrid",
        text="Měsíčně zpětně bude dle skutečného čerpání uhrazena částka 100 000 Kč.",
        citation=ChunkCitation(
            document_id="doc-variable-monthly",
            document_version_id="ver-variable-monthly-1",
            document_title="Variabilní měsíční čerpání",
            version_label="1",
            page_number=5,
            section_path=["Cena", "Čerpání"],
        ),
    )

    proposals, _, _ = extract_contract_financial_proposals(chunks=[chunk])
    payment_rules = next(proposal for proposal in proposals if proposal.field == "payment_rules")
    rules = _rule_dicts(payment_rules)

    assert any(rule["rule_type"] == "CALL_OFF" for rule in rules)
    assert all(rule["generates_cashflow"] is False for rule in rules)


def test_event_rule_does_not_use_effective_date_as_due_date() -> None:
    chunk = RetrievedChunk(
        chunk_id="chunk-acceptance-effective-date",
        score=0.95,
        retrieval_method="hybrid",
        text="Smlouva je účinná od 1. 7. 2026 a po akceptaci bude uhrazena částka 80 000 Kč.",
        citation=ChunkCitation(
            document_id="doc-acceptance-effective-date",
            document_version_id="ver-acceptance-effective-date-1",
            document_title="Akceptační platba bez data splatnosti",
            version_label="1",
            page_number=9,
            section_path=["Účinnost", "Akceptace"],
        ),
    )

    proposals, _, _ = extract_contract_financial_proposals(chunks=[chunk])
    payment_rules = next(proposal for proposal in proposals if proposal.field == "payment_rules")
    acceptance_rule = next(
        rule for rule in _rule_dicts(payment_rules)
        if rule["rule_type"] == "ACCEPTANCE"
    )

    assert acceptance_rule["due_date"] is None
    assert acceptance_rule["generates_cashflow"] is False


def test_total_contract_price_invoiced_monthly_is_not_a_per_period_amount() -> None:
    chunk = RetrievedChunk(
        chunk_id="chunk-total-monthly",
        score=0.95,
        retrieval_method="hybrid",
        text="Celková cena 1 200 000 Kč bude hrazena měsíčně zpětně.",
        citation=ChunkCitation(
            document_id="doc-total-monthly",
            document_version_id="ver-total-monthly-1",
            document_title="Celková cena hrazená ve splátkách",
            version_label="1",
            page_number=6,
            section_path=["Cena"],
        ),
    )

    proposals, _, _ = extract_contract_financial_proposals(chunks=[chunk])
    payment_rules = next(proposal for proposal in proposals if proposal.field == "payment_rules")
    monthly_rule = next(
        rule for rule in _rule_dicts(payment_rules)
        if rule["rule_type"] == "MONTHLY"
    )

    assert monthly_rule["amount"] is None
    assert monthly_rule["generates_cashflow"] is False


def test_implausible_ocr_payment_terms_do_not_break_or_pollute_proposals() -> None:
    chunk = RetrievedChunk(
        chunk_id="chunk-invalid-due-days",
        score=0.90,
        retrieval_method="hybrid",
        text="Měsíční platba činí 10 000 Kč. Splatnost faktury je 999 dnů.",
        citation=ChunkCitation(
            document_id="doc-invalid-due-days",
            document_version_id="ver-invalid-due-days-1",
            document_title="OCR platebních podmínek",
            version_label="1",
            page_number=3,
            section_path=["Platební podmínky"],
        ),
    )

    proposals, missing, _ = extract_contract_financial_proposals(chunks=[chunk])
    fields = {proposal.field: proposal for proposal in proposals}
    rules = _rule_dicts(fields["payment_rules"])

    assert "payment_due_days" not in fields
    assert "payment_due_days" in missing
    assert rules[0]["payment_terms_days"] is None


def test_payment_rule_contract_exposes_only_adapter_friendly_canonical_keys() -> None:
    chunk = RetrievedChunk(
        chunk_id="chunk-canonical-payment-rule",
        score=0.96,
        retrieval_method="hybrid",
        text="Čtvrtletně bude zpětně hrazena částka včetně DPH 121 000 Kč. Splatnost je 30 dnů.",
        citation=ChunkCitation(
            document_id="doc-canonical-payment-rule",
            document_version_id="ver-canonical-payment-rule-1",
            document_title="Čtvrtletní služba",
            version_label="1",
            page_number=8,
            section_path=["Platební podmínky"],
        ),
    )

    proposals, _, _ = extract_contract_financial_proposals(chunks=[chunk])
    payment_rules = next(proposal for proposal in proposals if proposal.field == "payment_rules")
    rule = next(rule for rule in _rule_dicts(payment_rules) if rule["rule_type"] == "QUARTERLY")

    assert {
        "rule_type",
        "name",
        "amount",
        "amount_basis",
        "vat_basis",
        "currency",
        "periodicity_months",
        "payment_timing",
        "payment_terms_days",
        "is_call_off",
        "generates_cashflow",
        "requires_confirmation",
        "citation",
        "payment_terms_citation",
    }.issubset(rule)
    assert "requires_human_confirmation" not in rule
    assert rule["amount"] == 121000
    assert rule["amount_basis"] == "PER_PERIOD"
    assert rule["vat_basis"] == "WITH_VAT"
    assert rule["payment_timing"] == "ARREARS"
    assert rule["generates_cashflow"] is True


def test_payment_rule_recognizes_amount_before_periodicity() -> None:
    chunk = RetrievedChunk(
        chunk_id="chunk-amount-first",
        score=0.94,
        retrieval_method="hybrid",
        text="Paušální částka bez DPH ve výši 10 000 Kč bude hrazena měsíčně zpětně.",
        citation=ChunkCitation(
            document_id="doc-amount-first",
            document_version_id="ver-amount-first-1",
            document_title="Měsíční služba",
            version_label="1",
            page_number=6,
            section_path=["Cena"],
        ),
    )

    proposals, _, _ = extract_contract_financial_proposals(chunks=[chunk])
    payment_rules = next(proposal for proposal in proposals if proposal.field == "payment_rules")
    monthly_rules = [
        rule for rule in _rule_dicts(payment_rules)
        if rule["rule_type"] == "MONTHLY" and rule["amount"] == 10000
    ]

    assert len(monthly_rules) == 1
    assert monthly_rules[0]["vat_basis"] == "WITHOUT_VAT"
    assert monthly_rules[0]["payment_timing"] == "ARREARS"
    assert monthly_rules[0]["generates_cashflow"] is True


def test_event_rule_merges_cited_due_date_without_losing_event_semantics() -> None:
    chunk = RetrievedChunk(
        chunk_id="chunk-acceptance-date",
        score=0.95,
        retrieval_method="hybrid",
        text="Po akceptaci etapy bude uhrazena částka 80 000 Kč splatná dne 15. 9. 2026.",
        citation=ChunkCitation(
            document_id="doc-acceptance-date",
            document_version_id="ver-acceptance-date-1",
            document_title="Akceptační platba",
            version_label="1",
            page_number=9,
            section_path=["Akceptace", "Platba"],
        ),
    )

    proposals, _, _ = extract_contract_financial_proposals(chunks=[chunk])
    payment_rules = next(proposal for proposal in proposals if proposal.field == "payment_rules")
    rules = _rule_dicts(payment_rules)

    assert len(rules) == 1
    assert rules[0]["rule_type"] == "ACCEPTANCE"
    assert rules[0]["payment_timing"] == "ON_ACCEPTANCE"
    assert rules[0]["due_date"] == "2026-09-15"
    assert rules[0]["generates_cashflow"] is True


@pytest.mark.parametrize(
    "invalid_rule",
    [
        {
            "rule_type": "MONTHLY",
            "name": "Měsíční platba",
            "amount": 10000,
            "amount_basis": "PER_PERIOD",
            "periodicity_months": 1,
            "payment_timing": "UNSPECIFIED",
            "generates_cashflow": True,
        },
        {
            "rule_type": "ACCEPTANCE",
            "name": "Platba po akceptaci",
            "amount": 10000,
            "amount_basis": "ONE_OFF",
            "payment_timing": "ON_ACCEPTANCE",
            "generates_cashflow": True,
        },
        {
            "rule_type": "CALL_OFF",
            "name": "Čerpání na objednávku",
            "amount": None,
            "amount_basis": "VARIABLE_DRAWDOWN",
            "payment_timing": "ON_CALL",
            "is_call_off": False,
            "generates_cashflow": False,
        },
    ],
)
def test_payment_rule_schema_rejects_unsafe_cashflow_contracts(invalid_rule: dict) -> None:
    with pytest.raises(ValidationError):
        ContractPaymentRuleProposal(
            **invalid_rule,
            citation=_citation(),
        )


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("1 200 000", 1200000),
        ("1.200.000", 1200000),
        ("1.200.000,50", 1200000.5),
        ("1,200,000.50", 1200000.5),
        ("1200000,50", 1200000.5),
    ],
)
def test_contract_amount_normalization_handles_czech_and_english_separators(source: str, expected: float) -> None:
    assert _normalize_number(source) == expected
