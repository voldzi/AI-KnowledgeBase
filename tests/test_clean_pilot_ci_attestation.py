from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts/ci"))

from write_same_sha_ci_evidence import KEYS, build  # noqa: E402

WORKFLOW = ROOT / ".gitea/workflows/ci.yaml"
REQUIRED_NEEDS = [
    "trusted-candidate", "impact", "standards", "clean-pilot-phase-a",
    "immutable-release", "web", "registry-api", "ingestion-service",
    "rag-retrieval-service", "llm-gateway-service", "evaluation-service",
    "governance-service", "compose",
]


class SameShaAttestationTests(unittest.TestCase):
    def test_final_job_has_exact_name_all_dependencies_and_artifact_pattern(self) -> None:
        text = WORKFLOW.read_text(encoding="utf-8")
        block = text.split("\n  persist-same-sha-ci-evidence:\n", 1)[1]
        self.assertIn("    name: Persist same-SHA CI evidence\n", block)
        self.assertIn(f"    needs: [{', '.join(REQUIRED_NEEDS)}]\n", block)
        self.assertIn("name: akb-gitea-ci-evidence-${{ github.sha }}", block)
        self.assertIn("same-sha-ci-evidence/akb-gitea-ci-evidence.json", block)
        self.assertNotIn("same-sha-ci-evidence/*.json", block)
        self.assertIn("AKB_GITEA_RUN_ATTEMPT: ${{ gitea.run_attempt }}", block)
        self.assertIn('run_attempt="${AKB_GITEA_RUN_ATTEMPT:-1}"', block)
        self.assertIn('--run-attempt "$run_attempt"', block)
        self.assertNotIn("${{ github.run_attempt }}", block)

    def test_evidence_is_closed_and_exact_for_main_push(self) -> None:
        commit = "a" * 40
        body = build(commit=commit, ref="refs/heads/main", event="push", run_id="605", run_attempt="1")
        self.assertEqual(set(body), KEYS)
        self.assertEqual(body, {
            "schema": "akb-gitea-ci-evidence-1", "commit": commit,
            "ref": "refs/heads/main", "event": "push",
            "workflow": ".gitea/workflows/ci.yaml", "run_id": 605,
            "run_attempt": 1, "phase_a_evidence": "success",
        })

    def test_invalid_or_non_main_push_evidence_fails_closed(self) -> None:
        cases = [
            ({"commit": "short"}, "full lowercase Git SHA"),
            ({"ref": "refs/heads/topic"}, "refs/heads/main"),
            ({"ref": "main"}, "exact branch ref"),
            ({"event": "pull_request"}, "approved trusted CI event"),
            ({"run_id": "0"}, "must be positive"),
            ({"run_attempt": "0"}, "must be positive"),
        ]
        for overrides, message in cases:
            with self.subTest(overrides=overrides):
                values = {"commit": "a" * 40, "ref": "refs/heads/main", "event": "push", "run_id": "1", "run_attempt": "1"}
                values.update(overrides)
                with self.assertRaisesRegex(ValueError, message):
                    build(**values)

    def test_committed_schema_is_closed_and_matches_generator(self) -> None:
        schema = json.loads((ROOT / "contracts/clean-pilot-epoch/v1/akb-gitea-ci-evidence.schema.json").read_text(encoding="utf-8"))
        self.assertIs(schema["additionalProperties"], False)
        self.assertEqual(set(schema["required"]), KEYS)
        self.assertEqual(set(schema["properties"]), KEYS)


if __name__ == "__main__":
    unittest.main()
