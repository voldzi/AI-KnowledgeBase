from __future__ import annotations

import logging

from app.errors import IngestionError
from app.ids import utcnow
from app.object_storage import ObjectStorageClient
from app.registry_client import RegistryClient
from app.schemas import IngestionReport, JobStatus, ReportMessage, StoredJob
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

            chunking_result = self.chunker.chunk(
                parser_result,
                document_metadata=document_metadata,
                parser_profile=request.parser_profile,
                chunking_strategy=request.chunking_strategy,
                source_sha256=source.sha256,
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
                    "chunks_created": chunks_created,
                    "indexed_chunks": indexing_result.indexed_chunks,
                    "ocr_used": ocr_used,
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
