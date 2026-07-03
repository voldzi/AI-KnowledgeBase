from __future__ import annotations

import logging

from app.errors import IngestionError
from app.ids import utcnow
from app.object_storage import ObjectStorageClient
from app.registry_client import RegistryClient
from app.schemas import IngestionQualityReport, IngestionReport, JobStatus, ReportMessage, StoredJob
from app.security import AuthContext
from app.store import JobStore
from chunkers.logical import LogicalStructureChunker
from embeddings.client import EmbeddingClient
from indexers.qdrant import QdrantIndexer
from parsers.base import ParserError
from parsers.router import ParserRouter

logger = logging.getLogger("akl.ingestion")


class IngestionPipeline:
    def __init__(
        self,
        *,
        store: JobStore,
        registry: RegistryClient,
        object_storage: ObjectStorageClient,
        parser_router: ParserRouter,
        chunker: LogicalStructureChunker,
        embedding_client: EmbeddingClient,
        indexer: QdrantIndexer,
    ) -> None:
        self.store = store
        self.registry = registry
        self.object_storage = object_storage
        self.parser_router = parser_router
        self.chunker = chunker
        self.embedding_client = embedding_client
        self.indexer = indexer

    async def run(
        self,
        stored_job: StoredJob,
        *,
        subject_id: str,
        auth_context: AuthContext | None = None,
    ) -> StoredJob:
        job_id = stored_job.job.job_id
        request = stored_job.request
        extraction_profile = stored_job.job.extraction_profile
        documents_processed = 0
        pages_processed = 0
        chunks_created = 0
        tables_detected = 0
        ocr_used = False
        warnings: list[ReportMessage] = []

        if self.store.get(job_id).job.status == JobStatus.cancelled:
            return self.store.get(job_id)

        self.store.update_status(job_id, JobStatus.running, started_at=utcnow())
        await self._audit(
            actor_id=subject_id,
            event_type="ingestion.job.started",
            resource_id=job_id,
            metadata={
                "document_id": request.document_id,
                "document_version_id": request.document_version_id,
                "extraction_profile": extraction_profile,
                "parser_profile": request.parser_profile,
                "chunking_strategy": request.chunking_strategy,
                "embedding_profile": request.embedding_profile,
            },
            auth_context=auth_context,
        )

        try:
            await self.registry.require_authorized(
                subject_id=subject_id,
                action="document.ingest",
                document_id=request.document_id,
                document_version_id=request.document_version_id,
                auth_context=auth_context,
            )
            document_metadata = await self.registry.get_document_metadata(
                request.document_id,
                request.document_version_id,
                auth_context=auth_context,
            )
            source = await self.object_storage.read(request.source_file_uri)
            parser_result = self.parser_router.parse(
                source,
                parser_profile=request.parser_profile,
                ocr_enabled=request.ocr_enabled,
            )
            pages_processed = parser_result.pages_processed
            tables_detected = parser_result.tables_detected
            ocr_used = parser_result.ocr_used
            warnings.extend(_messages(parser_result.warnings))
            quality = _quality_report(parser_result, extraction_profile=extraction_profile)
            warnings.extend(_quality_warnings(quality, source_mime_type=source.mime_type))

            chunking_result = self.chunker.chunk(
                parser_result,
                document_metadata=document_metadata,
                extraction_profile=extraction_profile,
                parser_profile=request.parser_profile,
                chunking_strategy=request.chunking_strategy,
                source=source,
            )
            warnings.extend(_messages(chunking_result.warnings))
            chunks = chunking_result.chunks
            chunks_created = len(chunks)

            if not chunks:
                raise IngestionError(
                    "NO_CHUNKS_CREATED",
                    "Ingestion produced no document chunks",
                    status_code=422,
                )
            if chunking_result.warnings and any(message.code == "CHUNK_LIMIT_EXCEEDED" for message in warnings):
                raise IngestionError(
                    "CHUNK_LIMIT_EXCEEDED",
                    "Ingestion produced more chunks than configured limit",
                    status_code=413,
                    details={"chunks_created": chunks_created},
                )

            embedding_batch = await self.embedding_client.embed_texts(
                [chunk.normalized_text for chunk in chunks],
                embedding_profile=request.embedding_profile,
                auth_context=auth_context,
            )
            indexing_result = await self.indexer.index(
                chunks=chunks,
                vectors=embedding_batch.vectors,
                embedding_model=embedding_batch.model,
            )
            documents_processed = 1
            final_status = JobStatus.completed_with_warnings if warnings else JobStatus.completed
            report = IngestionReport(
                job_id=job_id,
                status=final_status,
                documents_processed=documents_processed,
                pages_processed=pages_processed,
                chunks_created=chunks_created,
                tables_detected=tables_detected,
                ocr_used=ocr_used,
                quality=quality,
                warnings=warnings,
                errors=[],
            )
            self.store.update_status(job_id, final_status, finished_at=utcnow())
            updated = self.store.update_report(job_id, report)
            await self._audit(
                actor_id=subject_id,
                event_type="ingestion.job.completed",
                resource_id=job_id,
                metadata={
                    "document_id": request.document_id,
                    "document_version_id": request.document_version_id,
                    "extraction_profile": extraction_profile,
                    "chunks_created": chunks_created,
                    "indexed_chunks": indexing_result.indexed_chunks,
                    "ocr_used": ocr_used,
                    "quality_score": quality.quality_score,
                    "parser_engine": quality.parser_engine,
                    "status": final_status.value,
                },
                auth_context=auth_context,
            )
            logger.info(
                "ingestion_job_completed job_id=%s document_id=%s document_version_id=%s chunks_created=%s status=%s",
                job_id,
                request.document_id,
                request.document_version_id,
                chunks_created,
                final_status.value,
            )
            return updated

        except ParserError as exc:
            return await self._fail_job(
                stored_job,
                subject_id=subject_id,
                auth_context=auth_context,
                code=exc.code,
                message=exc.message,
                documents_processed=documents_processed,
                pages_processed=pages_processed,
                chunks_created=chunks_created,
                tables_detected=tables_detected,
                ocr_used=ocr_used,
                warnings=warnings,
            )
        except IngestionError as exc:
            return await self._fail_job(
                stored_job,
                subject_id=subject_id,
                auth_context=auth_context,
                code=exc.code,
                message=exc.message,
                documents_processed=documents_processed,
                pages_processed=pages_processed,
                chunks_created=chunks_created,
                tables_detected=tables_detected,
                ocr_used=ocr_used,
                warnings=warnings,
            )
        except Exception:
            logger.exception("ingestion_job_failed_unexpected job_id=%s", job_id)
            return await self._fail_job(
                stored_job,
                subject_id=subject_id,
                auth_context=auth_context,
                code="INTERNAL_ERROR",
                message="Unexpected ingestion pipeline error",
                documents_processed=documents_processed,
                pages_processed=pages_processed,
                chunks_created=chunks_created,
                tables_detected=tables_detected,
                ocr_used=ocr_used,
                warnings=warnings,
            )

    async def _fail_job(
        self,
        stored_job: StoredJob,
        *,
        subject_id: str,
        auth_context: AuthContext | None = None,
        code: str,
        message: str,
        documents_processed: int,
        pages_processed: int,
        chunks_created: int,
        tables_detected: int,
        ocr_used: bool,
        warnings: list[ReportMessage],
    ) -> StoredJob:
        job_id = stored_job.job.job_id
        request = stored_job.request
        error = ReportMessage(code=code, message=message)
        report = IngestionReport(
            job_id=job_id,
            status=JobStatus.failed,
            documents_processed=documents_processed,
            pages_processed=pages_processed,
            chunks_created=chunks_created,
            tables_detected=tables_detected,
            ocr_used=ocr_used,
            warnings=warnings,
            errors=[error],
        )
        self.store.update_status(job_id, JobStatus.failed, finished_at=utcnow())
        updated = self.store.update_report(job_id, report)
        await self._audit(
            actor_id=subject_id,
            event_type="ingestion.job.failed",
            resource_id=job_id,
            severity="error",
            metadata={
                "document_id": request.document_id,
                "document_version_id": request.document_version_id,
                "error_code": code,
            },
            auth_context=auth_context,
        )
        logger.warning(
            "ingestion_job_failed job_id=%s document_id=%s document_version_id=%s error_code=%s",
            job_id,
            request.document_id,
            request.document_version_id,
            code,
        )
        return updated

    async def _audit(
        self,
        *,
        actor_id: str,
        event_type: str,
        resource_id: str,
        severity: str = "info",
        metadata: dict | None = None,
        auth_context: AuthContext | None = None,
    ) -> None:
        try:
            await self.registry.write_audit_event(
                actor_id=actor_id,
                event_type=event_type,
                resource_id=resource_id,
                severity=severity,
                metadata=metadata,
                auth_context=auth_context,
            )
        except IngestionError as exc:
            logger.warning("audit_write_failed event_type=%s error_code=%s", event_type, exc.code)


