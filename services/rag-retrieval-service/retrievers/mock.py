from __future__ import annotations

from typing import Any

from app.config import Settings
from app.schemas import ChunkCitation, RagQueryFilters, RetrievedChunk
from retrievers.scoring import (
    cosine_similarity,
    deterministic_embedding,
    hybrid_score,
    payload_matches_filters,
    sparse_score,
)


class MockHybridRetriever:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._chunks = _mock_chunks()

    async def retrieve(
        self,
        *,
        query: str,
        filters: RagQueryFilters,
        limit: int,
        query_vector: list[float] | None = None,
    ) -> list[RetrievedChunk]:
        dense_query = query_vector or deterministic_embedding(query)
        results: list[RetrievedChunk] = []

        for chunk in self._chunks:
            if not payload_matches_filters(chunk["payload"], filters):
                continue

            dense = cosine_similarity(dense_query, deterministic_embedding(chunk["text"]))
            sparse = sparse_score(query, chunk["text"])
            score = hybrid_score(dense, sparse, self._settings.hybrid_dense_weight)
            results.append(
                _to_retrieved_chunk(
                    chunk,
                    score=score,
                    dense_score=dense,
                    sparse_score=sparse,
                )
            )

        return sorted(results, key=lambda item: item.score, reverse=True)[:limit]

    async def readiness(self) -> str:
        return "ready"

    async def list_document_titles(self, *, limit: int = 64) -> list[dict[str, str]]:
        seen: dict[str, dict[str, str]] = {}
        for chunk in self._chunks:
            payload = chunk.get("payload", {})
            document_id = str(payload.get("document_id") or "")
            title = str(payload.get("document_title") or "").strip()
            if not document_id or not title or document_id in seen:
                continue
            seen[document_id] = {
                "document_title": title,
                "document_type": str(payload.get("document_type") or ""),
            }
            if len(seen) >= limit:
                break
        return list(seen.values())

    async def get_chunk(self, chunk_id: str) -> RetrievedChunk | None:
        for chunk in self._chunks:
            if chunk["chunk_id"] == chunk_id:
                return _to_retrieved_chunk(
                    chunk,
                    score=1.0,
                    dense_score=1.0,
                    sparse_score=1.0,
                )
        return None


def _to_retrieved_chunk(
    chunk: dict[str, Any],
    *,
    score: float,
    dense_score: float,
    sparse_score: float,
) -> RetrievedChunk:
    payload = chunk["payload"]
    return RetrievedChunk(
        chunk_id=chunk["chunk_id"],
        score=round(score, 6),
        retrieval_method="hybrid",
        text=chunk["text"],
        citation=ChunkCitation(
            document_id=payload["document_id"],
            document_version_id=payload["document_version_id"],
            document_title=payload["document_title"],
            version_label=payload["version_label"],
            page_number=payload.get("page_number"),
            section_path=payload.get("section_path", []),
            article_number=payload.get("article_number"),
            paragraph_number=payload.get("paragraph_number"),
        ),
        metadata={
            "dense_score": round(dense_score, 6),
            "sparse_score": round(sparse_score, 6),
            "document_type": payload.get("document_type"),
            "classification": payload.get("classification"),
            "tags": payload.get("tags", []),
            "status": payload.get("status"),
            "source_file_uri": payload.get("source_file_uri"),
            "source_file_name": payload.get("source_file_name"),
            "source_mime_type": payload.get("source_mime_type"),
            "source_size_bytes": payload.get("source_size_bytes"),
            "source_sha256": payload.get("source_sha256"),
            "section_title": payload.get("section_title"),
            "char_start": payload.get("char_start"),
            "char_end": payload.get("char_end"),
            "parser_name": payload.get("parser_name"),
            "parser_engine": payload.get("parser_engine"),
            "ocr_used": payload.get("ocr_used"),
            "quality_score": payload.get("quality_score"),
            "quality_tier": payload.get("quality_tier"),
            "requires_review": payload.get("requires_review"),
            "parser_quality": payload.get("parser_quality"),
        },
    )


