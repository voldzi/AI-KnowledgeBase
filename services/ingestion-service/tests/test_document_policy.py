from __future__ import annotations

import asyncio
from copy import deepcopy

import pytest

from app.document_policy import document_policy_hash, require_document_policy
from app.errors import IngestionError
from tests.conftest import make_client, web_transport_headers
from tests.test_qdrant_payload import _chunk, _settings
from indexers.qdrant import QdrantIndexer
from indexers.opensearch import OpenSearchIndexer


@pytest.mark.parametrize("tlp", [None, "", "TLP:WHITE", "CLEAR", [], "TLP:RED"])
def test_invalid_tlp_never_reads_or_indexes_content(tmp_path, tlp):
    with make_client(tmp_path) as client:
        registry = client.app.state.registry
        original = registry.get_document_metadata

        async def incomplete_metadata(*args, **kwargs):
            metadata = await original(*args, **kwargs)
            summary = deepcopy(metadata.policy_summary)
            summary["tlp"] = tlp
            return metadata.model_copy(update={"policy_summary": summary, "policy_hash": document_policy_hash(summary)})

        registry.get_document_metadata = incomplete_metadata
        response = client.post(
            "/api/v1/ingestion/jobs",
            headers=web_transport_headers(actor_subject_id="user_dev", authorization_proof=True),
            json={
                "idempotency_key": "missing-policy",
                "document_id": "doc_policy", "document_version_id": "ver_policy",
                # No file exists: policy validation must precede even reading its bytes.
                "source_file_uri": str(tmp_path / "must-not-read.md"),
                "parser_profile": "controlled_document", "ocr_enabled": False,
                "chunking_strategy": "legal_structured", "embedding_profile": "default",
                "expected_current_ingestion_job_id": None,
            },
        )
        assert response.status_code == 201
        assert response.json()["status"] == "failed"
        stored = client.app.state.store.get(response.json()["job_id"])
        assert stored.report.errors[0].code in {"DOCUMENT_TLP_REQUIRED", "DOCUMENT_POLICY_INVALID"}
        assert client.app.state.indexer.mock_points == []


@pytest.mark.parametrize("tlp", ["TLP:CLEAR", "TLP:GREEN", "TLP:AMBER", "TLP:AMBER+STRICT", "TLP:RED"])
def test_explicit_valid_policy_preserves_central_hash(tmp_path, tlp):
    with make_client(tmp_path) as client:
        metadata = asyncio.run(client.app.state.registry.get_document_metadata("doc_policy", "ver_policy"))
    summary = deepcopy(metadata.policy_summary)
    summary["tlp"] = tlp
    if tlp == "TLP:RED":
        summary["audience"].update(scopeType="recipient_set", recipientSubjectIds=["user_recipient"])
        summary["originatorId"] = "user_originator"
    metadata = metadata.model_copy(update={"policy_summary": summary, "policy_hash": document_policy_hash(summary)})
    require_document_policy(metadata)
    with pytest.raises(IngestionError, match="inconsistent policy"):
        require_document_policy(metadata.model_copy(update={"policy_hash": "sha256:" + "0" * 64}))


@pytest.mark.asyncio
@pytest.mark.parametrize("indexer_type", [QdrantIndexer, OpenSearchIndexer])
async def test_direct_index_write_rejects_incomplete_policy_before_network(tmp_path, indexer_type):
    indexer = indexer_type(_settings(tmp_path))
    with pytest.raises(IngestionError) as error:
        await indexer.index(chunks=[_chunk()], vectors=[[0.1] * 8], embedding_model="mock")
    assert error.value.code == "DOCUMENT_TLP_REQUIRED"
