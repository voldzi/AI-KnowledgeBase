import json

import pytest

from app.config import load_settings
from app.schemas import RagAnswer
from policies.evidence import EvidenceGate, _model_assessment
from tests.test_rag_v2 import _chunk


SOURCE = "Lhuta pro vyrizeni zadosti je 30 dnu."


def _payload(claim=SOURCE, *, quote=SOURCE, supported=True):
    return {"claims": [{"claim": claim, "claim_type": "main", "chunk_ids": ["a"],
                        "quoted_support": quote, "supported": supported}]}


@pytest.mark.parametrize("claim", [
    "Lhuta pro vyrizeni zadosti je 300 dnu.",
    "Lhuta pro vyrizeni zadosti neni 30 dnu.",
    "Lhuta pro vyrizeni zadosti je 30 hodin.",
    "30 dnu.",
])
def test_lexical_similarity_cannot_prove_a_statement(claim):
    settings = load_settings({"AKL_RAG_EVIDENCE_GATE_MODE": "enforce"})
    result = EvidenceGate(settings).verify(
        RagAnswer(query_id="q", answer=claim, confidence="high", citations=[], used_chunks=["a"]),
        [_chunk("a", "doc_a", SOURCE)],
    )
    assert result.evidence_status == "unsupported"
    assert result.confidence == "insufficient_source"
    assert result.used_chunks == []


def test_extractive_support_preserves_the_actual_passage():
    settings = load_settings({"AKL_RAG_EVIDENCE_GATE_MODE": "enforce"})
    result = EvidenceGate(settings)._assess(SOURCE, [_chunk("a", "doc_a", "Unrelated sentence. " + SOURCE)])
    assert result.status == "supported"
    assert result.claims[0]["quoted_support"] == SOURCE


def test_word_order_is_not_evidence():
    source = "Zadost schvaluje reditel nikoli gestor."
    claim = "Zadost schvaluje gestor nikoli reditel."
    result = EvidenceGate(load_settings({}))._assess(claim, [_chunk("a", "doc_a", source)])
    assert result.status == "unsupported"


@pytest.mark.parametrize("claim", [SOURCE.replace("30", "300"), SOURCE.replace("30", "-30"),
                                    SOURCE.replace("je 30", "neni 30")])
def test_model_cannot_override_number_or_polarity_invariants(claim):
    result = _model_assessment(json.dumps(_payload(claim)), [_chunk("a", "doc_a", SOURCE)], answer=claim)
    assert result.unsupported_main_claim


@pytest.mark.parametrize("mutation", [
    lambda p: p.update(extra=True),
    lambda p: p["claims"][0].update(extra=True),
    lambda p: p["claims"][0].update(supported="true"),
    lambda p: p["claims"][0].update(chunk_ids=["unknown"]),
    lambda p: p["claims"][0].update(chunk_ids=["a", "a"]),
    lambda p: p["claims"][0].update(claim_type="supporting"),
    lambda p: p["claims"][0].update(claim=SOURCE.replace("30", "300")),
    lambda p: p.update(claims=[]),
])
def test_model_contract_is_closed_and_preserves_original_claims(mutation):
    payload = _payload()
    mutation(payload)
    with pytest.raises(ValueError):
        _model_assessment(json.dumps(payload), [_chunk("a", "doc_a", SOURCE)], answer=SOURCE)


def test_titles_are_not_factual_proof_and_denial_is_respected():
    chunk = _chunk("a", SOURCE, "Unrelated content.")
    assert _model_assessment(json.dumps(_payload()), [chunk], answer=SOURCE).status == "unsupported"
    chunk.text = SOURCE
    assert _model_assessment(json.dumps(_payload(supported=False)), [chunk], answer=SOURCE).status == "unsupported"
    assert _model_assessment(json.dumps(_payload()), [chunk], answer=SOURCE).status == "supported"


def test_model_can_verify_a_grounded_paraphrase_without_rewriting_the_answer():
    claim = "Zadost je nutne vyridit ve lhute 30 dnu."
    assessment = _model_assessment(json.dumps(_payload(claim)), [_chunk("a", "doc_a", SOURCE)], answer=claim)
    assert assessment.status == "supported"
    assert assessment.claims[0]["claim"] == claim


def test_duplicate_json_decision_is_rejected():
    payload = json.dumps(_payload()).replace('"supported": true', '"supported": false, "supported": true')
    with pytest.raises(ValueError, match="duplicate verifier field"):
        _model_assessment(payload, [_chunk("a", "doc_a", SOURCE)], answer=SOURCE)


@pytest.mark.asyncio
async def test_invalid_verifier_output_is_fail_closed_without_echoing_content(caplog):
    class Verifier:
        async def chat_completion(self, **kwargs):
            return "private-answer-not-json"

    gate = EvidenceGate(load_settings({"AKL_RAG_EVIDENCE_GATE_MODE": "enforce",
                                       "AKL_RAG_EVIDENCE_VERIFIER_MODEL": "test-verifier"}), Verifier())
    result = await gate.verify_async(
        RagAnswer(query_id="q", answer=SOURCE, confidence="high", citations=[], used_chunks=["a"]),
        [_chunk("a", "doc_a", SOURCE)],
    )
    assert result.confidence == "insufficient_source"
    assert "EVIDENCE_VERIFIER_UNAVAILABLE" in result.warnings
    assert "private-answer-not-json" not in caplog.text
    assert SOURCE not in caplog.text


@pytest.mark.asyncio
async def test_verifier_inherits_source_processing_restrictions():
    from answer_composer.composer import _policy_metadata

    captured = {}
    chunk = _chunk("a", "doc_a", SOURCE)
    chunk.metadata.update({
        "policy_binding_id": "binding_test", "policy_hash": "sha256:test",
        "policy_summary": {"handlingClass": "RESTRICTED",
                           "obligations": ["NO_EXTERNAL_AI", "NO_EXPORT", "LOCAL_PROCESSING_ONLY"]},
    })

    class Verifier:
        async def chat_completion(self, **kwargs):
            captured.update(kwargs["metadata"])
            return json.dumps(_payload())

    gate = EvidenceGate(load_settings({"AKL_RAG_EVIDENCE_GATE_MODE": "enforce",
                                       "AKL_RAG_EVIDENCE_VERIFIER_MODEL": "test-verifier"}), Verifier())
    result = await gate.verify_async(
        RagAnswer(query_id="q", answer=SOURCE, confidence="high", citations=[], used_chunks=["a"]),
        [chunk],
    )
    assert result.evidence_status == "supported"
    assert all(captured[key] == value for key, value in _policy_metadata([chunk]).items())
    assert captured["handling_class"] == "RESTRICTED"
    assert captured["obligations"] == ["LOCAL_PROCESSING_ONLY", "NO_EXPORT", "NO_EXTERNAL_AI"]
    assert captured["content_logged"] is False
    assert SOURCE not in json.dumps(captured)
