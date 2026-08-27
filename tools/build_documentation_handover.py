#!/usr/bin/env python3
"""Validate and package the explicit customer-documentation inventory only."""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import hashlib
from html import escape
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import tempfile
from urllib.parse import unquote, urlsplit
import zipfile

from markdown_it import MarkdownIt
from markdown_it.tree import SyntaxTreeNode
import yaml


ROOT = Path(__file__).resolve().parents[1]
INVENTORY_PATH = "docs/handover/akb-stratos-dokumentacni-sada.json"
BUNDLE_NAME = "akb-stratos-predavaci-dokumentace-csu"
PDF_NAME = BUNDLE_NAME + "-cs.pdf"
INVENTORY_FIELDS = {
    "schema", "purpose", "package_id", "revision", "prepared_on", "language",
    "publication_status", "network_scope", "documentation_profile", "okf_base_profile",
    "canonical_format", "pdf_is_derived", "authorization", "metadata_requiring_explicit_mapping", "documents",
}
ENTRY_FIELDS = {"path", "external_ref", "document_type", "kind"}
CUSTOMER_DIRS = {
    "docs/handover", "docs/executive", "docs/deployment", "docs/how-to",
    "docs/templates/application-documentation",
}
EXCLUDED_CONTENT = re.compile(
    r"\b(?:aiip|processforge|securitypreflight|obsolete|legacy|retired|baseline)\b"
    r"|ai\s+innovation\s+portal|source_baselines|previous_path|registry_document_ids|import_observation"
    r"|docs/(?:qa|archive|CODEX_THREADS)/|/Users/|/private/tmp/|codex/"
    r"|[\w-]+\.home\.cz|stratos\.zeleznalady\.cz|127\.0\.0\.1"
    r"|-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._-]{16,}",
    re.IGNORECASE,
)
PARSER = MarkdownIt("commonmark", {"html": False}).enable("table")


@dataclass(frozen=True)
class Document:
    path: str
    text: str
    metadata: dict
    body: str


def assert_customer_content(text: str, path: str) -> None:
    if EXCLUDED_CONTENT.search(text):
        raise ValueError(f"CUSTOMER_CONTENT_EXCLUDED: {path}")


def source_path(root: Path, relative: str) -> Path:
    path = PurePosixPath(relative)
    if path.is_absolute() or ".." in path.parts or str(path) != relative:
        raise ValueError(f"CUSTOMER_PATH_INVALID: {relative}")
    resolved = (root / relative).resolve()
    if resolved != root.resolve() / relative or not resolved.is_file():
        raise ValueError(f"CUSTOMER_SOURCE_MISSING_OR_SYMLINK: {relative}")
    return resolved


def link_target(root: Path, source: str, href: str) -> str | None:
    url = urlsplit(href)
    if url.scheme or url.netloc:
        if url.scheme not in {"https", "mailto"}:
            raise ValueError(f"CUSTOMER_LINK_SCHEME_INVALID: {source}")
        return None
    resolved = (root / source).parent.joinpath(unquote(url.path)).resolve() if url.path else root / source
    if not resolved.is_relative_to(root.resolve()):
        raise ValueError(f"CUSTOMER_LINK_OUTSIDE_ROOT: {source}")
    return resolved.relative_to(root.resolve()).as_posix()


