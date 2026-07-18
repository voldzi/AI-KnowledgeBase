from __future__ import annotations

import json
import logging
import re
import ssl
from dataclasses import dataclass
from hashlib import sha1, sha256
from itertools import combinations
from typing import Any

import httpx

from app.config import Settings
from app.errors import IngestionError
from app.ids import utcnow
from app.schemas import (
    AnalystSearchRequest,
    AnalystSearchResponse,
    DocumentChunk,
    EntityFacetBucket,
    EntityFacetGroup,
    EntityFacetReport,
    EntityRelationshipEdge,
    EntityRelationshipEndpoint,
    EntityRelationshipEvidence,
    EntityRelationshipRequest,
    EntityRelationshipResponse,
    EntitySearchHit,
    EntitySearchRequest,
    EntitySearchResponse,
    ReportMessage,
)
from intelligence.entities import intelligence_payload_fields
from indexers.qdrant import IndexingResult

logger = logging.getLogger(__name__)


class OpenSearchIndexer:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def readiness(self) -> str:
        try:
            async with self._client() as client:
                response = await client.get(
                    f"{self.settings.opensearch_base_url}/{self.settings.opensearch_index}",
                    headers=self._headers(),
                )
            allowed_statuses = {200, 404} if self.settings.opensearch_auto_create_index else {200}
            return "ready" if response.status_code in allowed_statuses else "not_ready"
        except (httpx.HTTPError, OSError):
            return "not_ready"

    async def index(
        self,
        *,
        chunks: list[DocumentChunk],
        vectors: list[list[float]],
        embedding_model: str,
    ) -> IndexingResult:
        del vectors
        if not chunks:
            return IndexingResult(indexed_chunks=0)

        await self._ensure_index()
        if self.settings.opensearch_delete_existing_version:
            await self._delete_existing_version(chunks[0].document_version_id)
        await self._bulk_upsert(chunks, embedding_model=embedding_model)
        return IndexingResult(indexed_chunks=len(chunks))

    async def _ensure_index(self) -> None:
        async with self._client() as client:
            response = await client.get(
                f"{self.settings.opensearch_base_url}/{self.settings.opensearch_index}",
                headers=self._headers(),
            )
            if response.status_code == 200:
                await self._ensure_entity_mapping(client)
                return
            if response.status_code != 404:
                raise IngestionError(
                    "OPENSEARCH_INDEX_CHECK_FAILED",
                    "OpenSearch index check failed",
                    status_code=502,
                    details={"status_code": response.status_code},
                )
            if not self.settings.opensearch_auto_create_index:
                raise IngestionError(
                    "OPENSEARCH_INDEX_NOT_FOUND",
                    "Configured OpenSearch index or alias does not exist",
                    status_code=503,
                    details={"index_name": self.settings.opensearch_index},
                )
            create_response = await client.put(
                f"{self.settings.opensearch_base_url}/{self.settings.opensearch_index}",
                headers=self._headers(),
                json=_index_definition(),
            )
        if create_response.status_code >= 400:
            raise IngestionError(
                "OPENSEARCH_INDEX_CREATE_FAILED",
                "OpenSearch index could not be created",
                status_code=502,
                details={"status_code": create_response.status_code},
            )

    async def _ensure_entity_mapping(self, client: httpx.AsyncClient) -> None:
        response = await client.put(
            f"{self.settings.opensearch_base_url}/{self.settings.opensearch_index}/_mapping",
            headers=self._headers(),
            json={
                "properties": {
                    "entity_types": {"type": "keyword"},
                    "entity_values": {"type": "keyword"},
                    "entity_pairs": {"type": "keyword"},
                    "organization_id": {"type": "keyword"},
                    "policy_binding_id": {"type": "keyword"},
                    "policy_version": {"type": "keyword"},
                    "policy_hash": {"type": "keyword"},
                    "authorization_key": {"type": "keyword"},
                    "policy_summary": {
                        "properties": {
                            "handlingClass": {"type": "keyword"},
                            "legalClassification": {"type": "keyword"},
                            "tlp": {"type": "keyword"},
                            "pap": {"type": "keyword"},
                            "obligations": {"type": "keyword"},
                            "audience": {
                                "properties": {
                                    "organizationId": {"type": "keyword"},
                                    "scopeType": {"type": "keyword"},
                                    "scopeIds": {"type": "keyword"},
                                    "recipientSubjectIds": {"type": "keyword"},
                                }
                            },
                        }
                    },
                }
            },
        )
        if response.status_code >= 400:
            raise IngestionError(
                "OPENSEARCH_MAPPING_UPDATE_FAILED",
                "OpenSearch mapping update failed",
                status_code=502,
                details={"status_code": response.status_code},
            )

    async def entity_facets(
        self,
        *,
        limit: int = 8,
        value_limit: int = 10,
        authorized_documents: list[dict[str, str]] | None = None,
    ) -> EntityFacetReport:
        await self._ensure_index()
        pair_limit = max(limit * value_limit, value_limit)
        query = {
            "size": 0,
            "track_total_hits": True,
            "aggs": {
                "chunks_with_entities": {"filter": {"exists": {"field": "entity_pairs"}}},
                "entity_types": {"terms": {"field": "entity_types", "size": limit}},
                "entity_pairs": {"terms": {"field": "entity_pairs", "size": pair_limit}},
            },
        }
        if authorized_documents:
            query["query"] = _authorized_coordinate_filter(authorized_documents)
        async with self._client() as client:
            response = await client.post(
                f"{self.settings.opensearch_base_url}/{self.settings.opensearch_index}/_search",
                headers=self._headers(),
                json=query,
            )
        if response.status_code == 404:
            return EntityFacetReport(
                status="unavailable",
                index_name=self.settings.opensearch_index,
                total_chunks=0,
                chunks_with_entities=0,
                generated_at=utcnow(),
                warnings=[
                    ReportMessage(
                        code="OPENSEARCH_INDEX_NOT_FOUND",
                        message="OpenSearch chunk index does not exist yet.",
                    )
                ],
            )
        if response.status_code >= 400:
            raise IngestionError(
                "OPENSEARCH_ENTITY_FACETS_FAILED",
                "OpenSearch entity facet aggregation failed",
                status_code=502,
                details={"status_code": response.status_code},
            )
        return _entity_facets_from_search(
            response.json(),
            index_name=self.settings.opensearch_index,
            value_limit=value_limit,
        )

    async def entity_search(self, request: EntitySearchRequest) -> EntitySearchResponse:
        if not request.allowed_document_ids:
            return EntitySearchResponse(
                status="ready",
                index_name=self.settings.opensearch_index,
                total_hits=0,
                returned_hits=0,
                hits=[],
                generated_at=utcnow(),
                warnings=[
                    ReportMessage(
                        code="NO_AUTHORIZED_DOCUMENTS",
                        message="No authorized document ids were provided for the entity search.",
                    )
                ],
            )
        if not any((request.query, request.entity_type, request.entity_value)):
            return EntitySearchResponse(
                status="ready",
                index_name=self.settings.opensearch_index,
                total_hits=0,
                returned_hits=0,
                hits=[],
                generated_at=utcnow(),
                warnings=[
                    ReportMessage(
                        code="ENTITY_SEARCH_EMPTY_QUERY",
                        message="Provide a text query or an entity filter.",
                    )
                ],
            )

        await self._ensure_index()
        query = _entity_search_query(request)
        async with self._client() as client:
            response = await client.post(
                f"{self.settings.opensearch_base_url}/{self.settings.opensearch_index}/_search",
                headers=self._headers(),
                json=query,
            )
        if response.status_code == 404:
            return EntitySearchResponse(
                status="unavailable",
                index_name=self.settings.opensearch_index,
                total_hits=0,
                returned_hits=0,
                hits=[],
                generated_at=utcnow(),
                warnings=[
                    ReportMessage(
                        code="OPENSEARCH_INDEX_NOT_FOUND",
                        message="OpenSearch chunk index does not exist yet.",
                    )
                ],
            )
        if response.status_code >= 400:
            raise IngestionError(
                "OPENSEARCH_ENTITY_SEARCH_FAILED",
                "OpenSearch entity search failed",
                status_code=502,
                details={"status_code": response.status_code},
            )
        return _entity_search_from_search(
            response.json(),
            index_name=self.settings.opensearch_index,
        )

    async def analyst_search(self, request: AnalystSearchRequest) -> AnalystSearchResponse:
        if not request.allowed_document_ids:
            return AnalystSearchResponse(
                status="ready",
                index_name=self.settings.opensearch_index,
                query_mode=request.query_mode,
                total_hits=0,
                returned_hits=0,
                hits=[],
                generated_at=utcnow(),
                warnings=[
                    ReportMessage(
                        code="NO_AUTHORIZED_DOCUMENTS",
                        message="No authorized document ids were provided for the analyst search.",
                    )
                ],
            )
        if not request.query:
            return AnalystSearchResponse(
                status="ready",
                index_name=self.settings.opensearch_index,
                query_mode=request.query_mode,
                total_hits=0,
                returned_hits=0,
                hits=[],
                generated_at=utcnow(),
                warnings=[
                    ReportMessage(
                        code="ANALYST_SEARCH_EMPTY_QUERY",
                        message="Provide an analyst search query.",
                    )
                ],
            )

        await self._ensure_index()
        query = _analyst_search_query(request)
        async with self._client() as client:
            response = await client.post(
                f"{self.settings.opensearch_base_url}/{self.settings.opensearch_index}/_search",
                headers=self._headers(),
                json=query,
            )
        if response.status_code == 404:
            return AnalystSearchResponse(
                status="unavailable",
                index_name=self.settings.opensearch_index,
                query_mode=request.query_mode,
                total_hits=0,
                returned_hits=0,
                hits=[],
                generated_at=utcnow(),
                warnings=[
                    ReportMessage(
                        code="OPENSEARCH_INDEX_NOT_FOUND",
                        message="OpenSearch chunk index does not exist yet.",
                    )
                ],
            )
        if response.status_code >= 400:
            raise IngestionError(
                "OPENSEARCH_ANALYST_SEARCH_FAILED",
                "OpenSearch analyst search failed",
                status_code=502,
                details={"status_code": response.status_code, "query_mode": request.query_mode},
            )
        return _analyst_search_from_search(
            response.json(),
            index_name=self.settings.opensearch_index,
            query_mode=request.query_mode,
        )

    async def entity_relationships(self, request: EntityRelationshipRequest) -> EntityRelationshipResponse:
        if not request.allowed_document_ids:
            return EntityRelationshipResponse(
                status="ready",
                index_name=self.settings.opensearch_index,
                total_edges=0,
                returned_edges=0,
                edges=[],
                generated_at=utcnow(),
                warnings=[
                    ReportMessage(
                        code="NO_AUTHORIZED_DOCUMENTS",
                        message="No authorized document ids were provided for the relationship graph.",
                    )
                ],
            )

        await self._ensure_index()
        query = _entity_relationship_query(request)
        async with self._client() as client:
            response = await client.post(
                f"{self.settings.opensearch_base_url}/{self.settings.opensearch_index}/_search",
                headers=self._headers(),
                json=query,
            )
        if response.status_code == 404:
            return EntityRelationshipResponse(
                status="unavailable",
                index_name=self.settings.opensearch_index,
                total_edges=0,
                returned_edges=0,
                edges=[],
                generated_at=utcnow(),
                warnings=[
                    ReportMessage(
                        code="OPENSEARCH_INDEX_NOT_FOUND",
                        message="OpenSearch chunk index does not exist yet.",
                    )
                ],
            )
        if response.status_code >= 400:
            raise IngestionError(
                "OPENSEARCH_ENTITY_RELATIONSHIPS_FAILED",
                "OpenSearch entity relationship graph failed",
                status_code=502,
                details={"status_code": response.status_code},
            )
        return _entity_relationships_from_search(
            response.json(),
            index_name=self.settings.opensearch_index,
            request=request,
        )

    async def _delete_existing_version(self, document_version_id: str) -> None:
        query = {"query": {"term": {"document_version_id": document_version_id}}}
        async with self._client() as client:
            response = await client.post(
                f"{self.settings.opensearch_base_url}/{self.settings.opensearch_index}/_delete_by_query",
                params={"refresh": "true", "conflicts": "proceed"},
                headers=self._headers(),
                json=query,
            )
        if response.status_code == 404:
            return
        if response.status_code >= 400:
            raise IngestionError(
                "OPENSEARCH_DELETE_FAILED",
                "OpenSearch failed to delete existing chunks for document version",
                status_code=502,
                details={"status_code": response.status_code},
            )

    async def _bulk_upsert(self, chunks: list[DocumentChunk], *, embedding_model: str) -> None:
        lines: list[str] = []
        for chunk in chunks:
            lines.append(json.dumps({"index": {"_index": self.settings.opensearch_index, "_id": chunk.chunk_id}}))
            lines.append(json.dumps(self._document(chunk, embedding_model=embedding_model), ensure_ascii=False))
        payload = "\n".join(lines) + "\n"
        headers = {**self._headers(), "Content-Type": "application/x-ndjson"}
        async with self._client() as client:
            response = await client.post(
                f"{self.settings.opensearch_base_url}/_bulk",
                params={"refresh": "true"},
                headers=headers,
                content=payload.encode("utf-8"),
            )
        if response.status_code >= 400:
            raise IngestionError(
                "OPENSEARCH_BULK_UPSERT_FAILED",
                "OpenSearch bulk upsert failed",
                status_code=502,
                details={"status_code": response.status_code},
            )
        body = response.json()
        if body.get("errors"):
            raise IngestionError(
                "OPENSEARCH_BULK_UPSERT_FAILED",
                "OpenSearch bulk upsert reported item errors",
                status_code=502,
                details={"items": _bulk_errors(body)},
            )

    def _document(self, chunk: DocumentChunk, *, embedding_model: str) -> dict[str, Any]:
        payload = chunk.model_dump(mode="json")
        for key in ("tenant_id", "external_system", "external_ref"):
            if payload.get(key) is None:
                payload.pop(key, None)
        chunk_metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
        payload.update(intelligence_payload_fields(chunk_metadata))
        payload["authorization_key"] = _authorization_key(
            chunk.document_id,
            chunk.document_version_id,
            chunk.policy_hash,
        )
        payload["embedding_model"] = embedding_model
        payload["search_text"] = "\n".join(
            value
            for value in (
                payload.get("document_title"),
                payload.get("section_title"),
                " / ".join(payload.get("section_path") or []),
                payload.get("text"),
                " ".join(payload.get("entity_values") or []),
                " ".join(payload.get("entity_pairs") or []),
            )
            if isinstance(value, str) and value.strip()
        )
        return payload

    def _headers(self) -> dict[str, str]:
        return {}

    def _client(self) -> httpx.AsyncClient:
        kwargs: dict[str, Any] = {
            "timeout": self.settings.request_timeout_seconds,
            "verify": _opensearch_tls_verifier(self.settings.opensearch_ca_file),
        }
        if self.settings.opensearch_username and self.settings.opensearch_password:
            kwargs["auth"] = httpx.BasicAuth(
                self.settings.opensearch_username,
                self.settings.opensearch_password,
            )
        return httpx.AsyncClient(**kwargs)


