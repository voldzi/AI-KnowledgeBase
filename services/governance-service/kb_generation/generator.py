from __future__ import annotations

import re
import unicodedata

from app.evidence import citation_for_version, excerpt, source_for_version, unique_citations, unique_sources
from app.schemas import (
    GenerateKbArticleResponse,
    GovernanceSourceDocument,
    KbArticleDraft,
    KbArticleSection,
)


class KbArticleGenerator:
    def generate(
        self,
        *,
        result_id: str,
        source_document: GovernanceSourceDocument,
        audience: str,
        max_sections: int,
        warnings: list[str] | None = None,
    ) -> GenerateKbArticleResponse:
        sentence_records = _sentence_records(source_document)
        citations = [record[1] for record in sentence_records]
        if source_document.citations:
            citations = [*source_document.citations, *citations]

        sections = _sections(source_document, sentence_records, max_sections)
        article = KbArticleDraft(
            title=_title(source_document),
            summary=_summary(source_document, sentence_records, audience),
            sections=sections,
            publication_status="draft_proposal",
            registry_required_actions=[
                "Create knowledge_base_article draft in Registry API.",
                "Attach cited controlled document version as source metadata.",
                "Route article through owner/gestor review before publication.",
            ],
        )
        confidence = "high" if len(sentence_records) >= 4 else "medium"
        response_warnings = list(warnings or [])
        if not source_document.citations:
            response_warnings.append("SOURCE_DOCUMENT_CALLER_CITATIONS_MISSING")
        if len(sections) < 2:
            response_warnings.append("KB_ARTICLE_LOW_SOURCE_DETAIL")
            confidence = "low"

        return GenerateKbArticleResponse(
            result_id=result_id,
            article=article,
            citations=unique_citations([citation for section in sections for citation in section.citations] + citations[:1]),
            sources=unique_sources([source_for_version(source_document)]),
            confidence=confidence,
            warnings=response_warnings,
            missing_information=None if sentence_records else "No source content was available for article generation.",
        )


def _sentence_records(source: GovernanceSourceDocument) -> list[tuple[str, object]]:
    sentences = [
        sentence.strip()
        for sentence in re.split(r"(?<=[.!?])\s+|\n+", source.content)
        if sentence.strip()
    ]
    return [
        (
            sentence,
            citation_for_version(
                source,
                chunk_id=f"input:{source.document_version_id}:kb{sindex}",
                section_path=[f"sentence:{sindex}"],
                source_excerpt=excerpt(sentence),
            ),
        )
        for sindex, sentence in enumerate(sentences, start=1)
    ]


def _sections(
    source: GovernanceSourceDocument,
    records: list[tuple[str, object]],
    max_sections: int,
) -> list[KbArticleSection]:
    if not records:
        citation = citation_for_version(source, chunk_id=f"input:{source.document_version_id}", source_excerpt=excerpt(source.content))
        return [
            KbArticleSection(
                heading="Prehled",
                body=excerpt(source.content, 800),
                citations=[citation],
            )
        ]

    overview = _section(
        "Prehled",
        " ".join(sentence for sentence, _ in records[:2]),
        [citation for _, citation in records[:2]],
    )
    procedural = _matching_section(
        "Postup",
        records,
        ["postup", "zadost", "zadat", "musi", "krok", "predlozi", "obsahovat"],
    )
    approval = _matching_section(
        "Schvalovani a odpovednost",
        records,
        ["schvaluje", "schvaleni", "gestor", "vlastnik", "odpovednost", "owner"],
    )
    validity = _matching_section(
        "Platnost",
        records,
        ["platnost", "ucinnost", "valid", "archiv", "nahrazen"],
    )
    review = _section(
        "Pred publikaci",
        (
            "Tento clanek je navrh z rizeneho dokumentu. Pred publikaci musi zustat napojen "
            "na Registry workflow a projit kontrolou vlastnika dokumentu."
        ),
        [records[0][1]],
    )

    sections = [section for section in [overview, procedural, approval, validity, review] if section is not None]
    return sections[:max_sections]


def _matching_section(
    heading: str,
    records: list[tuple[str, object]],
    keywords: list[str],
) -> KbArticleSection | None:
    matches = [(sentence, citation) for sentence, citation in records if any(keyword in _norm(sentence) for keyword in keywords)]
    if not matches:
        return None
    selected = matches[:4]
    body = " ".join(sentence for sentence, _ in selected)
    return _section(heading, body, [citation for _, citation in selected])


def _section(heading: str, body: str, citations: list[object]) -> KbArticleSection:
    return KbArticleSection(
        heading=heading,
        body=excerpt(body, 1200),
        citations=citations,  # type: ignore[arg-type]
    )


def _title(source: GovernanceSourceDocument) -> str:
    clean_title = re.sub(r"^(smernice|metodika|policy|postup)\s+", "", source.document_title, flags=re.IGNORECASE)
    return f"KB: {clean_title}".strip()


def _summary(source: GovernanceSourceDocument, records: list[tuple[str, object]], audience: str) -> str:
    lead = " ".join(sentence for sentence, _ in records[:2]) if records else source.content
    return excerpt(f"Navrh pro audience={audience}. {lead}", 700)


def _norm(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", text)
    without_accents = "".join(char for char in normalized if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", without_accents.lower()).strip()