def load_sources(root: Path = ROOT) -> tuple[dict, list[Document]]:
    root = root.resolve()
    raw = source_path(root, INVENTORY_PATH).read_bytes().decode("utf-8")
    assert_customer_content(raw, INVENTORY_PATH)
    inventory = json.loads(raw)
    if set(inventory) != INVENTORY_FIELDS or inventory["schema"] != "akb-documentation-handover-inventory-1":
        raise ValueError("CUSTOMER_INVENTORY_FIELDS_INVALID")
    if not inventory["documents"] or inventory["canonical_format"] != "markdown" or inventory["pdf_is_derived"] is not True:
        raise ValueError("CUSTOMER_INVENTORY_FORMAT_INVALID")
    documents = []
    paths: set[str] = set()
    references: set[str] = set()
    for entry in inventory["documents"]:
        if set(entry) != ENTRY_FIELDS:
            raise ValueError("CUSTOMER_ENTRY_FIELDS_INVALID")
        relative = entry["path"]
        if str(PurePosixPath(relative).parent) not in CUSTOMER_DIRS or not relative.endswith(".md"):
            raise ValueError(f"CUSTOMER_SOURCE_NOT_ALLOWED: {relative}")
        if relative in paths or entry["external_ref"] in references:
            raise ValueError("CUSTOMER_SOURCE_DUPLICATED")
        paths.add(relative)
        references.add(entry["external_ref"])
        text = source_path(root, relative).read_bytes().decode("utf-8")
        assert_customer_content(text, relative)
        front = re.match(r"\A---\n(.*?)\n---\n", text, re.DOTALL)
        if not front:
            raise ValueError(f"CUSTOMER_METADATA_MISSING: {relative}")
        metadata = yaml.safe_load(front.group(1))
        expected = {
            "external_ref": entry["external_ref"], "document_type": entry["document_type"],
            "documentation_kind": entry["kind"], "document_revision": inventory["revision"],
            "documentation_profile": inventory["documentation_profile"], "language": inventory["language"],
            "status": inventory["publication_status"],
        }
        if not isinstance(metadata, dict) or any(metadata.get(key) != value for key, value in expected.items()):
            raise ValueError(f"CUSTOMER_METADATA_MISMATCH: {relative}")
        body = text[front.end():].strip()
        if not body.startswith(f"# {metadata['title']}\n"):
            raise ValueError(f"CUSTOMER_TITLE_MISMATCH: {relative}")
        documents.append(Document(relative, text, metadata, body))
    allowed = paths | {INVENTORY_PATH}
    for document in documents:
        for node in SyntaxTreeNode(PARSER.parse(document.body)).walk():
            if node.type == "link":
                target = link_target(root, document.path, node.attrs["href"])
                if target is not None and target not in allowed:
                    raise ValueError(f"CUSTOMER_LINK_NOT_PACKAGED: {document.path}")
            if node.type in {"html_block", "html_inline", "image"}:
                raise ValueError(f"CUSTOMER_UNSUPPORTED_CONTENT: {document.path}")
    return inventory, documents