def _messages(messages: list[tuple[str, str]]) -> list[ReportMessage]:
    return [ReportMessage(code=code, message=message) for code, message in messages]


def _quality_report(parser_result, *, extraction_profile: str) -> IngestionQualityReport:
    metadata = parser_result.metadata
    pages_processed = max(0, parser_result.pages_processed)
    pages_with_text = int(metadata.get("pages_with_text") or _pages_with_text(parser_result))
    empty_pages = [int(page) for page in metadata.get("empty_pages", []) if isinstance(page, int)]
    text_chars = int(metadata.get("text_chars_extracted") or parser_result.text_length)
    coverage = (pages_with_text / pages_processed) if pages_processed else 0.0
    expected_chars = max(1, pages_processed * 250)
    density = min(1.0, text_chars / expected_chars)
    quality_score = round(max(0.0, min(1.0, (coverage * 0.7) + (density * 0.3))), 2)

    return IngestionQualityReport(
        extraction_profile=extraction_profile,
        parser_name=parser_result.parser_name,
        parser_engine=metadata.get("parser_engine"),
        pages_processed=pages_processed,
        pages_with_text=pages_with_text,
        empty_pages=empty_pages[:100],
        text_chars_extracted=text_chars,
        tables_detected=parser_result.tables_detected,
        ocr_used=parser_result.ocr_used,
        quality_score=quality_score,
        capabilities=[str(item) for item in metadata.get("capabilities", [])],
    )


def _quality_warnings(quality: IngestionQualityReport, *, source_mime_type: str) -> list[ReportMessage]:
    if source_mime_type != "application/pdf" or quality.pages_processed <= 0:
        return []
    coverage = quality.pages_with_text / quality.pages_processed
    if coverage >= 0.6 or quality.ocr_used:
        return []
    return [
        ReportMessage(
            code="LOW_TEXT_COVERAGE",
            message=(
                "PDF text extraction covered fewer than 60% of pages. "
                "Verify OCR sidecar or a layout/OCR extraction profile before relying on this document."
            ),
        )
    ]


def _pages_with_text(parser_result) -> int:
    return len({block.page_number for block in parser_result.blocks if block.page_number and block.text.strip()})