@dataclass(frozen=True)
class CompositeIndexer:
    indexers: tuple[Any, ...]

    async def readiness(self) -> str:
        statuses = [await indexer.readiness() for indexer in self.indexers]
        return "ready" if all(status in {"ready", "mock"} for status in statuses) else "not_ready"

    async def index(
        self,
        *,
        chunks: list[DocumentChunk],
        vectors: list[list[float]],
        embedding_model: str,
    ) -> IndexingResult:
        for indexer in self.indexers:
            await indexer.index(chunks=chunks, vectors=vectors, embedding_model=embedding_model)
        return IndexingResult(indexed_chunks=len(chunks))

    async def entity_facets(
        self,
        *,
        limit: int = 8,
        value_limit: int = 10,
        authorized_documents: list[dict[str, str]] | None = None,
    ) -> EntityFacetReport:
        for indexer in self.indexers:
            if hasattr(indexer, "entity_facets"):
                return await indexer.entity_facets(
                    limit=limit,
                    value_limit=value_limit,
                    authorized_documents=authorized_documents,
                )
        return EntityFacetReport(
            status="unavailable",
            index_name="none",
            total_chunks=0,
            chunks_with_entities=0,
            generated_at=utcnow(),
            warnings=[
                ReportMessage(
                    code="OPENSEARCH_INDEXER_NOT_CONFIGURED",
                    message="OpenSearch indexer is not configured for entity facets.",
                )
            ],
        )

    async def entity_search(self, request: EntitySearchRequest) -> EntitySearchResponse:
        for indexer in self.indexers:
            if hasattr(indexer, "entity_search"):
                return await indexer.entity_search(request)
        return EntitySearchResponse(
            status="unavailable",
            index_name="none",
            total_hits=0,
            returned_hits=0,
            hits=[],
            generated_at=utcnow(),
            warnings=[
                ReportMessage(
                    code="OPENSEARCH_INDEXER_NOT_CONFIGURED",
                    message="OpenSearch indexer is not configured for entity search.",
                )
            ],
        )

    async def analyst_search(self, request: AnalystSearchRequest) -> AnalystSearchResponse:
        for indexer in self.indexers:
            if hasattr(indexer, "analyst_search"):
                return await indexer.analyst_search(request)
        return AnalystSearchResponse(
            status="unavailable",
            index_name="none",
            query_mode=request.query_mode,
            total_hits=0,
            returned_hits=0,
            hits=[],
            generated_at=utcnow(),
            warnings=[
                ReportMessage(
                    code="OPENSEARCH_INDEXER_NOT_CONFIGURED",
                    message="OpenSearch indexer is not configured for analyst search.",
                )
            ],
        )

    async def entity_relationships(self, request: EntityRelationshipRequest) -> EntityRelationshipResponse:
        for indexer in self.indexers:
            if hasattr(indexer, "entity_relationships"):
                return await indexer.entity_relationships(request)
        return EntityRelationshipResponse(
            status="unavailable",
            index_name="none",
            total_edges=0,
            returned_edges=0,
            edges=[],
            generated_at=utcnow(),
            warnings=[
                ReportMessage(
                    code="OPENSEARCH_INDEXER_NOT_CONFIGURED",
                    message="OpenSearch indexer is not configured for entity relationships.",
                )
            ],
        )