def render_pdf(destination: Path, inventory: dict, documents: list[Document], font_dir: Path) -> None:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import (
        PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle, XPreformatted,
    )
    from reportlab.platypus.tableofcontents import TableOfContents

    for name, filename in {
        "Handover": "DejaVuSans.ttf", "Handover-Bold": "DejaVuSans-Bold.ttf",
        "Handover-Italic": "DejaVuSans-Oblique.ttf", "Handover-BoldItalic": "DejaVuSans-BoldOblique.ttf",
        "Handover-Mono": "DejaVuSansMono.ttf",
    }.items():
        pdfmetrics.registerFont(TTFont(name, str(font_dir / filename)))
    pdfmetrics.registerFontFamily("Handover", normal="Handover", bold="Handover-Bold", italic="Handover-Italic", boldItalic="Handover-BoldItalic")
    ink, teal, muted = colors.HexColor("#182A32"), colors.HexColor("#116B78"), colors.HexColor("#52616A")
    styles = getSampleStyleSheet()
    body = ParagraphStyle("CustomerBody", fontName="Handover", fontSize=10, leading=14, textColor=ink, spaceAfter=6, allowWidows=0)
    heading = ParagraphStyle("CustomerHeading", parent=body, fontName="Handover-Bold", fontSize=17, leading=22, spaceAfter=14, keepWithNext=True)
    subheading = ParagraphStyle("CustomerSubheading", parent=body, fontName="Handover-Bold", fontSize=12.5, leading=17, spaceBefore=9, spaceAfter=6, keepWithNext=True)
    minor = ParagraphStyle("CustomerMinor", parent=subheading, fontSize=10.5, leading=15)
    small = ParagraphStyle("CustomerSmall", parent=body, fontSize=8.5, leading=12, textColor=muted)
    cell = ParagraphStyle("CustomerCell", parent=body, fontSize=8.8, leading=12.4, spaceAfter=0, splitLongWords=True)
    note = ParagraphStyle("CustomerNote", parent=body, leftIndent=9, rightIndent=9, textColor=muted, spaceBefore=5)
    template_body = ParagraphStyle("TemplateBody", parent=body, fontSize=9.5, leading=12.5, spaceAfter=4)
    template_heading = ParagraphStyle("TemplateHeading", parent=subheading, fontSize=11, leading=14, spaceBefore=5, spaceAfter=3)
    width = A4[0] - 38 * mm
    targets = {document.path: document.metadata["external_ref"] for document in documents}
    targets[INVENTORY_PATH] = "contents"

    def inline(node: SyntaxTreeNode, document: Document) -> str:
        children = lambda: "".join(inline(child, document) for child in node.children)
        if node.type in {"inline", "th", "td"}:
            return children()
        if node.type == "text":
            return escape(node.content)
        if node.type == "code_inline":
            return f'<font name="Handover-Mono" size="8">{escape(node.content)}</font>'
        if node.type in {"strong", "em"}:
            tag = "b" if node.type == "strong" else "i"
            return f"<{tag}>{children()}</{tag}>"
        if node.type in {"softbreak", "hardbreak"}:
            return " " if node.type == "softbreak" else "<br/>"
        if node.type == "link":
            href = node.attrs["href"]
            target = link_target(ROOT, document.path, href)
            href = "#" + targets[target] if target is not None else href
            return f'<a href="{escape(href, quote=True)}" color="#116B78">{children()}</a>'
        raise ValueError(f"PDF_INLINE_UNSUPPORTED: {node.type}")

    def blocks(nodes: list[SyntaxTreeNode], document: Document, style=body) -> list:
        flows = []
        is_template = document.metadata["documentation_kind"] == "vzor"
        for node in nodes:
            if node.type == "paragraph":
                flows.append(Paragraph("".join(inline(child, document) for child in node.children), style))
            elif node.type == "heading":
                heading_style = template_heading if is_template else subheading if node.tag == "h2" else minor
                flows.append(Paragraph(inline(node.children[0], document), heading_style))
            elif node.type in {"bullet_list", "ordered_list"}:
                for index, item in enumerate(node.children, int(node.attrs.get("start", 1))):
                    item_style = ParagraphStyle("ListItem", parent=style, leftIndent=14, bulletIndent=1)
                    item_flows = blocks(item.children, document, item_style)
                    if not item_flows or not isinstance(item_flows[0], Paragraph):
                        raise ValueError("PDF_LIST_ITEM_UNSUPPORTED")
                    item_flows[0].bulletText = f"{index}." if node.type == "ordered_list" else "-"
                    flows.extend(item_flows)
            elif node.type == "blockquote":
                flows.extend(blocks(node.children, document, note))
            elif node.type == "table":
                rows = [[inline(column, document) for column in row.children]
                        for section in node.children for row in section.children]
                count = len(rows[0])
                weights = {2: [0.34, 0.66], 3: [0.25, 0.38, 0.37], 4: [0.18, 0.34, 0.27, 0.21], 5: [0.17, 0.22, 0.22, 0.22, 0.17]}
                if count not in weights or any(len(row) != count for row in rows):
                    raise ValueError("PDF_TABLE_COLUMNS_UNSUPPORTED")
                table = Table(
                    [[Paragraph(f"<b>{value}</b>" if i == 0 else value, cell) for value in row] for i, row in enumerate(rows)],
                    colWidths=[width * weight for weight in weights[count]], repeatRows=1, hAlign="LEFT",
                )
                table.setStyle(TableStyle([
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E8F2F3")),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F6F8F9")]),
                    ("LINEBELOW", (0, 0), (-1, -1), 0.3, colors.HexColor("#CEDBDD")),
                    ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                    ("TOPPADDING", (0, 0), (-1, -1), 3 if is_template else 6),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3 if is_template else 6),
                ]))
                flows.extend([table, Spacer(1, 9)])
            elif node.type in {"fence", "code_block"}:
                longest = max((pdfmetrics.stringWidth(line, "Handover-Mono", 8) for line in node.content.splitlines()), default=1)
                size = min(8, 8 * width / max(longest, 1))
                if size < 7:
                    raise ValueError(f"PDF_CODE_TOO_WIDE: {document.path}")
                code = ParagraphStyle("CustomerCode", parent=styles["Code"], fontName="Handover-Mono", fontSize=size, leading=size * 1.45, spaceAfter=10)
                flows.append(XPreformatted(escape(node.content.rstrip()), code))
            else:
                raise ValueError(f"PDF_BLOCK_UNSUPPORTED: {node.type}")
        return flows

    class HandoverDoc(SimpleDocTemplate):
        def afterFlowable(self, flowable):
            if getattr(flowable, "bookmark", None):
                key = flowable.bookmark
                self.canv.bookmarkPage(key)
                self.canv.addOutlineEntry(flowable.getPlainText(), key, 0)
                self.notify("TOCEntry", (0, flowable.getPlainText(), self.page, key))

    def furniture(canvas, document):
        canvas.setDateFormatter(lambda *_: "D:" + inventory["prepared_on"].replace("-", "") + "000000Z")
        canvas.saveState()
        if document.page > 1:
            canvas.setFont("Handover", 8)
            canvas.setFillColor(muted)
            canvas.drawString(19 * mm, A4[1] - 13 * mm, "AKB a STRATOS | Interní pilot ČSÚ")
        canvas.setStrokeColor(colors.HexColor("#CEDBDD"))
        canvas.line(19 * mm, 15 * mm, A4[0] - 19 * mm, 15 * mm)
        canvas.setFont("Handover", 8)
        canvas.setFillColor(muted)
        canvas.drawString(19 * mm, 10 * mm, f"Dokumentační sada {inventory['revision']} | K posouzení")
        canvas.drawRightString(A4[0] - 19 * mm, 10 * mm, str(document.page))
        canvas.restoreState()

    cover = ParagraphStyle("CustomerCover", parent=heading, fontSize=30, leading=37, spaceAfter=20)
    year, month, day = map(int, inventory["prepared_on"].split("-"))
    story = [Spacer(1, 35 * mm), Paragraph("AKB a STRATOS", cover),
             Paragraph("Dokumentace interního pilotu ČSÚ", heading),
             Paragraph("Funkce, infrastruktura, bezpečnost, provoz a práce s dokumentací", body),
             Spacer(1, 15 * mm),
             Paragraph(f"Revize {inventory['revision']} | {day}. {month}. {year}", subheading),
             Paragraph("Podklady pro vedení, bezpečnostní tým, IT správce a uživatele.", body),
             Paragraph("Pilot je určen pouze pro vnitřní síť ČSÚ. Kapacity a provozní cíle jsou návrhem k potvrzení při převzetí.", body),
             Spacer(1, 12 * mm),
             Paragraph(f"Souhrnné PDF odpovídá {len(documents)} zdrojovým dokumentům stejné revize. Metodika a autorské vzory jsou zahrnuty v závěrečné části.", small), PageBreak()]
    story.append(Paragraph('<a name="contents"/>Obsah', heading))
    toc = TableOfContents()
    toc.levelStyles = [ParagraphStyle("Contents", parent=body, fontSize=10, leading=15, spaceBefore=5, leftIndent=12, firstLineIndent=-12, alignment=TA_LEFT)]
    story.extend([toc, PageBreak()])
    for index, document in enumerate(documents):
        if index:
            story.append(PageBreak())
        title = Paragraph(escape(document.metadata["title"]), heading)
        title.bookmark = document.metadata["external_ref"]
        story.extend([title, Paragraph(f"Revize {inventory['revision']} | {escape(document.metadata['applies_to'])}", small)])
        content_style = template_body if document.metadata["documentation_kind"] == "vzor" else body
        story.extend(blocks(SyntaxTreeNode(PARSER.parse(document.body)).children[1:], document, content_style))
    HandoverDoc(
        str(destination), pagesize=A4, leftMargin=19 * mm, rightMargin=19 * mm,
        topMargin=23 * mm, bottomMargin=23 * mm, title="AKB a STRATOS: dokumentace interního pilotu ČSÚ",
        author="AKB a STRATOS", subject=f"Dokumentační sada {inventory['revision']}", invariant=True,
    ).multiBuild(story, onFirstPage=furniture, onLaterPages=furniture)


