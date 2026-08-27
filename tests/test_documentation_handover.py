from __future__ import annotations

import importlib.util
import hashlib
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import zipfile

import pytest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("documentation_handover", ROOT / "tools/build_documentation_handover.py")
assert SPEC and SPEC.loader
handover = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = handover
SPEC.loader.exec_module(handover)


@pytest.fixture
def source_tree(tmp_path: Path):
    inventory = json.loads((ROOT / handover.INVENTORY_PATH).read_text(encoding="utf-8"))
    entry = inventory["documents"][0]
    inventory["documents"] = [entry]
    destination = tmp_path / entry["path"]
    destination.parent.mkdir(parents=True)
    metadata = "\n".join([
        "---", 'title: "Customer guide"', f"external_ref: {entry['external_ref']}",
        f"document_type: {entry['document_type']}", f"documentation_kind: {entry['kind']}",
        f"document_revision: \"{inventory['revision']}\"", f"documentation_profile: {inventory['documentation_profile']}",
        "language: cs", "status: draft", "---", "", "# Customer guide", "", "Current AKB functions.", "",
    ])
    destination.write_text(metadata, encoding="utf-8")
    (tmp_path / handover.INVENTORY_PATH).write_text(json.dumps(inventory), encoding="utf-8")
    return tmp_path, inventory, destination


def test_current_handover_contains_only_consistent_customer_sources():
    inventory, documents = handover.load_sources(ROOT)
    assert len(documents) == 16
    assert inventory["revision"] == "1.1"
    assert inventory["network_scope"] == "csu-internal-only"
    assert all(document.metadata["status"] == "draft" for document in documents)


@pytest.mark.parametrize("content", [
    "AIIP", "AI Innovation Portal", "ProcessForge", "SecurityPreflight",
    "retired", "baseline commit", "/Users/author/private-worktree",
    "docs/qa/internal-report.md", "docker.home.cz", "Bearer " + "x" * 32,
])
def test_obsolete_or_internal_content_blocks_distribution(source_tree, content):
    root, _, document = source_tree
    document.write_text(document.read_text() + content, encoding="utf-8")
    with pytest.raises(ValueError, match="CUSTOMER_CONTENT_EXCLUDED"):
        handover.load_sources(root)


def test_internal_inventory_fields_are_not_forwarded(source_tree):
    root, inventory, _ = source_tree
    inventory["operator_note"] = "Not intended for customer"
    (root / handover.INVENTORY_PATH).write_text(json.dumps(inventory), encoding="utf-8")
    with pytest.raises(ValueError, match="CUSTOMER_INVENTORY_FIELDS_INVALID"):
        handover.load_sources(root)


def test_unlisted_relative_link_cannot_pull_another_document_into_handover(source_tree):
    root, _, document = source_tree
    document.write_text(document.read_text() + "\n[Internal](other-report.md)\n", encoding="utf-8")
    with pytest.raises(ValueError, match="CUSTOMER_LINK_NOT_PACKAGED"):
        handover.load_sources(root)


def test_document_revision_must_match_the_package(source_tree):
    root, _, document = source_tree
    document.write_text(document.read_text().replace('document_revision: "1.1"', 'document_revision: "1.0"'), encoding="utf-8")
    with pytest.raises(ValueError, match="CUSTOMER_METADATA_MISMATCH"):
        handover.load_sources(root)


def test_source_symlink_cannot_include_an_unreviewed_file(source_tree):
    root, _, document = source_tree
    target = root / "unreviewed.md"
    document.rename(target)
    document.symlink_to(target)
    with pytest.raises(ValueError, match="CUSTOMER_SOURCE_MISSING_OR_SYMLINK"):
        handover.load_sources(root)


def test_duplicate_document_is_rejected(source_tree):
    root, inventory, _ = source_tree
    inventory["documents"].append(dict(inventory["documents"][0]))
    (root / handover.INVENTORY_PATH).write_text(json.dumps(inventory), encoding="utf-8")
    with pytest.raises(ValueError, match="CUSTOMER_SOURCE_DUPLICATED"):
        handover.load_sources(root)


def test_html_is_not_rendered_as_active_content(source_tree):
    root, _, document = source_tree
    document.write_text(document.read_text() + '\n<script>alert("not executable")</script>\n', encoding="utf-8")
    _, documents = handover.load_sources(root)
    nodes = list(handover.SyntaxTreeNode(handover.PARSER.parse(documents[0].body)).walk())
    assert not any(node.type in {"html_block", "html_inline"} for node in nodes)


