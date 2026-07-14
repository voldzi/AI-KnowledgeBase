from __future__ import annotations

import base64
import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from tools.import_docs_folder import approve_document_for_publication, bearer_subject_id
from tools.legacy_mutation_guard import LegacyMutationBlocked


class ImportDocsFolderGovernanceTest(unittest.TestCase):
    def test_bearer_subject_id_uses_oidc_subject(self) -> None:
        payload = base64.urlsafe_b64encode(json.dumps({"sub": "subject-123"}).encode()).decode().rstrip("=")

        self.assertEqual(bearer_subject_id(f"header.{payload}.signature"), "subject-123")

    def test_legacy_approval_is_retired_before_http(self) -> None:
        options = SimpleNamespace(registry_url="http://registry.test")
        with patch("tools.import_docs_folder.request_json") as request_json:
            with self.assertRaisesRegex(LegacyMutationBlocked, "LEGACY_MUTATION_RETIRED"):
                approve_document_for_publication("doc-1", options)  # type: ignore[arg-type]

        request_json.assert_not_called()


if __name__ == "__main__":
    unittest.main()