def _mock_chunks() -> list[dict[str, Any]]:
    return [
        {
            "chunk_id": "chunk_contract_1",
            "text": (
                "Smlouva č.: 256-2022-S. Dodavatel: AUTOCONT a.s. Objednatel: Město Železná Lhota. "
                "Datum podpisu: 1. 6. 2026. Účinnost od: 1. 7. 2026. "
                "Cena bez DPH činí 1 200 000 Kč, cena včetně DPH činí 1 452 000 Kč. DPH 21 %. "
                "Splatnost faktur je 30 dnů od doručení. Jednorázově bude po akceptaci uhrazeno 240 000 Kč. "
                "Měsíčně bude zpětně hrazen paušál 100 000 Kč. "
                "Smluvní pokuta za prodlení je 0,05 % denně. SLA dostupnost služby 99,5 %. "
                "VZ: NEN-2026-001. RP: IT-2026-04."
            ),
            "payload": {
                "document_id": "doc_contract",
                "document_version_id": "ver_contract_1",
                "document_title": "Smlouva 256-2022-S - Zajištění provozu služeb",
                "version_label": "1.0",
                "document_type": "contract",
                "classification": "internal",
                "status": "valid",
                "tags": ["budget-contract:contract-uuid", "stratos_budget"],
                "page_number": 2,
                "section_path": ["Smluvní strany", "Cena a platební podmínky"],
                "article_number": "3",
                "paragraph_number": "1",
                "source_file_uri": "s3://akl-documents/stratos/contracts/256-2022-S.pdf",
                "source_file_name": "256-2022-S.pdf",
                "source_mime_type": "application/pdf",
                "source_size_bytes": 4096,
                "source_sha256": "sha256:contract-mock",
                "section_title": "Cena a platební podmínky",
                "char_start": 0,
                "char_end": 650,
            },
        },
        {
            "chunk_id": "chunk_archflow_goal_1",
            "text": (
                "Strategický cíl: Zvýšit dostupnost digitálních služeb na 99,9 %. "
                "Organizace musí zajistit monitoring dostupnosti každý měsíc pro klíčové služby. "
                "Požadavek: Systém reportuje dostupnost služby každý měsíc. "
                "Metrika: Dostupnost služby cílová hodnota 99,9 %, měsíčně. "
                "Právní opora vyplývá z metodiky digitální správy a interní strategie služeb. "
                "Riziko neplnění: výpadek digitální služby a nesoulad s očekávanou úrovní služeb."
            ),
            "payload": {
                "document_id": "doc_archflow_goals",
                "document_version_id": "ver_archflow_goals_1",
                "document_title": "Strategie digitálních služeb úřadu",
                "version_label": "1.0",
                "document_type": "methodology",
                "classification": "internal",
                "status": "valid",
                "tags": ["archflow", "goal-catalog", "source-set:srcset-1", "catalog-version:catver-1"],
                "page_number": 12,
                "section_path": ["Digitální transformace", "Dostupnost služeb"],
                "article_number": None,
                "paragraph_number": "2",
                "source_file_uri": "s3://akl-documents/stratos/archflow/digitalni-sluzby.pdf",
                "source_file_name": "digitalni-sluzby.pdf",
                "source_mime_type": "application/pdf",
                "source_size_bytes": 8192,
                "source_sha256": "sha256:archflow-goals-mock",
                "section_title": "Dostupnost služeb",
                "char_start": 0,
                "char_end": 720,
            },
        },
        {
            "chunk_id": "chunk_archflow_package_1",
            "text": (
                "Cílová architektura popisuje aplikační vrstvy a hranice řešení pro Portál služeb. "
                "Architektonické rozhodnutí ADR-12 stanovuje využití API gateway pro externí integrace. "
                "Integrace musí používat OpenAPI specifikaci a auditní korelační identifikátor. "
                "Bezpečnost vyžaduje klasifikaci dat, šifrování přenosu a auditní stopu. "
                "Riziko: chybí doplnit rozhodnutí pro archivaci integračních zpráv."
            ),
            "payload": {
                "document_id": "doc_archflow_package",
                "document_version_id": "ver_archflow_package_1",
                "document_title": "Architektonický balíček Portálu služeb",
                "version_label": "1.0",
                "document_type": "project_documentation",
                "classification": "internal",
                "status": "valid",
                "tags": [
                    "archflow",
                    "STRATOS_ARCHFLOW",
                    "need:need-1",
                    "architecture-artifact:artifact-package-1",
                    "artifact-type:TARGET_ARCHITECTURE",
                ],
                "page_number": 8,
                "section_path": ["Architektonický balíček", "Cílová architektura"],
                "article_number": None,
                "paragraph_number": "4",
                "source_file_uri": "s3://akl-documents/stratos/archflow/target-architecture.pdf",
                "source_file_name": "target-architecture.pdf",
                "source_mime_type": "application/pdf",
                "source_size_bytes": 12288,
                "source_sha256": "sha256:archflow-package-mock",
                "section_title": "Cílová architektura",
                "char_start": 0,
                "char_end": 820,
            },
        },
        {
            "chunk_id": "chunk_archflow_handover_1",
            "text": (
                "As-built skutečné provedení potvrzuje nasazení integrační služby ve verzi 2.1. "
                "Předávací balíček obsahuje provozní runbook, monitoring dostupnosti a postup zálohování. "
                "Vlastník služby je Odbor informatiky a správcem je tým provozu aplikací. "
                "Akceptace je doložena integračním testem a evidencí provozního převzetí. "
                "Reziduální riziko: otevřené riziko nedokončené automatizace obnovy po havárii."
            ),
            "payload": {
                "document_id": "doc_archflow_handover",
                "document_version_id": "ver_archflow_handover_1",
                "document_title": "As-built a předávací balíček Portálu služeb",
                "version_label": "1.0",
                "document_type": "project_documentation",
                "classification": "internal",
                "status": "valid",
                "tags": [
                    "archflow",
                    "STRATOS_ARCHFLOW",
                    "need:need-1",
                    "architecture-artifact:artifact-handover-1",
                    "artifact-type:HANDOVER_PACKAGE",
                ],
                "page_number": 14,
                "section_path": ["Předání do provozu", "As-built"],
                "article_number": None,
                "paragraph_number": "6",
                "source_file_uri": "s3://akl-documents/stratos/archflow/handover-package.pdf",
                "source_file_name": "handover-package.pdf",
                "source_mime_type": "application/pdf",
                "source_size_bytes": 16384,
                "source_sha256": "sha256:archflow-handover-mock",
                "section_title": "As-built",
                "char_start": 0,
                "char_end": 760,
            },
        },
        {
            "chunk_id": "chunk_789",
            "text": (
                "Vyjimku ze smernice schvaluje gestor dokumentu po posouzeni dopadu. "
                "Zadost musi obsahovat duvod, rozsah a dobu platnosti vyjimky."
            ),
            "payload": {
                "document_id": "doc_123",
                "document_version_id": "ver_456",
                "document_title": "Smernice pro spravu dokumentu",
                "version_label": "1.0",
                "document_type": "directive",
                "classification": "internal",
                "status": "valid",
                "tags": ["smernice", "vyjimky", "schvalovani"],
                "page_number": 7,
                "section_path": ["Cl. 4", "Odst. 2"],
                "article_number": "4",
                "paragraph_number": "2",
                "source_file_uri": "s3://akl-documents/doc_123/ver_456/source.md",
                "source_file_name": "source.md",
                "source_mime_type": "text/markdown",
                "source_size_bytes": 2048,
                "source_sha256": "sha256:mock",
                "section_title": "Vyjimky",
                "char_start": 120,
                "char_end": 310,
            },
        },
        {
            "chunk_id": "chunk_validity_1",
            "text": (
                "Platna verze rizeneho dokumentu je verze se stavem valid a s aktualnim obdobim "
                "platnosti. Archivni a nahrazene verze se pouzivaji pouze jako historicky zdroj."
            ),
            "payload": {
                "document_id": "doc_124",
                "document_version_id": "ver_457",
                "document_title": "Metodika rizeni platnosti dokumentu",
                "version_label": "2.1",
                "document_type": "methodology",
                "classification": "internal",
                "status": "valid",
                "tags": ["platnost", "verze"],
                "page_number": 3,
                "section_path": ["Kap. 2"],
                "article_number": None,
                "paragraph_number": None,
            },
        },
        {
            "chunk_id": "chunk_public_kb_1",
            "text": (
                "Knowledge base clanek popisuje zakladni postup vyhledani dokumentu podle nazvu, "
                "gestora nebo tematickych tagu."
            ),
            "payload": {
                "document_id": "doc_125",
                "document_version_id": "ver_458",
                "document_title": "Jak hledat dokumenty v AKB",
                "version_label": "1.0",
                "document_type": "knowledge_base_article",
                "classification": "public",
                "status": "valid",
                "tags": ["vyhledavani", "akl"],
                "page_number": 1,
                "section_path": ["Uvod"],
                "article_number": None,
                "paragraph_number": None,
            },
        },
        {
            "chunk_id": "chunk_denied_1",
            "text": "Tajne pravidlo pro krizove vyjimky smi cist pouze specialni bezpecnostni role.",
            "payload": {
                "document_id": "doc_denied",
                "document_version_id": "ver_denied",
                "document_title": "Omezeny bezpecnostni postup",
                "version_label": "1.0",
                "document_type": "policy",
                "classification": "confidential",
                "status": "valid",
                "tags": ["tajne", "bezpecnost"],
                "page_number": 11,
                "section_path": ["Sec. 9"],
                "article_number": "9",
                "paragraph_number": "1",
            },
        },
    ]