def _index_definition() -> dict[str, Any]:
    return {
        "settings": {
            "index": {
                "number_of_shards": 1,
                "number_of_replicas": 0,
            },
            "analysis": {
                "filter": {
                    "akb_czech_stop": {"type": "stop", "stopwords": "_czech_"},
                    "akb_czech_stemmer": {"type": "stemmer", "language": "czech"},
                },
                "analyzer": {
                    "akb_czech": {
                        "type": "custom",
                        "tokenizer": "standard",
                        "filter": ["lowercase", "asciifolding", "akb_czech_stop", "akb_czech_stemmer"],
                    }
                },
            },
        },
        "mappings": {
            "dynamic": True,
            "properties": {
                "chunk_id": {"type": "keyword"},
                "document_id": {"type": "keyword"},
                "document_version_id": {"type": "keyword"},
                "document_title": {
                    "type": "text",
                    "analyzer": "akb_czech",
                    "fields": {"keyword": {"type": "keyword", "ignore_above": 512}},
                },
                "version_label": {"type": "keyword"},
                "document_type": {"type": "keyword"},
                "tenant_id": {"type": "keyword"},
                "external_system": {"type": "keyword"},
                "external_ref": {"type": "keyword"},
                "text": {"type": "text", "analyzer": "akb_czech"},
                "normalized_text": {"type": "text", "analyzer": "akb_czech"},
                "search_text": {"type": "text", "analyzer": "akb_czech"},
                "section_title": {"type": "text", "analyzer": "akb_czech"},
                "section_path": {"type": "keyword"},
                "article_number": {"type": "keyword"},
                "paragraph_number": {"type": "keyword"},
                "classification": {"type": "keyword"},
                "organization_id": {"type": "keyword"},
                "policy_binding_id": {"type": "keyword"},
                "policy_version": {"type": "keyword"},
                "policy_hash": {"type": "keyword"},
                "authorization_key": {"type": "keyword"},
                "policy_summary": {
                    "properties": {
                        "handlingClass": {"type": "keyword"},
                        "legalClassification": {"type": "keyword"},
                        "tlp": {"type": "keyword"},
                        "pap": {"type": "keyword"},
                        "contentCategories": {"type": "keyword"},
                        "obligations": {"type": "keyword"},
                        "audience": {
                            "properties": {
                                "organizationId": {"type": "keyword"},
                                "scopeType": {"type": "keyword"},
                                "scopeIds": {"type": "keyword"},
                                "recipientSubjectIds": {"type": "keyword"},
                            }
                        },
                    }
                },
                "status": {"type": "keyword"},
                "tags": {"type": "keyword"},
                "valid_from": {"type": "date"},
                "valid_to": {"type": "date"},
                "page_number": {"type": "integer"},
                "char_start": {"type": "integer"},
                "char_end": {"type": "integer"},
                "source_file_uri": {"type": "keyword", "index": False},
                "source_file_name": {"type": "keyword"},
                "source_mime_type": {"type": "keyword"},
                "source_sha256": {"type": "keyword"},
                "embedding_model": {"type": "keyword"},
                "entity_types": {"type": "keyword"},
                "entity_values": {"type": "keyword"},
                "entity_pairs": {"type": "keyword"},
            },
        },
    }


