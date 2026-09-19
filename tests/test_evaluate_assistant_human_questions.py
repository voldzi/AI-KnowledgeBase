from scripts.evaluate_assistant_human_questions import (
    DEFAULT_MANIFEST,
    _claim_content_checks,
    _completed_results,
    _manifest,
    _quote_reappears_in_source,
    _reopened_source_text,
    _source_scope_hash,
)


def _check(text: str):
    return {
        "ok": True,
        "data": {"source_context": {"chunk_id": "chunk_a", "chunk_text": text}},
    }


def test_revision_two_manifest_has_exactly_one_hundred_governed_sources():
    digest, sources = _manifest(DEFAULT_MANIFEST)
    assert digest.startswith("sha256:")
    assert len(sources) == 100


def test_supported_visible_claim_and_reopened_quote_pass_content_checks():
    claim = (
        "Zadavatel musí při celém postupu podle zákona jednat transparentně, "
        "přiměřeně a podle předem stanovených podmínek."
    )
    response = {
        "response_type": "answer",
        "answer": claim,
        "claims": [
            {
                "claim": claim,
                "supported": True,
                "chunk_ids": ["chunk_a"],
                "quoted_support": claim,
            }
        ],
    }
    failures, supported, total = _claim_content_checks(
        response,
        {"chunk_a": _check(claim)},
    )
    assert failures == []
    assert (supported, total) == (1, 1)


def test_unsupported_claim_must_not_remain_visible():
    response = {
        "response_type": "answer",
        "answer": "Lhůta je 999 dnů." * 5,
        "claims": [
            {
                "claim": "Lhůta je 999 dnů.",
                "supported": False,
                "chunk_ids": [],
                "quoted_support": None,
            }
        ],
    }
    failures, supported, total = _claim_content_checks(response, {})
    assert "UNSUPPORTED_CLAIM_VISIBLE" in failures
    assert "NO_SUPPORTED_CLAIM" in failures
    assert (supported, total) == (0, 1)


def test_source_scope_hash_is_read_only_from_complete_evidence_frame():
    assert _source_scope_hash({"current_context": {"evidence_frame": None}}) is None
    assert _source_scope_hash({
        "current_context": {"evidence_frame": {"source_scope_hash": "sha256:" + "a" * 64}}
    }) == "sha256:" + "a" * 64


def test_quote_check_accepts_pdf_soft_hyphen_and_layout_breaks_but_not_changed_number():
    source = "Lhůta podle záko\u00ad\n\nnem činí 30 dnů."
    assert _quote_reappears_in_source("Lhůta podle zákonem činí 30 dnů.", source)
    assert not _quote_reappears_in_source("Lhůta podle zákonem činí 300 dnů.", source)


def test_quote_check_never_tolerates_changed_polarity():
    source = "Dodavatel nesmí údaje zveřejnit bez předchozího souhlasu správce."
    assert _quote_reappears_in_source(source, source)
    assert not _quote_reappears_in_source(
        "Dodavatel smí údaje zveřejnit bez předchozího souhlasu správce.",
        source,
    )


def test_reopened_source_text_keeps_only_the_authorized_viewer_window():
    check = {
        "data": {
            "source_context": {
                "before_text": "Předchozí část věty",
                "chunk_text": "pokračuje ve vybraném úseku",
                "after_text": "a končí v následujícím úseku.",
                "unrelated": "nezahrnout",
            }
        }
    }
    reopened = _reopened_source_text(check)
    assert "Předchozí část věty" in reopened
    assert "pokračuje ve vybraném úseku" in reopened
    assert "a končí v následujícím úseku." in reopened
    assert "nezahrnout" not in reopened


def test_resume_retries_failed_cases_and_keeps_only_successes():
    existing = {
        "results": [
            {"case_id": "passed", "passed": True},
            {"case_id": "failed", "passed": False},
            {"case_id": "unfinished"},
        ]
    }
    assert _completed_results(existing) == {
        "passed": {"case_id": "passed", "passed": True}
    }
