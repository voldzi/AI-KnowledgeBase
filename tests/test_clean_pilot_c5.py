from __future__ import annotations

import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("c5", ROOT / "scripts/ci/check_clean_pilot_c5.py")
c5 = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(c5)
DRAFT = json.loads((ROOT / "contracts/identity-cleanup/v1/akb-identity-owner-confirmation.draft.json").read_text())
VALID = json.loads((ROOT / "evidence/clean-pilot-epoch-1/phase-a/c5-akb-identity-owner-confirmation.json").read_text())


class CleanPilotC5Tests(unittest.TestCase):
    def assert_invalid(self, mutate, message: str) -> None:
        candidate = copy.deepcopy(VALID)
        mutate(candidate)
        with self.assertRaisesRegex(ValueError, message):
            c5.validate(candidate, DRAFT)

    def test_submitted_confirmation_is_closed(self) -> None:
        c5.validate(copy.deepcopy(VALID), DRAFT)
        self.assertEqual(len(VALID["entries"]), 20)
        self.assertEqual(len(VALID["routeBindings"]), 7)

    def test_missing_duplicate_unknown_and_pending_fail_closed(self) -> None:
        self.assert_invalid(lambda value: value["entries"].pop(), "cardinality drift")
        self.assert_invalid(lambda value: value["entries"].__setitem__(1, copy.deepcopy(value["entries"][0])), "contract drift|duplicate")
        self.assert_invalid(lambda value: value.__setitem__("unknown", True), "unknown top-level")
        self.assert_invalid(lambda value: value["entries"][0].__setitem__("ownerDecision", "PENDING_OWNER_DECISION"), "invalid or pending")

    def test_audience_scope_manifest_and_route_drift_fail_closed(self) -> None:
        self.assert_invalid(lambda value: value["entries"][0]["targetAudiences"].append("budget-web"), "targetAudiences")
        self.assert_invalid(lambda value: value["entries"][5]["allowedScopes"].append("admin"), "allowedScopes")
        self.assert_invalid(lambda value: value.__setitem__("identityManifestSha256", "0" * 64), "identityManifestSha256")
        self.assert_invalid(lambda value: value["routeBindings"][0].__setitem__("requestScope", "broad"), "requestScope")

    def test_secret_fields_and_authority_escalation_fail_closed(self) -> None:
        self.assert_invalid(lambda value: value.__setitem__("clientSecret", "not-a-real-secret"), "unknown top-level")
        self.assert_invalid(lambda value: value.__setitem__("productionMutationAuthorized", True), "contract header drift|authorize production")

    def test_local_registry_result_remains_non_authoritative(self) -> None:
        c5.validate_local_result()
        result = json.loads(c5.LOCAL_RESULT.read_text())
        self.assertEqual(result["result"], {"passed": 337, "skipped": 1, "failed": 0, "durationSeconds": 25.81})
        self.assertIs(result["trustedCiEvidence"], False)
        self.assertIs(result["productionMutationAuthorized"], False)


if __name__ == "__main__":
    unittest.main()