def _entity_facets_from_search(body: dict[str, Any], *, index_name: str, value_limit: int) -> EntityFacetReport:
    aggregations = body.get("aggregations") if isinstance(body.get("aggregations"), dict) else {}
    hits = body.get("hits") if isinstance(body.get("hits"), dict) else {}
    total = hits.get("total")
    if isinstance(total, dict):
        total_chunks = int(total.get("value") or 0)
    elif isinstance(total, int):
        total_chunks = total
    else:
        total_chunks = 0

    entity_type_buckets = _aggregation_buckets(aggregations.get("entity_types"))
    entity_types = [
        EntityFacetBucket(key=bucket["key"], label=_entity_type_label(bucket["key"]), count=bucket["count"])
        for bucket in entity_type_buckets
    ]
    type_counts = {bucket.key: bucket.count for bucket in entity_types}
    values_by_type: dict[str, list[EntityFacetBucket]] = {}
    for bucket in _aggregation_buckets(aggregations.get("entity_pairs")):
        entity_type, value = _split_entity_pair(bucket["key"])
        if not entity_type or not value:
            continue
        values = values_by_type.setdefault(entity_type, [])
        if len(values) < value_limit:
            values.append(EntityFacetBucket(key=value, label=value, count=bucket["count"]))

    entity_groups = [
        EntityFacetGroup(
            entity_type=entity_type,
            label=_entity_type_label(entity_type),
            count=type_counts.get(entity_type, sum(value.count for value in values)),
            values=values,
        )
        for entity_type, values in sorted(
            values_by_type.items(),
            key=lambda item: (-type_counts.get(item[0], 0), _entity_type_label(item[0])),
        )
    ]
    chunks_with_entities = 0
    chunks_aggregation = aggregations.get("chunks_with_entities")
    if isinstance(chunks_aggregation, dict):
        chunks_with_entities = int(chunks_aggregation.get("doc_count") or 0)

    return EntityFacetReport(
        status="ready",
        index_name=index_name,
        total_chunks=total_chunks,
        chunks_with_entities=chunks_with_entities,
        entity_types=entity_types,
        entity_groups=entity_groups,
        generated_at=utcnow(),
    )


