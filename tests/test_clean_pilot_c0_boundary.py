from __future__ import annotations

import copy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts/ci"))

from check_clean_pilot_phase_a import (  # noqa: E402
    BOUNDARY_BUNDLE_CANONICAL_SHA256,
    validate_c0_owner,
)


class C0BoundaryEvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.c0 = json.loads(
            (ROOT / "evidence/clean-pilot-epoch-1/phase-a/c0-akb-owner.json").read_text(encoding="utf-8")
        )

    def test_exact_boundary_and_safety_policy_pass(self) -> None:
        validate_c0_owner(copy.deepcopy(self.c0))
        self.assertEqual(self.c0["boundaryBundleCanonicalSha256"], BOUNDARY_BUNDLE_CANONICAL_SHA256)
        self.assertIs(self.c0["productionMutationAuthorized"], False)
        self.assertEqual(self.c0["unknownStorePolicy"], "STOP")

    def test_missing_different_or_noncanonical_boundary_fails_closed(self) -> None:
        cases = [
            (None, "root is not closed"),
            ("0" * 64, "hash drift"),
            (f"sha256:{BOUNDARY_BUNDLE_CANONICAL_SHA256}", "missing or non-canonical"),
            (BOUNDARY_BUNDLE_CANONICAL_SHA256.upper(), "missing or non-canonical"),
            (BOUNDARY_BUNDLE_CANONICAL_SHA256[:-1], "missing or non-canonical"),
        ]
        for value, message in cases:
            with self.subTest(value=value):
                candidate = copy.deepcopy(self.c0)
                if value is None:
                    candidate.pop("boundaryBundleCanonicalSha256")
                else:
                    candidate["boundaryBundleCanonicalSha256"] = value
                with self.assertRaisesRegex(SystemExit, message):
                    validate_c0_owner(candidate)

    def test_unknown_root_key_or_relaxed_safety_policy_fails_closed(self) -> None:
        unknown = copy.deepcopy(self.c0)
        unknown["unexpected"] = True
        with self.assertRaisesRegex(SystemExit, "root is not closed"):
            validate_c0_owner(unknown)

        for key, value in (("productionMutationAuthorized", True), ("unknownStorePolicy", "WARN")):
            candidate = copy.deepcopy(self.c0)
            candidate[key] = value
            with self.assertRaisesRegex(SystemExit, "policy drift"):
                validate_c0_owner(candidate)


if __name__ == "__main__":
    unittest.main()