def verify_pdf(path: Path, documents: list[Document]) -> int:
    from pypdf import PdfReader

    reader = PdfReader(path)
    page_texts = [page.extract_text() or "" for page in reader.pages]
    text = "\n".join(page_texts)
    assert_customer_content(text, path.name)
    assert_customer_content(str(reader.metadata), path.name)
    revision = documents[0].metadata["document_revision"]
    bodies = []
    # The renderer writes page furniture first; exclude it when joining split paragraphs.
    for number, page_text in enumerate(page_texts, 1):
        prefix = "AKB a STRATOS | Interní pilot ČSÚ\n" if number > 1 else ""
        prefix += f"Dokumentační sada {revision} | K posouzení\n{number}\n"
        if not page_text.startswith(prefix):
            raise ValueError(f"PDF_PAGE_FURNITURE_INVALID: {number}")
        bodies.append(page_text[len(prefix):])
    compact = re.sub(r"\s+", "", "\n".join(bodies))
    for document in documents:
        for node in SyntaxTreeNode(PARSER.parse(document.body)).walk():
            if node.type in {"text", "code_inline", "fence", "code_block"}:
                fragment = re.sub(r"\s+", "", node.content)
                if fragment and fragment not in compact:
                    raise ValueError(f"PDF_SOURCE_TEXT_MISSING: {document.path}")
    return len(reader.pages)


