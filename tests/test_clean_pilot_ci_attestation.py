from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts/ci"))

from check_same_sha_ci_gate import OPTIONAL_RESULTS, REQUIRED_RESULTS, validate_gate  # noqa: E402
from verify_gitea_action_artifact import validate_request, validate_response, validate_run_response  # noqa: E402
from write_same_sha_ci_evidence import KEYS, build  # noqa: E402

WORKFLOW = ROOT / ".gitea/workflows/ci.yaml"
REQUIRED_NEEDS = [
    "trusted-candidate", "impact", "standards", "clean-pilot-phase-a",
    "immutable-release", "web", "registry-api", "ingestion-service",
    "rag-retrieval-service", "llm-gateway-service", "evaluation-service",
    "governance-service", "compose",
]
GITEA_UPLOAD_ACTION = "ChristopherHX/gitea-upload-artifact@81f940d004763f986ba3582c007fd842dd5cb0d7"


class SameShaAttestationTests(unittest.TestCase):
    def test_final_job_has_exact_name_all_dependencies_and_artifact_pattern(self) -> None:
        text = WORKFLOW.read_text(encoding="utf-8")
        self.assertEqual(text.count(f"uses: {GITEA_UPLOAD_ACTION}"), 2)
        self.assertNotIn("uses: actions/upload-artifact@v3", text)
        self.assertNotIn("uses: actions/upload-artifact@v4", text)
        self.assertNotIn("NODE_TLS_REJECT_UNAUTHORIZED", text)
        self.assertGreaterEqual(text.count("actions: read"), 2)
        self.assertGreaterEqual(text.count("GITEA_TOKEN: ${{ gitea.token }}"), 3)
        block = text.split("\n  persist-same-sha-ci-evidence:\n", 1)[1]
        self.assertIn("    name: Persist same-SHA CI evidence\n", block)
        self.assertIn(f"    needs: [{', '.join(REQUIRED_NEEDS)}]\n", block)
        self.assertIn("    if: ${{ always() }}\n", block)
        self.assertIn("python3 scripts/ci/check_same_sha_ci_gate.py", block)
        self.assertIn("name: akb-gitea-ci-evidence-${{ github.sha }}", block)
        self.assertIn("same-sha-ci-evidence/akb-gitea-ci-evidence.json", block)
        self.assertNotIn("same-sha-ci-evidence/*.json", block)
        self.assertIn("AKB_GITEA_RUN_ATTEMPT: ${{ gitea.run_attempt }}", block)
        self.assertIn('run_attempt="${AKB_GITEA_RUN_ATTEMPT:-1}"', block)
        self.assertIn('--run-attempt "$run_attempt"', block)
        self.assertNotIn("${{ github.run_attempt }}", block)
        self.assertIn("id: publish-same-sha-evidence", block)
        self.assertIn("steps.publish-same-sha-evidence.outputs.artifact-id", block)
        self.assertIn("python3 scripts/ci/verify_gitea_action_artifact.py", block)
        self.assertIn("GITEA_TOKEN: ${{ gitea.token }}", block)

    def test_server_visible_artifact_contract_is_exact(self) -> None:
        commit = "a" * 40
        expected = validate_request(
            api_url="https://git.example.test/api/v1", repository="AKB/ai-knowledgebase",
            run_id="666", run_attempt="1", commit=commit, ref="refs/heads/main",
            event="push", artifact_id="42", artifact_name=f"akb-gitea-ci-evidence-{commit}",
        )
        validate_response({
            "total_count": 1,
            "artifacts": [{
                "id": 42, "name": f"akb-gitea-ci-evidence-{commit}",
                "expired": False, "size_in_bytes": 224,
                "workflow_run": {
                    "id": 666, "run_attempt": 0, "head_sha": commit,
                },
            }],
        }, expected)
        validate_run_response({
            "id": 666, "run_attempt": 1, "head_sha": commit,
            "head_branch": "main", "event": "push",
        }, expected)

    def test_server_visible_artifact_contract_fails_closed(self) -> None:
        commit = "a" * 40
        expected = validate_request(
            api_url="https://git.example.test/api/v1", repository="AKB/ai-knowledgebase",
            run_id="666", run_attempt="1", commit=commit, ref="refs/heads/main",
            event="push", artifact_id="42", artifact_name=f"akb-gitea-ci-evidence-{commit}",
        )
        cases = [
            ({"total_count": 0, "artifacts": []}, "exactly one"),
            ({"total_count": 2, "artifacts": [{}, {}]}, "exactly one"),
            ({"total_count": 1, "artifacts": [{"id": 7}]}, "artifact id"),
        ]
        for payload, message in cases:
            with self.subTest(message=message):
                with self.assertRaisesRegex(ValueError, message):
                    validate_response(payload, expected)

        run_cases = [
            ({"id": 666, "run_attempt": 0, "head_sha": commit, "head_branch": "main", "event": "push"}, "run_attempt"),
            ({"id": 666, "run_attempt": 1, "head_sha": commit, "head_branch": "topic", "event": "push"}, "head_branch"),
            ({"id": 666, "run_attempt": 1, "head_sha": commit, "head_branch": "main", "event": "workflow_dispatch"}, "event"),
        ]
        for payload, message in run_cases:
            with self.subTest(message=message):
                with self.assertRaisesRegex(ValueError, message):
                    validate_run_response(payload, expected)

    def test_gate_accepts_successful_required_selected_and_skipped_jobs(self) -> None:
        environment = self._valid_gate_environment()
        validate_gate(environment)
        selected_key = "WEB"
        environment[f"AKB_CI_SELECT_{selected_key}"] = "true"
        environment[f"AKB_CI_{selected_key}_RESULT"] = "success"
        validate_gate(environment)

    def test_gate_rejects_failed_unknown_or_impact_inconsistent_jobs(self) -> None:
        cases = [
            ("AKB_CI_STANDARDS_RESULT", "failure", "required job standards"),
            ("AKB_CI_SELECT_WEB", "unknown", "impact output web"),
            ("AKB_CI_WEB_RESULT", "success", "must be skipped"),
        ]
        for key, value, message in cases:
            with self.subTest(key=key, value=value):
                environment = self._valid_gate_environment()
                environment[key] = value
                with self.assertRaisesRegex(ValueError, message):
                    validate_gate(environment)

        environment = self._valid_gate_environment()
        environment["AKB_CI_SELECT_WEB"] = "true"
        with self.assertRaisesRegex(ValueError, "must be success"):
            validate_gate(environment)

    @staticmethod
    def _valid_gate_environment() -> dict[str, str]:
        environment = {
            f"AKB_CI_{key}_RESULT": "success"
            for key in REQUIRED_RESULTS
        }
        for key in OPTIONAL_RESULTS:
            environment[f"AKB_CI_SELECT_{key}"] = "false"
            environment[f"AKB_CI_{key}_RESULT"] = "skipped"
        return environment

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
