from __future__ import annotations

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
        chunks=[
            _chunk(
                "Příkazce operace musí u zakázky do 100 000 Kč bez DPH "
                "zajistit písemnou objednávku. Podklady předloží ve lhůtě "
                "10 pracovních dnů."
            )
        ]
    )

    assert missing == []
    assert warnings == []
    categories = {proposal.category for proposal in proposals}
    assert categories == {"financial_limit", "deadline"}
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


def test_deduplicates_same_rule_across_chunks() -> None:
    chunk = _chunk("Limit předpokládané hodnoty je do 20 000 Kč včetně DPH.")

    proposals, _, _ = extract_controlled_rule_proposals(chunks=[chunk, chunk])

    assert len(proposals) == 1
    assert proposals[0].value == 20000
    assert proposals[0].vat_basis == "including_vat"


def test_preserves_dot_separated_czech_financial_limits() -> None:
    proposals, missing, warnings = extract_controlled_rule_proposals(
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


def test_returns_missing_information_without_inventing_rule() -> None:
    proposals, missing, warnings = extract_controlled_rule_proposals(
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
                "profile_version": "2",
                "classification_max": "internal",
            },
        )

    assert response.status_code == 200, response.text
    assert captured["authorization_action"] == "document.update"


def test_controlled_rule_extraction_scans_complete_exact_source(monkeypatch) -> None:
    from retrievers.mock import MockHybridRetriever

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
                "profile_version": "2",
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
                "profile_version": "2",
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
                "profile_version": "2",
                "classification_max": "internal",
            },
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "PARTIAL"
    assert "CONTROLLED_RULE_SOURCE_SCAN_LIMIT_REACHED" in body["missing_information"]


def test_keeps_procurement_threshold_with_required_follow_up() -> None:
    proposals, missing, warnings = extract_controlled_rule_proposals(
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


def test_ignores_table_headers_and_generic_explanations() -> None:
    proposals, missing, warnings = extract_controlled_rule_proposals(
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