def _entity_relationship_query(request: EntityRelationshipRequest) -> dict[str, Any]:
    filters: list[dict[str, Any]] = [
        _authorized_policy_filter(request),
        {"exists": {"field": "entity_pairs"}},
    ]
    if request.entity_type:
        filters.append({"term": {"entity_types": request.entity_type}})
    if request.entity_value:
        if request.entity_type:
            filters.append({"term": {"entity_pairs": f"{request.entity_type}:{request.entity_value}"}})
        else:
            filters.append({"term": {"entity_values": request.entity_value}})
    if request.document_type:
        filters.append({"term": {"document_type": request.document_type}})
    if request.classification:
        filters.append({"term": {"classification": request.classification}})
    if request.status:
        filters.append({"term": {"status": request.status}})

    return {
        "size": min(max(request.limit * 80, 200), 1000),
        "track_total_hits": True,
        "_source": [
            "chunk_id",
            "document_id",
            "document_version_id",
            "document_title",
            "version_label",
            "text",
            "page_number",
            "section_title",
            "source_file_name",
            "entity_pairs",
            "policy_binding_id",
            "policy_version",
            "policy_hash",
        ],
        "query": {"bool": {"filter": filters}},
    }


def _entity_relationships_from_search(
    body: dict[str, Any],
    *,
    index_name: str,
    request: EntityRelationshipRequest,
) -> EntityRelationshipResponse:
    hits = body.get("hits") if isinstance(body.get("hits"), dict) else {}
    raw_hits = hits.get("hits") if isinstance(hits.get("hits"), list) else []
    relationships: dict[tuple[str, str], dict[str, Any]] = {}

    for hit in raw_hits:
        if not isinstance(hit, dict):
            continue
        source = hit.get("_source") if isinstance(hit.get("_source"), dict) else {}
        chunk_id = _string_field(source, "chunk_id")
        document_id = _string_field(source, "document_id")
        document_version_id = _string_field(source, "document_version_id")
        document_title = _string_field(source, "document_title")
        snippet = _clean_snippet(_string_field(source, "text") or "")
        if not all((chunk_id, document_id, document_version_id, document_title, snippet)):
            continue

        entity_pairs = sorted(
            {
                pair
                for pair in _string_list(source.get("entity_pairs"))
                if all(_split_entity_pair(pair))
            }
        )
        for left, right in combinations(entity_pairs, 2):
            if not _relationship_pair_matches_request(left, right, request):
                continue
            key = tuple(sorted((left, right)))
            relationship = relationships.setdefault(
                key,
                {
                    "evidence_count": 0,
                    "document_ids": set(),
                    "evidence": [],
                },
            )
            relationship["evidence_count"] += 1
            relationship["document_ids"].add(document_id)
            if len(relationship["evidence"]) < 3:
                relationship["evidence"].append(
                    EntityRelationshipEvidence(
                        chunk_id=chunk_id,
                        document_id=document_id,
                        document_version_id=document_version_id,
                        document_title=document_title,
                        version_label=_string_field(source, "version_label"),
                        snippet=snippet,
                        page_number=source.get("page_number") if isinstance(source.get("page_number"), int) else None,
                        section_title=_string_field(source, "section_title"),
                        source_file_name=_string_field(source, "source_file_name"),
                        policy_binding_id=_string_field(source, "policy_binding_id"),
                        policy_version=_string_field(source, "policy_version"),
                        policy_hash=_string_field(source, "policy_hash"),
                    )
                )

    edges: list[EntityRelationshipEdge] = []
    for (source_pair, target_pair), relationship in relationships.items():
        evidence_count = int(relationship["evidence_count"])
        if evidence_count < request.min_evidence_count:
            continue
        document_count = len(relationship["document_ids"])
        edges.append(
            EntityRelationshipEdge(
                edge_id=_relationship_edge_id(source_pair, target_pair),
                relationship_type="co_occurs",
                source=_relationship_endpoint(source_pair),
                target=_relationship_endpoint(target_pair),
                evidence_count=evidence_count,
                document_count=document_count,
                confidence=_relationship_confidence(evidence_count, document_count),
                evidence=relationship["evidence"],
            )
        )

    edges.sort(
        key=lambda edge: (
            -edge.evidence_count,
            -edge.document_count,
            -edge.confidence,
            edge.source.label,
            edge.target.label,
        )
    )
    returned_edges = edges[: request.limit]
    return EntityRelationshipResponse(
        status="ready",
        index_name=index_name,
        total_edges=len(edges),
        returned_edges=len(returned_edges),
        edges=returned_edges,
        generated_at=utcnow(),
    )


