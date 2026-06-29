from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.import_docs_folder import metadata_for_path  # noqa: E402
from tools.okf_profile import (  # noqa: E402
    akb_metadata_from_okf,
    export_from_import_report,
    parse_markdown_frontmatter,
    plan_import,
    validate_bundle,
)


OKF_MARKDOWN = """---
type: policy
title: Povinnosti ISVS podle zákona 365/2000 Sb.
tenant_id: stratos
classification: internal
document_type: regulation
owner: odbor-ict
language: cs
external_system: STRATOS_PROJECTFLOW
external_ref: isvs-365
tags: [isvs, digitalizace]
---

# Povinnosti ISVS

Znalostní koncept pro AKB.
"""


class OkfProfileTest(unittest.TestCase):
    def test_frontmatter_parser_reads_okf_concept(self) -> None:
        frontmatter, body = parse_markdown_frontmatter(OKF_MARKDOWN)

        self.assertEqual(frontmatter["type"], "policy")
        self.assertEqual(frontmatter["tags"], ["isvs", "digitalizace"])
        self.assertIn("# Povinnosti ISVS", body)

    def test_okf_metadata_maps_to_akb_metadata(self) -> None:
        frontmatter, _body = parse_markdown_frontmatter(OKF_MARKDOWN)
        metadata = akb_metadata_from_okf(frontmatter, "governance/isvs.md")

        self.assertEqual(metadata["okf_profile"], "stratos-okf-v1")
        self.assertEqual(metadata["okf_type"], "policy")
        self.assertEqual(metadata["tenant_id"], "stratos")
        self.assertEqual(metadata["document_type"], "regulation")
        self.assertEqual(metadata["source_system"], "STRATOS_PROJECTFLOW")
        self.assertEqual(metadata["external_ref"], "isvs-365")
        self.assertIn("okf-type:policy", metadata["tags"])

    def test_validate_and_plan_import(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp)
            (source / "governance").mkdir()
            (source / "governance" / "isvs.md").write_text(OKF_MARKDOWN, encoding="utf-8")

            validation = validate_bundle(source)
            plan = plan_import(source)

        self.assertEqual(validation["totals"]["valid_concepts"], 1)
        self.assertEqual(validation["errors"], [])
        self.assertEqual(plan["concepts"][0]["metadata"]["okf_source_path"], "governance/isvs.md")

    def test_import_docs_folder_can_merge_okf_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "isvs.md"
            path.write_text(OKF_MARKDOWN, encoding="utf-8")
            manifest = {
                "defaults": {
                    "document_type": "project_documentation",
                    "classification": "internal",
                    "status": "valid",
                    "owner": "akb-team",
                    "area": "project",
                    "language": "cs",
                    "source_system": "git",
                    "tags": ["akb-docs"],
                }
            }
            metadata = metadata_for_path("isvs.md", manifest, path)

        self.assertEqual(metadata["document_type"], "regulation")
        self.assertEqual(metadata["owner"], "odbor-ict")
        self.assertEqual(metadata["okf_source_path"], "isvs.md")
        self.assertIn("digitalizace", metadata["tags"])

    def test_export_from_import_report_writes_okf_bundle(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "docs"
            source.mkdir()
            (source / "isvs.md").write_text("# Povinnosti ISVS\n\nObsah.", encoding="utf-8")
            report_path = root / "report.json"
            output = root / "okf"
            report_path.write_text(
                """
{
  "source": "%s",
  "documents": [
    {
      "source_path": "isvs.md",
      "title": "Povinnosti ISVS",
      "source_file_uri": "s3://akl-documents/isvs.md",
      "document_id": "doc_1",
      "document_version_id": "ver_1",
      "metadata": {
        "document_type": "regulation",
        "classification": "internal",
        "status": "valid",
        "owner": "odbor-ict",
        "language": "cs",
        "source_system": "git",
        "tags": ["isvs"]
      }
    }
  ]
}
""" % source.as_posix(),
                encoding="utf-8",
            )
            report = export_from_import_report(report_path, output)
            exported = output / "isvs.md"
            frontmatter, body = parse_markdown_frontmatter(exported.read_text(encoding="utf-8"))

        self.assertEqual(report["totals"]["valid_concepts"], 1)
        self.assertEqual(frontmatter["type"], "regulation")
        self.assertEqual(frontmatter["akb_document_id"], "doc_1")
        self.assertIn("# Povinnosti ISVS", body)


if __name__ == "__main__":
    unittest.main()