def test_document_history_is_not_confused_with_development_history(source_tree):
    root, _, document = source_tree
    document.write_text(document.read_text() + "\nHistorie předpisu a přesná verze přílohy zůstávají dohledatelné.\n", encoding="utf-8")
    _, documents = handover.load_sources(root)
    assert len(documents) == 1


@pytest.fixture
def pdf_pages(monkeypatch):
    import pypdf

    def configure(bodies, metadata=None):
        pages = []
        for number, body in enumerate(bodies, 1):
            prefix = "AKB a STRATOS | Interní pilot ČSÚ\n" if number > 1 else ""
            text = prefix + f"Dokumentační sada 1.1 | K posouzení\n{number}\n" + body
            pages.append(SimpleNamespace(extract_text=lambda value=text: value))
        monkeypatch.setattr(pypdf, "PdfReader", lambda _: SimpleNamespace(pages=pages, metadata=metadata or {}))

    return configure


def test_pdf_content_check_preserves_paragraphs_split_across_pages(source_tree, pdf_pages):
    _, documents = handover.load_sources(source_tree[0])
    pdf_pages(["Customer guide\nCurrent AKB\n", "functions.\n"])
    assert handover.verify_pdf(Path("handover.pdf"), documents) == 2


def test_pdf_content_check_rejects_missing_source_text(source_tree, pdf_pages):
    _, documents = handover.load_sources(source_tree[0])
    pdf_pages(["Customer guide\nCurrent AKB\n"])
    with pytest.raises(ValueError, match="PDF_SOURCE_TEXT_MISSING"):
        handover.verify_pdf(Path("handover.pdf"), documents)


def test_pdf_metadata_is_also_checked_for_excluded_content(source_tree, pdf_pages):
    _, documents = handover.load_sources(source_tree[0])
    pdf_pages(["Customer guide\nCurrent AKB functions.\n"], {"/Subject": "AIIP"})
    with pytest.raises(ValueError, match="CUSTOMER_CONTENT_EXCLUDED"):
        handover.verify_pdf(Path("handover.pdf"), documents)


@pytest.fixture
def generated_bundle(source_tree, monkeypatch):
    root, inventory, _ = source_tree
    bundle = root / "output" / handover.BUNDLE_NAME
    marker = bundle / handover.INVENTORY_PATH
    marker.parent.mkdir(parents=True)
    marker.write_text(json.dumps(inventory), encoding="utf-8")
    internal = bundle / "docs/qa/internal.md"
    internal.parent.mkdir(parents=True)
    internal.write_text("Internal record", encoding="utf-8")
    monkeypatch.setattr(handover, "ROOT", root)
    monkeypatch.setattr(handover, "render_pdf", lambda path, *_: path.write_bytes(b"test-pdf"))
    return root, bundle, internal


def test_rebuild_contains_only_inventory_sources_and_verified_derived_files(generated_bundle, monkeypatch):
    root, bundle, internal = generated_bundle
    inventory, documents = handover.load_sources(root)
    monkeypatch.setattr(handover, "verify_pdf", lambda *_: 1)
    result = handover.build_bundle(inventory, documents, root)
    assert result["bundle_files"] == 4
    assert not internal.exists()
    checksums = json.loads((bundle / "kontrolni-soucty.json").read_text())
    expected = {document.path for document in documents} | {handover.INVENTORY_PATH, handover.PDF_NAME}
    assert {entry["path"] for entry in checksums["files"]} == expected
    for entry in checksums["files"]:
        data = (bundle / entry["path"]).read_bytes()
        assert entry["sha256"] == hashlib.sha256(data).hexdigest()
        assert entry["bytes"] == len(data)
    with zipfile.ZipFile(root / "output" / (handover.BUNDLE_NAME + ".zip")) as archive:
        assert set(archive.namelist()) == {handover.BUNDLE_NAME + "/" + path for path in expected | {"kontrolni-soucty.json"}}
        for name in archive.namelist():
            relative = name.removeprefix(handover.BUNDLE_NAME + "/")
            assert archive.read(name) == (bundle / relative).read_bytes()


def test_failed_pdf_verification_does_not_replace_existing_bundle(generated_bundle, monkeypatch):
    root, _, internal = generated_bundle
    inventory, documents = handover.load_sources(root)

    def reject(*_):
        raise ValueError("PDF_SOURCE_TEXT_MISSING")

    monkeypatch.setattr(handover, "verify_pdf", reject)
    with pytest.raises(ValueError, match="PDF_SOURCE_TEXT_MISSING"):
        handover.build_bundle(inventory, documents, root)
    assert internal.read_text() == "Internal record"
    assert not (root / "output" / (handover.BUNDLE_NAME + ".zip")).exists()
