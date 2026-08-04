from __future__ import annotations

import json
from pathlib import Path

from app.controlled_rule_extraction import extract_controlled_rule_proposals
from app.schemas import ChunkCitation, RetrievedChunk
from tests.conftest import make_client


def _chunk(text: str, *, chunk_id: str = "chunk_procurement_1") -> RetrievedChunk:
    return RetrievedChunk(
        chunk_id=chunk_id,
        score=0.95,
        retrieval_method="opensearch",
        text=text,
        citation=ChunkCitation(
            document_id="doc_directive",
            document_version_id="ver_directive_1",
            document_title="Směrnice o zadávání veřejných zakázek",
            version_label="1",
            page_number=4,
            section_path=["Článek 6", "Odstavec 2"],
        ),
    )


def test_extracts_cited_financial_limit_deadline_and_obligation() -> None:
    proposals, missing, warnings = extract_controlled_rule_proposals(
        domain="public_procurement",
        chunks=[
            _chunk(
                "Příkazce operace musí u zakázky do 100 000 Kč bez DPH "
                "zajistit písemnou objednávku. Podklady předloží ve lhůtě "
                "10 pracovních dnů."
            )
        ]
    )

    assert missing == []
    assert warnings == ["CONTROLLED_RULE_UNMAPPED_CANDIDATES_SKIPPED"]
    categories = {proposal.category for proposal in proposals}
    assert categories == {"financial_limit"}
    financial = next(
        proposal for proposal in proposals if proposal.category == "financial_limit"
    )
    assert financial.value == 100000
    assert financial.currency == "CZK"
    assert financial.vat_basis == "excluding_vat"
    assert financial.responsible_roles == ["Příkazce operace"]
    assert financial.required_evidence == ["objednávku"]
    assert financial.citation.document_version_id == "ver_directive_1"
    assert financial.citation.quoted_text.startswith("Příkazce operace musí")
    assert financial.normative_key == "public_procurement.direct_purchase.threshold"


def test_deduplicates_same_rule_across_chunks() -> None:
    chunk = _chunk("Přímý nákup je možný do 20 000 Kč včetně DPH.")

    proposals, _, _ = extract_controlled_rule_proposals(
        chunks=[chunk, chunk],
        domain="public_procurement",
    )

    assert len(proposals) == 1
    assert proposals[0].value == 20000
    assert proposals[0].vat_basis == "including_vat"


def test_preserves_dot_separated_czech_financial_limits() -> None:
    proposals, missing, warnings = extract_controlled_rule_proposals(
        domain="public_procurement",
        chunks=[
            _chunk(
                "U zakázky vyšší než 20.000 Kč s DPH se provede průzkum trhu. "
                "VZMR I. kategorie je do 200.000 Kč bez DPH včetně."
            )
        ]
    )

    assert missing == []
    assert warnings == []
    financial = sorted(
        (
            proposal.value,
            proposal.vat_basis,
        )
        for proposal in proposals
        if proposal.category == "financial_limit"
    )
    assert financial == [
        (20000, "including_vat"),
        (200000, "excluding_vat"),
    ]
    keys = {proposal.normative_key for proposal in proposals}
    assert keys == {
        "public_procurement.market_research.threshold",
        "public_procurement.internal_category_1.upper_threshold",
    }


def test_returns_missing_information_without_inventing_rule() -> None:
    proposals, missing, warnings = extract_controlled_rule_proposals(
        domain="public_procurement",
        chunks=[_chunk("Tento dokument obsahuje obecný úvod a seznam kapitol.")]
    )

    assert proposals == []
    assert missing == ["NO_CITABLE_CONTROLLED_RULES_FOUND"]
    assert warnings == []