def _relationship_pair_matches_request(left: str, right: str, request: EntityRelationshipRequest) -> bool:
    if not request.entity_type and not request.entity_value:
        return True

    def matches(pair: str) -> bool:
        entity_type, entity_value = _split_entity_pair(pair)
        if request.entity_type and entity_type != request.entity_type:
            return False
        if request.entity_value and entity_value != request.entity_value:
            return False
        return True

    return matches(left) or matches(right)


def _relationship_endpoint(pair: str) -> EntityRelationshipEndpoint:
    entity_type, entity_value = _split_entity_pair(pair)
    safe_type = entity_type or "unknown"
    safe_value = entity_value or pair
    return EntityRelationshipEndpoint(
        entity_type=safe_type,
        entity_value=safe_value,
        label=f"{_entity_type_label(safe_type)}: {safe_value}",
    )


def _relationship_edge_id(source_pair: str, target_pair: str) -> str:
    digest = sha1(f"{source_pair}|{target_pair}".encode("utf-8")).hexdigest()
    return f"rel_{digest[:24]}"


def _relationship_confidence(evidence_count: int, document_count: int) -> float:
    return min(0.99, round(0.35 + evidence_count * 0.08 + document_count * 0.12, 2))


def _analyst_search_query(request: AnalystSearchRequest) -> dict[str, Any]:
    filters = _intelligence_filters(request)
    must: list[dict[str, Any]] = [_analyst_query_clause(request)]
    return {
        "size": request.limit,
        "track_total_hits": True,
        "_source": [
            "chunk_id",
            "document_id",
            "document_version_id",
            "document_title",
            "version_label",
            "document_type",
            "classification",
            "status",
            "text",
            "page_number",
            "section_title",
            "section_path",
            "source_file_name",
            "entity_types",
            "entity_values",
            "entity_pairs",
            "policy_binding_id",
            "policy_version",
            "policy_hash",
        ],
        "query": {"bool": {"must": must, "filter": filters}},
        "highlight": {
            "pre_tags": [""],
            "post_tags": [""],
            "fields": {
                "search_text": {"fragment_size": 260, "number_of_fragments": 1},
                "text": {"fragment_size": 260, "number_of_fragments": 1},
                "document_title": {"number_of_fragments": 0},
                "section_title": {"number_of_fragments": 0},
            },
        },
    }


def _analyst_query_clause(request: AnalystSearchRequest) -> dict[str, Any]:
    query = request.query or ""
    if request.query_mode == "smart":
        return {
            "multi_match": {
                "query": query,
                "fields": _analyst_fields(request.search_fields),
                "type": "best_fields",
                "operator": "and",
                "fuzziness": "AUTO",
            }
        }
    if request.query_mode == "phrase":
        return {
            "multi_match": {
                "query": query,
                "fields": _analyst_text_fields(request.search_fields),
                "type": "phrase",
            }
        }
    if request.query_mode == "proximity":
        return {
            "multi_match": {
                "query": query,
                "fields": _analyst_text_fields(request.search_fields),
                "type": "phrase",
                "slop": request.proximity_slop,
            }
        }
    if request.query_mode == "fielded":
        query = _rewrite_analyst_field_aliases(query)
    return {
        "query_string": {
            "query": query,
            "fields": _analyst_fields(request.search_fields),
            "default_operator": "AND",
            "allow_leading_wildcard": False,
            "analyze_wildcard": True,
            "lenient": True,
        }
    }


