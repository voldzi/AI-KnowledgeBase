from __future__ import annotations

import base64
import json
from types import SimpleNamespace
import unittest
from unittest.mock import call, patch

from tools.import_docs_folder import approve_document_for_publication, bearer_subject_id


class ImportDocsFolderGovernanceTest(unittest.TestCase):
    def test_bearer_subject_id_uses_oidc_subject(self) -> None:
        payload = base64.urlsafe_b64encode(json.dumps({"sub": "subject-123"}).encode()).decode().rstrip("=")

        self.assertEqual(bearer_subject_id(f"header.{payload}.signature"), "subject-123")

    def test_approval_completes_open_review_task(self) -> None:
        options = SimpleNamespace(registry_url="http://registry.test")
        with (
            patch("tools.import_docs_folder.patch_document", return_value={"status": "review"}) as patch_document,
            patch(
                "tools.import_docs_folder.request_json",
                side_effect=[
                    {"document_id": "doc-1", "status": "draft"},
                    {
                        "items": [
                            {
                                "task_id": "task-1",
                                "document_id": "doc-1",
                                "status": "open",
                            }
                        ]
                    },
                    {"task_id": "task-1", "status": "resolved"},
                ],
            ) as request_json,
        ):
            approve_document_for_publication("doc-1", options)  # type: ignore[arg-type]

        patch_document.assert_called_once_with("doc-1", {"status": "review"}, options)
        self.assertEqual(request_json.call_count, 3)
        self.assertEqual(
            request_json.call_args_list[-1],
            call(
                "POST",
                "http://registry.test/api/v1/workflow/tasks/task-1/actions",
                {
                    "action": "approve",
                    "comment": "Approved by the controlled documentation import workflow.",
                },
                options=options,
            ),
        )


if __name__ == "__main__":
    unittest.main()