def test_controlled_rule_extraction_uses_authoring_authorization(monkeypatch) -> None:
    from app.service import RagRetrievalService

    captured: dict[str, str] = {}
    original = RagRetrievalService._filter_authorized_chunks

    async def capture_authorization(
        self,
        *,
        subject_id,
        chunks,
        auth_context=None,
        action="rag.query",
    ):
        captured["authorization_action"] = action
        return await original(
            self,
            subject_id=subject_id,
            chunks=chunks,
            auth_context=auth_context,
            action=action,
        )

    monkeypatch.setattr(
        RagRetrievalService,
        "_filter_authorized_chunks",
        capture_authorization,
    )
    with make_client() as client:
        response = client.post(
            "/api/v1/stratos/extractions/controlled-rules/propose",
            json={
                "tenant_id": "org_stratos",
                "external_system": "STRATOS_PLATFORM",
                "package_id": "cdpkg_test",
                "domain": "public_procurement",
                "documents": [
                    {
                        "document_id": "doc_123",
                        "document_version_id": "ver_456",
                    }
                ],
                "subject_id": "user_gestor",
                "profile": "controlled_document_rules_v1",
                "profile_version": "3",
                "classification_max": "internal",
            },
        )

    assert response.status_code == 200, response.text
    assert captured["authorization_action"] == "document.update"


def test_controlled_rule_extraction_scans_complete_exact_source(monkeypatch) -> None:
    from app.registry_client import MockRegistryClient
    from retrievers.mock import MockHybridRetriever

    stored_payload: dict[str, object] = {}
    original_store = MockRegistryClient.store_document_extraction

    async def capture_store(self, *, payload, auth_context=None):
        stored_payload.update(payload)
        return await original_store(
            self,
            payload=payload,
            auth_context=auth_context,
        )

    async def complete_source(self, *, filters, limit):
        assert filters.document_ids == ["doc_directive"]
        assert filters.document_version_ids == ["ver_directive_1"]
        assert limit > 50
        return [
            _chunk(
                "Nákup do 20 000 Kč včetně DPH lze uskutečnit po ověření ceny.",
                chunk_id="chunk_procurement_20k",
            ),
            _chunk(
                "Při předpokládané hodnotě nad 50 000 Kč včetně DPH musí "
                "příkazce operace doložit průzkum trhu.",
                chunk_id="chunk_procurement_50k",
            ),
        ]

    monkeypatch.setattr(MockHybridRetriever, "list_chunks", complete_source)
    monkeypatch.setattr(
        MockRegistryClient,
        "store_document_extraction",
        capture_store,
    )
    with make_client() as client:
        response = client.post(
            "/api/v1/stratos/extractions/controlled-rules/propose",
            json={
                "tenant_id": "org_stratos",
                "external_system": "STRATOS_PLATFORM",
                "package_id": "cdpkg_complete_scan",
                "domain": "public_procurement",
                "documents": [
                    {
                        "document_id": "doc_directive",
                        "document_version_id": "ver_directive_1",
                    }
                ],
                "subject_id": "user_gestor",
                "profile": "controlled_document_rules_v1",
                "profile_version": "3",
                "classification_max": "internal",
            },
        )

    assert response.status_code == 200, response.text
    body = response.json()
    limits = {
        proposal["value"]
        for proposal in body["rules"]
        if proposal["category"] == "financial_limit"
    }
    assert limits == {20000, 50000}
    assert body["metadata"]["retrieval_mode"] == "exact_source_scan"
    assert body["metadata"]["source_scan_chunk_count"] == 2

    assert stored_payload["refresh_existing"] is True