def _intelligence_filters(
    request: EntitySearchRequest | EntityRelationshipRequest | AnalystSearchRequest,
) -> list[dict[str, Any]]:
    filters: list[dict[str, Any]] = [
        _authorized_policy_filter(request),
    ]
    if request.entity_type:
        filters.append({"term": {"entity_types": request.entity_type}})
    if request.entity_value:
        if request.entity_type:
            filters.append({"term": {"entity_pairs": f"{request.entity_type}:{request.entity_value}"}})
        else:
            filters.append({"term": {"entity_values": request.entity_value}})
    if request.document_type:
        filters.append({"term": {"document_type": request.document_type}})
    if request.classification:
        filters.append({"term": {"classification": request.classification}})
    if request.status:
        filters.append({"term": {"status": request.status}})
    return filters


def _authorized_policy_filter(
    request: EntitySearchRequest | EntityRelationshipRequest | AnalystSearchRequest,
) -> dict[str, Any]:
    return _authorized_coordinate_filter(
        [item.model_dump() for item in request.authorized_documents]
    )


def _authorized_coordinate_filter(
    authorized_documents: list[dict[str, str]],
) -> dict[str, Any]:
    keys: set[str] = set()
    for item in sorted(
        authorized_documents,
        key=lambda candidate: candidate.get("document_id", ""),
    ):
        document_id = item.get("document_id")
        document_version_id = item.get("document_version_id")
        policy_hash = item.get("policy_hash")
        if (
            not document_id
            or not document_version_id
            or not isinstance(policy_hash, str)
            or not re.fullmatch(r"sha256:[a-f0-9]{64}", policy_hash)
        ):
            continue
        keys.add(
            _authorization_key(
                document_id,
                document_version_id,
                policy_hash,
            )
        )
    if not keys:
        return {"match_none": {}}
    return {"terms": {"authorization_key": sorted(keys)}}


def _authorization_key(
    document_id: str,
    document_version_id: str,
    policy_hash: str,
) -> str:
    coordinate = "\x1f".join((document_id, document_version_id, policy_hash))
    return f"sha256:{sha256(coordinate.encode('utf-8')).hexdigest()}"


def _opensearch_tls_verifier(ca_file: Any) -> ssl.SSLContext | bool:
    if ca_file is None:
        return True
    return ssl.create_default_context(cafile=str(ca_file))


def _analyst_fields(search_fields: list[str]) -> list[str]:
    field_map = {
        "title": ["document_title^4"],
        "body": ["search_text^4", "text", "normalized_text"],
        "section": ["section_title^3", "section_path"],
        "entity": ["entity_values^4", "entity_pairs^4", "entity_types"],
        "source": ["source_file_name^2"],
    }
    selected = ["title", "body", "section", "entity", "source"] if "all" in search_fields else search_fields
    fields: list[str] = []
    for key in selected:
        fields.extend(field_map.get(key, []))
    return _dedupe_strings(fields) or field_map["body"]


def _analyst_text_fields(search_fields: list[str]) -> list[str]:
    field_map = {
        "title": ["document_title^4"],
        "body": ["search_text^4", "text", "normalized_text"],
        "section": ["section_title^3"],
        "entity": ["entity_values^4", "entity_pairs^4"],
        "source": ["source_file_name^2"],
    }
    selected = ["title", "body", "section", "entity", "source"] if "all" in search_fields else search_fields
    fields: list[str] = []
    for key in selected:
        fields.extend(field_map.get(key, []))
    return _dedupe_strings(fields) or field_map["body"]


def _rewrite_analyst_field_aliases(query: str) -> str:
    aliases = {
        "title": "document_title",
        "body": "search_text",
        "section": "section_title",
        "entity": "entity_values",
        "source": "source_file_name",
        "type": "document_type",
        "class": "classification",
    }
    rewritten = query
    for alias, field in aliases.items():
        rewritten = re.sub(rf"(?<![\w.]){re.escape(alias)}\s*:", f"{field}:", rewritten, flags=re.IGNORECASE)
    return rewritten


def _analyst_search_from_search(
    body: dict[str, Any],
    *,
    index_name: str,
    query_mode: str,
) -> AnalystSearchResponse:
    entity_response = _entity_search_from_search(body, index_name=index_name)
    return AnalystSearchResponse(
        status=entity_response.status,
        index_name=entity_response.index_name,
        query_mode=query_mode,
        total_hits=entity_response.total_hits,
        returned_hits=entity_response.returned_hits,
        hits=entity_response.hits,
        generated_at=entity_response.generated_at,
        warnings=entity_response.warnings,
    )


