"""Verify real native Office index payloads survive production citation mapping."""

import pytest

from app.schemas import RagQueryFilters
from app.service import _source_context_from_chunk
from app.source_locator import office_source_locator
from retrievers.qdrant import _point_to_chunk
from tests.test_temporal_authorization import chunk, retrieve, scenario


@pytest.mark.parametrize("kind", ["xlsx", "pptx"])
def test_ingestion_shaped_office_payload_reaches_source_context_without_pdf_page(kind):
    seed = chunk("v1")
    locator = (
        {"kind": "sheet", "sheet_name": "Rozpočet", "row_numbers": [5, 60], "column_name": "A", "column_end": "D"}
        if kind == "xlsx"
        else {"kind": "slide", "slide_number": 3, "shape_id": 2, "table_id": 2, "row_numbers": [1, 2]}
    )
    suffix, mime = (
        ("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        if kind == "xlsx"
        else ("pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation")
    )
    payload = {
        "chunk_id": seed.chunk_id,
        "document_id": seed.citation.document_id,
        "document_version_id": seed.citation.document_version_id,
        "document_title": seed.citation.document_title,
        "version_label": seed.citation.version_label,
        "text": "Service | Minimum | Guaranteed",
        "section_path": ["Rozpočet", "A:D · Řádky 5, 60"] if kind == "xlsx" else ["Slide 3"],
        "source_sha256": "a" * 64,
        "source_file_name": f"source.{suffix}",
        "source_mime_type": mime,
        "classification": "internal",
        "policy_binding_id": seed.metadata["policy_binding_id"],
        "policy_version": seed.metadata["policy_version"],
        "policy_hash": seed.metadata["policy_hash"],
        "policy_summary": seed.metadata["policy_summary"],
        "metadata": {**seed.metadata, "source_locator": locator},
    }
    retrieved = _point_to_chunk(payload, score=0.9, dense_score=0.9, sparse_score=0)
    context = _source_context_from_chunk(retrieved)
    assert retrieved.metadata["source_locator"] == locator
    assert context.location.page_number is None
    assert context.chunk_text == payload["text"]
    assert context.source_sha256 == payload["source_sha256"]
    assert context.document_version_id == payload["document_version_id"]
    assert context.location.section_path == payload["section_path"]
    if kind == "xlsx":
        assert context.viewer_mode == "table"
        assert context.location.sheet_name == locator["sheet_name"]
        assert context.location.row_number == locator["row_numbers"][0]
        assert context.location.column_name == "A"
    else:
        assert context.viewer_mode == "presentation"
        assert context.location.slide_number == locator["slide_number"]
    assert "SOURCE_LOCATION_UNAVAILABLE" not in context.warnings


@pytest.mark.parametrize("value", [
    {"kind": "sheet", "sheet_name": "Data", "row_numbers": [False], "column_name": "A", "column_end": "D"},
    {"kind": "sheet", "sheet_name": "Data", "row_numbers": [1, 3, 2], "column_name": "A", "column_end": "D"},
    {"kind": "sheet", "sheet_name": "Data", "row_numbers": [1, 1], "column_name": "A", "column_end": "D"},
    {"kind": "slide", "slide_number": 0}, {"kind": "slide", "slide_number": True},
])
def test_malformed_office_locator_cannot_be_interpreted_as_an_exact_source(value):
    assert office_source_locator(value) is None


def test_unsupported_old_sheet_page_is_not_exposed_as_a_pdf_coordinate():
    item = chunk("v1")
    item = item.model_copy(update={"citation": item.citation.model_copy(update={"page_number": 7}),
                                   "metadata": {**item.metadata, "source_file_name": "book.xlsx"}})
    context = _source_context_from_chunk(item)
    assert context.location.page_number is None
    assert context.location.sheet_name is None
    assert "SOURCE_LOCATION_UNAVAILABLE" in context.warnings


@pytest.mark.asyncio
@pytest.mark.parametrize("other_locator", [
    {"kind": "sheet", "sheet_name": "Other", "row_numbers": [1, 60], "column_name": "A", "column_end": "D"},
    {"kind": "sheet", "sheet_name": "Data", "row_numbers": [1, 70], "column_name": "A", "column_end": "D"},
    None,
])
async def test_parent_expansion_cannot_relabel_other_rows_or_sheets_as_seed(scenario, other_locator):
    service, state = scenario
    seed = chunk("v1")
    seed = seed.model_copy(update={"text": "EXACT_ROW_60", "citation": seed.citation.model_copy(update={"page_number": None}),
        "metadata": {**seed.metadata, "source_file_name": "book.xlsx", "source_mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                     "source_locator": {"kind": "sheet", "sheet_name": "Data", "row_numbers": [1, 60], "column_name": "A", "column_end": "D"}}})
    related = seed.model_copy(update={"chunk_id": "other_row", "text": "UNRELATED_ROW_EVIDENCE",
                                      "metadata": {**seed.metadata, "source_locator": other_locator}})
    state["candidates"] = [seed]
    state["context_candidates"] = [seed, related]
    result = await retrieve(service, RagQueryFilters())
    assert len(result.response.chunks) == 1
    assert result.response.chunks[0].text == "EXACT_ROW_60"
    assert result.response.chunks[0].metadata["expanded_chunk_ids"] == [seed.chunk_id]


@pytest.mark.asyncio
async def test_unlocated_office_chunks_do_not_expand_each_other(scenario):
    service, state = scenario
    seed = chunk("v1")
    seed = seed.model_copy(update={"text": "UNLOCATED_SEED", "citation": seed.citation.model_copy(update={"page_number": None}),
                                  "metadata": {**seed.metadata, "source_file_name": "book.xlsx"}})
    state["candidates"] = [seed]
    state["context_candidates"] = [seed.model_copy(update={"chunk_id": "other", "text": "UNLOCATED_NEIGHBOUR"})]
    result = await retrieve(service, RagQueryFilters())
    assert result.response.chunks[0].text == "UNLOCATED_SEED"


async def prepare_source_scenario(service, state, *, kind="pdf"):
    seed = chunk("v1")
    metadata = {**seed.metadata, "chunk_index": 5, "source_file_name": "original.pdf", "source_mime_type": "application/pdf"}
    if kind == "office":
        metadata.update(source_file_name="original.pptx", source_mime_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
                        source_locator={"kind": "slide", "slide_number": 3, "shape_id": 2})
    seed = seed.model_copy(update={"text": "VERIFIED_SOURCE_SEED", "metadata": metadata,
                                   "citation": seed.citation.model_copy(update={"page_number": 3 if kind == "pdf" else None})})
    state["candidates"] = [seed]
    async def get_chunk(_chunk_id):
        return state["candidates"][0]
    async def audited(**kwargs):
        state["source_audited"] = True
    service._retriever.get_chunk = get_chunk
    service._audit_source_opened = audited
    return seed


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["pdf", "office"])
async def test_source_context_reauthorizes_exact_neighbours_before_assembling_text(scenario, kind):
    service, state = scenario
    seed = await prepare_source_scenario(service, state, kind=kind)
    state["context_candidates"] = [
        seed.model_copy(update={"chunk_id": "before", "text": "VERIFIED_BEFORE", "metadata": {**seed.metadata, "chunk_index": 4}}),
        seed.model_copy(update={"chunk_id": "after", "text": "VERIFIED_AFTER", "metadata": {**seed.metadata, "chunk_index": 6}}),
    ]
    result = await service.source_context(chunk_id=seed.chunk_id, subject_id="user_temporal")
    assert len(state["registry_calls"]) == 2
    assert result.chunk_text == "VERIFIED_SOURCE_SEED"
    assert result.before_text == "VERIFIED_BEFORE"
    assert result.after_text == "VERIFIED_AFTER"
    assert state["source_audited"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("alteration", ["other_locator", "other_page", "other_document", "other_version", "changed_policy"])
async def test_source_context_ignores_private_or_unrelated_neighbour_payload(scenario, alteration):
    service, state = scenario
    seed = await prepare_source_scenario(service, state, kind="office")
    other = seed.model_copy(update={"chunk_id": "private", "text": "PRIVATE_UNRELATED_PAYLOAD", "metadata": {**seed.metadata, "chunk_index": 6}})
    if alteration == "other_locator":
        other.metadata["source_locator"] = {"kind": "slide", "slide_number": 4, "shape_id": 2}
    elif alteration == "other_page":
        other = other.model_copy(update={"citation": other.citation.model_copy(update={"page_number": 4})})
    elif alteration == "other_document":
        other = other.model_copy(update={"citation": other.citation.model_copy(update={"document_id": "private_document"})})
    elif alteration == "other_version":
        other = other.model_copy(update={"citation": other.citation.model_copy(update={"document_version_id": "private_version"})})
    else:
        other.metadata["policy_hash"] = "sha256:" + "d"*64
    state["context_candidates"] = [other]
    result = await service.source_context(chunk_id=seed.chunk_id, subject_id="user_temporal")
    assert result.chunk_text == "VERIFIED_SOURCE_SEED"
    assert result.before_text == result.after_text == ""
    assert "PRIVATE_UNRELATED_PAYLOAD" not in result.model_dump_json()
    assert len(state["registry_calls"]) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["revoked", "missing_seed_tlp", "missing_neighbour_tlp", "authorization_unavailable"])
async def test_source_context_cannot_return_seed_after_revocation_or_incomplete_authority(scenario, failure):
    from app.errors import RetrievalError
    service, state = scenario
    seed = await prepare_source_scenario(service, state)
    neighbor = seed.model_copy(update={"chunk_id": "next", "text": "PRIVATE_NEIGHBOUR", "metadata": {**seed.metadata, "chunk_index": 6}})
    state["context_candidates"] = [neighbor]
    if failure == "revoked":
        state["withdraw_after_initial_authorization"] = True
    elif failure == "missing_seed_tlp":
        seed.metadata["policy_summary"] = {**seed.metadata["policy_summary"], "tlp": None}
    elif failure == "missing_neighbour_tlp":
        neighbor.metadata["policy_summary"] = {**neighbor.metadata["policy_summary"], "tlp": None}
    else:
        original = service._registry_client.filter_allowed_documents
        async def unavailable(**kwargs):
            if state["registry_calls"]:
                raise RetrievalError("REGISTRY_UNAVAILABLE", "Current authority unavailable", status_code=503)
            return await original(**kwargs)
        service._registry_client.filter_allowed_documents = unavailable
    with pytest.raises(RetrievalError) as error:
        await service.source_context(chunk_id=seed.chunk_id, subject_id="user_temporal")
    assert error.value.status_code == (503 if failure == "authorization_unavailable" else 403)
    assert "source_audited" not in state
