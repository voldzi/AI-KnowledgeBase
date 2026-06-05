from __future__ import annotations

from app.schemas import (
    Citation,
    DocumentVersionContent,
    GovernanceSourceDocument,
    RetrievedChunk,
    SourceReference,
)


def excerpt(text: str, limit: int = 320) -> str:
    normalized = " ".join(text.split())
    if len(normalized) <= limit:
        return normalized
    return f"{normalized[: limit - 3].rstrip()}..."


def citation_for_version(
    version: DocumentVersionContent | GovernanceSourceDocument,
    *,
    chunk_id: str,
    section_path: list[str] | None = None,
    source_excerpt: str | None = None,
) -> Citation:
    return Citation(
        document_id=version.document_id,
        document_version_id=version.document_version_id,
        document_title=version.document_title,
        version_label=version.version_label,
        section_path=section_path or [],
        page_number=None,
        chunk_id=chunk_id,
        source_excerpt=source_excerpt,
    )


def source_for_version(
    version: DocumentVersionContent | GovernanceSourceDocument,
    *,
    source_id: str | None = None,
    citation: Citation | None = None,
) -> SourceReference:
    return SourceReference(
        source_id=source_id or version.document_version_id,
        source_type="input_document",
        document_id=version.document_id,
        document_version_id=version.document_version_id,
        title=f"{version.document_title} {version.version_label}",
        uri=version.source_uri,
        citation=citation,
    )


def citation_from_chunk(chunk: RetrievedChunk) -> Citation:
    return Citation(
        document_id=chunk.citation.document_id,
        document_version_id=chunk.citation.document_version_id,
        document_title=chunk.citation.document_title,
        version_label=chunk.citation.version_label,
        section_path=chunk.citation.section_path,
        page_number=chunk.citation.page_number,
        chunk_id=chunk.chunk_id,
        source_excerpt=excerpt(chunk.text),
    )


def source_from_chunk(chunk: RetrievedChunk) -> SourceReference:
    citation = citation_from_chunk(chunk)
    return SourceReference(
        source_id=chunk.chunk_id,
        source_type="retrieved_chunk",
        document_id=citation.document_id,
        document_version_id=citation.document_version_id,
        title=f"{citation.document_title} {citation.version_label}",
        uri=None,
        citation=citation,
    )


def unique_citations(citations: list[Citation]) -> list[Citation]:
    seen: set[tuple[str, str, str]] = set()
    unique: list[Citation] = []
    for citation in citations:
        key = (citation.document_id, citation.document_version_id, citation.chunk_id)
        if key in seen:
            continue
        seen.add(key)
        unique.append(citation)
    return unique


def unique_sources(sources: list[SourceReference]) -> list[SourceReference]:
    seen: set[str] = set()
    unique: list[SourceReference] = []
    for source in sources:
        if source.source_id in seen:
            continue
        seen.add(source.source_id)
        unique.append(source)
    return unique