def build_bundle(inventory: dict, documents: list[Document], font_dir: Path) -> dict:
    output = ROOT / "output"
    output.mkdir(exist_ok=True)
    bundle = output / BUNDLE_NAME
    if bundle.is_symlink() or (output / "pdf").is_symlink():
        raise ValueError("CUSTOMER_OUTPUT_SYMLINK")
    if bundle.exists():
        previous = bundle / INVENTORY_PATH
        if not previous.is_file() or json.loads(previous.read_text())["package_id"] != inventory["package_id"]:
            raise ValueError("CUSTOMER_OUTPUT_NOT_OWNED")
    # Construct a fresh allowlisted tree; never package a source or output directory recursively.
    with tempfile.TemporaryDirectory(prefix="handover-", dir=output) as temporary:
        staged = Path(temporary) / BUNDLE_NAME
        staged.mkdir()
        for document in documents:
            target = staged / document.path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(document.text, encoding="utf-8")
        inventory_file = staged / INVENTORY_PATH
        inventory_file.write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        render_pdf(staged / PDF_NAME, inventory, documents, font_dir)
        pages = verify_pdf(staged / PDF_NAME, documents)
        files = [document.path for document in documents] + [INVENTORY_PATH, PDF_NAME]
        checksums = {
            "schema": "akb-documentation-checksums-1", "package_id": inventory["package_id"],
            "revision": inventory["revision"], "algorithm": "sha256",
            "files": [{"path": path, "bytes": (staged / path).stat().st_size,
                       "sha256": hashlib.sha256((staged / path).read_bytes()).hexdigest()} for path in sorted(files)],
        }
        (staged / "kontrolni-soucty.json").write_text(json.dumps(checksums, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        files.append("kontrolni-soucty.json")
        archive = Path(temporary) / (BUNDLE_NAME + ".zip")
        date = tuple(int(part) for part in inventory["prepared_on"].split("-")) + (0, 0, 0)
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as handle:
            for path in sorted(files):
                info = zipfile.ZipInfo(BUNDLE_NAME + "/" + path, date_time=date)
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                handle.writestr(info, (staged / path).read_bytes())
        if bundle.exists():
            shutil.rmtree(bundle)
        shutil.move(str(staged), bundle)
        archive.replace(output / archive.name)
        (output / "pdf").mkdir(exist_ok=True)
        shutil.copyfile(bundle / PDF_NAME, output / "pdf" / PDF_NAME)
    return {"status": "passed", "revision": inventory["revision"], "documents": len(documents), "bundle_files": len(files), "pdf_pages": pages}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build", action="store_true", help="Replace only this generated customer bundle after validation.")
    parser.add_argument("--font-dir", type=Path, help="Directory containing the DejaVu Sans TTF family.")
    args = parser.parse_args()
    inventory, documents = load_sources()
    if args.build:
        if not args.font_dir:
            parser.error("--build requires --font-dir")
        result = build_bundle(inventory, documents, args.font_dir)
    else:
        result = {"status": "passed", "revision": inventory["revision"], "documents": len(documents)}
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