def test_controlled_rule_extraction_fails_closed_for_denied_source() -> None:
    with make_client(
        {
            "AKL_RAG_AUTHZ_MODE": "registry",
            "AKL_RAG_REGISTRY_CLIENT_MODE": "mock",
            "AKL_RAG_MOCK_DENIED_DOCUMENT_IDS": "doc_123",
        }
    ) as client:
        response = client.post(
            "/api/v1/stratos/extractions/controlled-rules/propose",
            json={
                "tenant_id": "org_stratos",
                "external_system": "STRATOS_PLATFORM",
                "package_id": "cdpkg_denied",
                "domain": "public_procurement",
                "documents": [
                    {
                        "document_id": "doc_123",
                        "document_version_id": "ver_456",
                    }
                ],
                "subject_id": "user_gestor",
                "profile": "controlled_document_rules_v1",
                "profile_version": "3",
                "classification_max": "internal",
            },
        )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CONTROLLED_DOCUMENT_ACCESS_DENIED"


def test_controlled_rule_extraction_scan_limit_remains_partial(monkeypatch) -> None:
    from app import service as service_module
    from retrievers.mock import MockHybridRetriever

    async def oversized_source(self, *, filters, limit):
        assert limit == 2
        return [
            _chunk("Limit je 20 000 Kč včetně DPH.", chunk_id="chunk_limit_1"),
            _chunk("Limit je 50 000 Kč včetně DPH.", chunk_id="chunk_limit_2"),
        ]

    monkeypatch.setattr(service_module, "CONTROLLED_RULE_SOURCE_SCAN_LIMIT", 1)
    monkeypatch.setattr(MockHybridRetriever, "list_chunks", oversized_source)
    with make_client() as client:
        response = client.post(
            "/api/v1/stratos/extractions/controlled-rules/propose",
            json={
                "tenant_id": "org_stratos",
                "external_system": "STRATOS_PLATFORM",
                "package_id": "cdpkg_scan_limit",
                "domain": "public_procurement",
                "documents": [
                    {
                        "document_id": "doc_directive",
                        "document_version_id": "ver_directive_1",
                    }
                ],
                "subject_id": "user_gestor",
                "profile": "controlled_document_rules_v1",
                "profile_version": "3",
                "classification_max": "internal",
            },
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "PARTIAL"
    assert "CONTROLLED_RULE_SOURCE_SCAN_LIMIT_REACHED" in body["missing_information"]


def test_keeps_procurement_threshold_with_required_follow_up() -> None:
    proposals, missing, warnings = extract_controlled_rule_proposals(
        domain="public_procurement",
        chunks=[
            _chunk(
                "Přesáhne-li předpokládaná hodnota 20.000 Kč včetně DPH, "
                "musí příkazce operace provést průzkum trhu. Průzkum trhu "
                "směřuje k získání nejméně tří porovnatelných cenových nabídek."
            )
        ]
    )

    assert missing == []
    assert warnings == []
    financial = next(
        proposal for proposal in proposals if proposal.category == "financial_limit"
    )
    assert financial.value == 20000
    assert financial.vat_basis == "including_vat"
    assert "průzkum trhu" in financial.citation.quoted_text
    assert financial.conditions
    assert financial.normative_key == "public_procurement.market_research.threshold"


def test_ignores_table_headers_and_generic_explanations() -> None:
    proposals, missing, warnings = extract_controlled_rule_proposals(
        domain="public_procurement",
        chunks=[
            _chunk(
                "Činnost | Gestor /příkazce | Nadřízený příkazce | VPÚ | PV. "
                "Za efektivní lze obecně považovat řešení s minimálními zdroji."
            )
        ]
    )

    assert proposals == []
    assert missing == ["NO_CITABLE_CONTROLLED_RULES_FOUND"]
    assert warnings == []


def test_extracts_catalogued_minimum_supplier_count() -> None:
    proposals, missing, warnings = extract_controlled_rule_proposals(
        domain="public_procurement",
        chunks=[
            _chunk(
                "Průzkum trhu směřuje k získání nejméně tří porovnatelných "
                "cenových nabídek."
            )
        ],
    )

    assert missing == []
    assert warnings == []
    assert len(proposals) == 1
    proposal = proposals[0]
    assert proposal.normative_key == "public_procurement.supplier_quotes.minimum_count"
    assert proposal.category == "condition"
    assert proposal.value == 3
    assert proposal.unit == "count"


def test_extracts_procurement_retention_period() -> None:
    proposals, missing, warnings = extract_controlled_rule_proposals(
        domain="public_procurement",
        chunks=[
            _chunk(
                "Dokumentaci k veřejné zakázce útvar archivuje po dobu 5 let "
                "od uzavření objednávky nebo smlouvy."
            )
        ],
    )

    assert missing == []
    assert warnings == []
    assert len(proposals) == 1
    proposal = proposals[0]
    assert proposal.normative_key == "public_procurement.retention.period"
    assert proposal.category == "deadline"
    assert proposal.value == 5
    assert proposal.unit == "let"


def test_separates_internal_category_and_legal_vzmr_upper_limits() -> None:
    proposals, missing, warnings = extract_controlled_rule_proposals(
        domain="public_procurement",
        chunks=[
            _chunk(
                "VZMR I. kategorie je rovna nebo nižší než 200 000 Kč bez DPH; "
                "VZMR II. kategorie na dodávky a služby je vyšší než 200 000 Kč "
                "a nižší nebo rovna 2 000 000 Kč bez DPH; VZMR II. kategorie na "
                "stavební práce je vyšší než 200 000 Kč a nižší nebo rovna "
                "6 000 000 Kč bez DPH."
            )
        ],
    )

    assert missing == []
    assert warnings == ["CONTROLLED_RULE_UNMAPPED_CANDIDATES_SKIPPED"]
    values_by_key = {
        proposal.normative_key: proposal.value
        for proposal in proposals
        if proposal.category == "financial_limit"
    }
    assert values_by_key == {
        "public_procurement.internal_category_1.upper_threshold": 200000,
        "public_procurement.vzmr.supplies_services.threshold": 2000000,
        "public_procurement.vzmr.works.threshold": 6000000,
    }


def test_extracts_current_vzmr_limits_from_line_split_official_law_pdf() -> None:
    proposals, missing, warnings = extract_controlled_rule_proposals(
        domain="public_procurement",
        chunks=[
            _chunk(
                "§ 27 Veřejná zakázka malého rozsahu\n"
                "Veřejnou zakázkou malého rozsahu je veřejná zakázka, jejíž "
                "předpokládaná hodnota je rovna nebo nižší v případě veřejné zakázky\n"
                "a) na dodávky nebo na služby částce 3 000 000 Kč, nebo\n"
                "b) na stavební práce částce 9 000 000 Kč.\n"
                "§ 28 Vymezení některých dalších pojmů"
            )
        ],
    )

    assert missing == []
    assert warnings == []
    values_by_key = {
        proposal.normative_key: proposal.value
        for proposal in proposals
        if proposal.category == "financial_limit"
    }
    assert values_by_key == {
        "public_procurement.vzmr.supplies_services.threshold": 3000000,
        "public_procurement.vzmr.works.threshold": 9000000,
    }
    assert all("malého rozsahu" in proposal.citation.quoted_text for proposal in proposals)


def test_public_procurement_extraction_emits_only_catalogued_keys() -> None:
    catalog_path = (
        Path(__file__).resolve().parents[3]
        / "contracts"
        / "controlled-rules"
        / "v1"
        / "public-procurement-normative-catalog.json"
    )
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    allowed = {
        key
        for definition in catalog["definitions"]
        for key in [definition["key"], *definition["aliases"]]
    }
    proposals, _, _ = extract_controlled_rule_proposals(
        domain="public_procurement",
        chunks=[
            _chunk(
                "Přímý nákup je možný do 20 000 Kč včetně DPH. "
                "Nad 50 000 Kč včetně DPH se provede průzkum trhu. "
                "VZMR na stavební práce je do 9 000 000 Kč bez DPH."
            )
        ],
    )

    assert proposals
    assert {proposal.normative_key for proposal in proposals} <= allowed
