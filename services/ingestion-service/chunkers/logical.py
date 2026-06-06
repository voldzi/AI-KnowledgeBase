from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Any

from app.config import Settings
from app.object_storage import SourceObject
from app.schemas import DocumentChunk, DocumentMetadata
from parsers.base import ParsedBlock, ParserResult


@dataclass(frozen=True)
class ChunkingResult:
    chunks: list[DocumentChunk]
    warnings: list[tuple[str, str]]


class LogicalStructureChunker:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def chunk(
        self,
        parser_result: ParserResult,
        *,
        document_metadata: DocumentMetadata,
        parser_profile: str,
        chunking_strategy: str,
        source: SourceObject,
    ) -> ChunkingResult:
        chunks: list[DocumentChunk] = []
        warnings: list[tuple[str, str]] = []
        pending: list[ParsedBlock] = []

        for block in parser_result.blocks:
            if len(block.text) > self.settings.max_chunk_chars:
                if pending:
                    chunks.append(
                        self._make_chunk(
                            pending,
                            document_metadata=document_metadata,
                            parser_result=parser_result,
                            parser_profile=parser_profile,
                            chunking_strategy=chunking_strategy,
                            source=source,
                            chunk_index=len(chunks),
                        )
                    )
                    pending = []
                for piece in self._split_large_block(block):
                    chunks.append(
                        self._make_chunk(
                            [piece],
                            document_metadata=document_metadata,
                            parser_result=parser_result,
                            parser_profile=parser_profile,
                            chunking_strategy=chunking_strategy,
                            source=source,
                            chunk_index=len(chunks),
                        )
                    )
                continue

            section_changed = pending and pending[-1].section_path != block.section_path
            would_exceed_target = _text_length(pending) + len(block.text) > self.settings.chunk_target_chars
            if pending and (section_changed or would_exceed_target):
                chunks.append(
                    self._make_chunk(
                        pending,
                        document_metadata=document_metadata,
                        parser_result=parser_result,
                            parser_profile=parser_profile,
                            chunking_strategy=chunking_strategy,
                            source=source,
                        chunk_index=len(chunks),
                    )
                )
                pending = []

            pending.append(block)

        if pending:
            chunks.append(
                self._make_chunk(
                    pending,
                    document_metadata=document_metadata,
                    parser_result=parser_result,
                    parser_profile=parser_profile,
                    chunking_strategy=chunking_strategy,
                    source=source,
                    chunk_index=len(chunks),
                )
            )

        if len(chunks) > self.settings.max_chunks_per_job:
            warnings.append(
                (
                    "CHUNK_LIMIT_EXCEEDED",
                    "Chunk count exceeds configured job limit.",
                )
            )

        return ChunkingResult(chunks=chunks, warnings=warnings)

    def _make_chunk(
        self,
        blocks: list[ParsedBlock],
        *,
        document_metadata: DocumentMetadata,
        parser_result: ParserResult,
        parser_profile: str,
        chunking_strategy: str,
        source: SourceObject,
        chunk_index: int,
    ) -> DocumentChunk:
        first = blocks[0]
        last = blocks[-1]
        text = "\n\n".join(block.text for block in blocks).strip()
        normalized_text = normalize_text(text)
        text_hash = f"sha256:{hashlib.sha256(normalized_text.encode('utf-8')).hexdigest()}"
        chunk_id = _chunk_id(document_metadata.document_version_id, chunk_index, text_hash)
        metadata: dict[str, Any] = {
            "parser": parser_result.parser_name,
            "parser_profile": parser_profile,
            "chunking_strategy": chunking_strategy,
            "chunk_index": chunk_index,
            "source_file_sha256": source.sha256,
            "source_file_uri": source.uri,
            "source_file_name": source.filename,
            "source_mime_type": source.mime_type,
        }
        document_title = document_metadata.title or document_metadata.document_id
        version_label = document_metadata.version_label or document_metadata.document_version_id

        return DocumentChunk(
            chunk_id=chunk_id,
            document_id=document_metadata.document_id,
            document_version_id=document_metadata.document_version_id,
            document_title=document_title,
            version_label=version_label,
            document_type=document_metadata.document_type,
            text=text,
            normalized_text=normalized_text,
            page_number=first.page_number,
            section_path=first.section_path,
            section_title=first.section_title,
            article_number=first.article_number,
            paragraph_number=first.paragraph_number,
            source_file_uri=source.uri,
            source_file_name=source.filename,
            source_mime_type=source.mime_type,
            source_size_bytes=source.size_bytes,
            source_sha256=source.sha256,
            char_start=first.char_start,
            char_end=max(last.char_end, first.char_start + len(text)),
            text_hash=text_hash,
            classification=document_metadata.classification,
            tags=document_metadata.tags,
            valid_from=document_metadata.valid_from,
            valid_to=document_metadata.valid_to,
            status=document_metadata.status,
            access_scope=document_metadata.access_scope,
            metadata=metadata,
        )

    def _split_large_block(self, block: ParsedBlock) -> list[ParsedBlock]:
        pieces: list[ParsedBlock] = []
        text = block.text
        start = 0
        while start < len(text):
            end = min(start + self.settings.chunk_target_chars, len(text))
            if end < len(text):
                boundary = max(
                    text.rfind("\n", start, end),
                    text.rfind(". ", start, end),
                    text.rfind(" ", start, end),
                )
                if boundary > start + (self.settings.chunk_target_chars // 2):
                    end = boundary + 1
            piece_text = text[start:end].strip()
            if piece_text:
                pieces.append(
                    ParsedBlock(
                        text=piece_text,
                        page_number=block.page_number,
                        section_path=block.section_path,
                        section_title=block.section_title,
                        article_number=block.article_number,
                        paragraph_number=block.paragraph_number,
                        char_start=block.char_start + start,
                        char_end=block.char_start + end,
                        block_type=block.block_type,
                        metadata=block.metadata,
                    )
                )
            if end >= len(text):
                break
            start = max(end - self.settings.chunk_overlap_chars, start + 1)
        return pieces


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def _text_length(blocks: list[ParsedBlock]) -> int:
    return sum(len(block.text) for block in blocks) + max(0, len(blocks) - 1) * 2


def _chunk_id(document_version_id: str, chunk_index: int, text_hash: str) -> str:
    digest = hashlib.sha256(f"{document_version_id}:{chunk_index}:{text_hash}".encode("utf-8")).hexdigest()
    return f"chunk_{digest[:32]}"
