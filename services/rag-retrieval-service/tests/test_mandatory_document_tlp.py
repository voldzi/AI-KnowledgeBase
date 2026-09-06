from copy import deepcopy
from hashlib import sha256
import json

import pytest

from app.service import _complete_chunk_policy_metadata
from tests.test_rag_flow import _policy_chunk


@pytest.mark.parametrize("tlp", [None, "", "TLP:WHITE", "CLEAR", [], "TLP:RED"])
def test_correct_hash_cannot_make_incomplete_tlp_retrievable(tlp):
    chunk = _policy_chunk(chunk_id="chunk", document_id="doc", binding_id="pol_mandatory_test", handling_class="INTERNAL", obligations=[])
    summary = deepcopy(chunk.metadata["policy_summary"])
    summary["tlp"] = tlp
    chunk.metadata["policy_summary"] = summary
    chunk.metadata["policy_hash"] = "sha256:" + sha256(json.dumps(summary, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()).hexdigest()
    assert not _complete_chunk_policy_metadata(chunk)


@pytest.mark.parametrize("tlp", ["TLP:CLEAR", "TLP:GREEN", "TLP:AMBER", "TLP:AMBER+STRICT", "TLP:RED"])
def test_all_explicit_tlp_values_remain_available_with_valid_hash(tlp):
    chunk = _policy_chunk(chunk_id="chunk", document_id="doc", binding_id="pol_mandatory_test", handling_class="INTERNAL", obligations=[])
    summary = deepcopy(chunk.metadata["policy_summary"])
    summary["tlp"] = tlp
    if tlp == "TLP:RED":
        summary["audience"].update(scopeType="recipient_set", recipientSubjectIds=["user_recipient"])
        summary["originatorId"] = "user_originator"
    chunk.metadata["policy_summary"] = summary
    canonical = {key: value for key, value in summary.items() if key != "originatorId"}
    chunk.metadata["policy_hash"] = "sha256:" + sha256(json.dumps(canonical, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()).hexdigest()
    assert _complete_chunk_policy_metadata(chunk)