def _dedupe_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def _entity_search_query(request: EntitySearchRequest) -> dict[str, Any]:
    filters = _intelligence_filters(request)

    must: list[dict[str, Any]] = []
    if request.query:
        must.append(
            {
                "multi_match": {
                    "query": request.query,
                    "fields": [
                        "search_text^4",
                        "document_title^3",
                        "section_title^2",
                        "text",
                        "normalized_text",
                        "entity_values^3",
                        "entity_pairs^3",
                    ],
                    "type": "best_fields",
                    "operator": "and",
                    "fuzziness": "AUTO",
                }
            }
        )

    return {
        "size": request.limit,
        "track_total_hits": True,
        "_source": [
            "chunk_id",
            "document_id",
            "document_version_id",
            "document_title",
            "version_label",
            "document_type",
            "classification",
            "status",
            "text",
            "page_number",
            "section_title",
            "section_path",
            "source_file_name",
            "entity_types",
            "entity_values",
            "entity_pairs",
            "policy_binding_id",
            "policy_version",
            "policy_hash",
        ],
        "query": {"bool": {"must": must or [{"match_all": {}}], "filter": filters}},
        "highlight": {
            "pre_tags": [""],
            "post_tags": [""],
            "fields": {
                "search_text": {"fragment_size": 240, "number_of_fragments": 1},
                "text": {"fragment_size": 240, "number_of_fragments": 1},
                "document_title": {"number_of_fragments": 0},
                "section_title": {"number_of_fragments": 0},
            },
        },
    }


def _entity_search_from_search(body: dict[str, Any], *, index_name: str) -> EntitySearchResponse:
    hits = body.get("hits") if isinstance(body.get("hits"), dict) else {}
    total = hits.get("total")
    if isinstance(total, dict):
        total_hits = int(total.get("value") or 0)
    elif isinstance(total, int):
        total_hits = total
    else:
        total_hits = 0

    result_hits: list[EntitySearchHit] = []
    raw_hits = hits.get("hits") if isinstance(hits.get("hits"), list) else []
    for hit in raw_hits:
        if not isinstance(hit, dict):
            continue
        source = hit.get("_source") if isinstance(hit.get("_source"), dict) else {}
        chunk_id = _string_field(source, "chunk_id")
        document_id = _string_field(source, "document_id")
        document_version_id = _string_field(source, "document_version_id")
        document_title = _string_field(source, "document_title")
        if not all((chunk_id, document_id, document_version_id, document_title)):
            continue
        snippet = _snippet_for_hit(hit, source)
        if not snippet:
            continue
        result_hits.append(
            EntitySearchHit(
                chunk_id=chunk_id,
                document_id=document_id,
                document_version_id=document_version_id,
                document_title=document_title,
                version_label=_string_field(source, "version_label"),
                document_type=_string_field(source, "document_type"),
                classification=_string_field(source, "classification"),
                status=_string_field(source, "status"),
                policy_binding_id=_string_field(source, "policy_binding_id"),
                policy_version=_string_field(source, "policy_version"),
                policy_hash=_string_field(source, "policy_hash"),
                score=float(hit.get("_score") or 0),
                snippet=snippet,
                page_number=source.get("page_number") if isinstance(source.get("page_number"), int) else None,
                section_title=_string_field(source, "section_title"),
                section_path=_string_list(source.get("section_path")),
                source_file_name=_string_field(source, "source_file_name"),
                entity_types=_string_list(source.get("entity_types")),
                entity_values=_string_list(source.get("entity_values")),
                entity_pairs=_string_list(source.get("entity_pairs")),
            )
        )

    return EntitySearchResponse(
        status="ready",
        index_name=index_name,
        total_hits=total_hits,
        returned_hits=len(result_hits),
        hits=result_hits,
        generated_at=utcnow(),
    )


def _snippet_for_hit(hit: dict[str, Any], source: dict[str, Any]) -> str:
    highlight = hit.get("highlight") if isinstance(hit.get("highlight"), dict) else {}
    for field in ("search_text", "text", "document_title", "section_title"):
        values = highlight.get(field)
        if isinstance(values, list):
            for value in values:
                if isinstance(value, str) and value.strip():
                    return _clean_snippet(value)
    return _clean_snippet(_string_field(source, "text") or "")


def _clean_snippet(value: str) -> str:
    cleaned = re.sub(r"\s+", " ", value).strip()
    return cleaned[:480]


def _aggregation_buckets(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, dict) or not isinstance(value.get("buckets"), list):
        return []
    buckets: list[dict[str, Any]] = []
    for bucket in value["buckets"]:
        if not isinstance(bucket, dict):
            continue
        key = bucket.get("key")
        count = bucket.get("doc_count")
        if isinstance(key, str) and isinstance(count, int):
            buckets.append({"key": key, "count": count})
    return buckets


def _split_entity_pair(value: str) -> tuple[str | None, str | None]:
    if ":" not in value:
        return None, None
    entity_type, entity_value = value.split(":", 1)
    return entity_type.strip() or None, entity_value.strip() or None


def _string_field(source: dict[str, Any], field: str) -> str | None:
    value = source.get(field)
    return value if isinstance(value, str) and value.strip() else None


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str) and item.strip()]


def _entity_type_label(entity_type: str) -> str:
    labels = {
        "document_number": "Document number",
        "email": "Email",
        "url": "URL",
        "ipv4": "IPv4",
        "phone": "Phone",
        "date": "Date",
    }
    return labels.get(entity_type, entity_type.replace("_", " ").title())


def _bulk_errors(body: dict[str, Any]) -> list[dict[str, Any]]:
    items = body.get("items")
    if not isinstance(items, list):
        return []
    errors: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        operation = item.get("index") or item.get("create") or item.get("update") or item.get("delete")
        if isinstance(operation, dict) and operation.get("error"):
            errors.append({"status": operation.get("status"), "error": operation.get("error")})
        if len(errors) >= 5:
            break
    return errors
