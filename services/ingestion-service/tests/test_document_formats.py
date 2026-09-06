import hashlib
from io import BytesIO
from pathlib import Path
import subprocess

from PIL import Image
import pytest

from app.config import load_settings
from app.document_formats import CATALOG
from app.object_storage import SourceObject
from app.pipeline import _quality_report
from parsers.base import ParserError
from parsers.router import ParserRouter


def source(filename, mime, content):
    return SourceObject(uri=f"file:///test/{filename}", filename=filename, mime_type=mime,
        content=content, sha256="sha256:" + hashlib.sha256(content).hexdigest(), local_path=None)


def router(**overrides):
    return ParserRouter(load_settings({"AKL_ENV": "test", "AKL_AUTH_MODE": "disabled",
        "AKL_INGESTION_OCR_PROVIDER": "ocrmypdf", "AKL_INGESTION_DOCLING_MODE": "off", **overrides}))


@pytest.mark.parametrize("entry", [entry for entry in CATALOG["formats"] if entry["parser"] == "plain_text"], ids=lambda value: value["id"])
def test_admitted_text_formats_reach_real_parser_with_section_citations(entry):
    content = ("Original source text with sufficient details for accurate extraction. " * 10).encode()
    for extension in entry["extensions"]:
        result = router().parse(source("source" + extension, entry["mime_type"], content), parser_profile="default", ocr_enabled=False)
        assert result.blocks and "Original source text" in result.blocks[0].text
        assert all(block.page_number is None for block in result.blocks)
        assert result.pages_processed == 0
        assert _quality_report(result, extraction_profile="default").quality_tier == "good"


@pytest.mark.parametrize("entry", [entry for entry in CATALOG["formats"] if entry["admission"] == "unavailable"], ids=lambda value: value["id"])
def test_unavailable_formats_cannot_fall_back_to_ocr(entry, monkeypatch):
    parser = router()
    monkeypatch.setattr(parser.ocr_provider, "extract", lambda *a, **kw: pytest.fail("Unavailable source must be rejected before OCR"))
    with pytest.raises(ParserError, match="no admitted extraction adapter"):
        parser.parse(source("source" + entry["extensions"][0], entry["mime_type"], b"bytes"), parser_profile="default", ocr_enabled=True)


def image_bytes(format):
    buffer = BytesIO()
    Image.new("RGB", (120, 80), "white").save(buffer, format=format)
    return buffer.getvalue()


@pytest.mark.parametrize("format,extension,mime", [("PNG", ".png", "image/png"), ("JPEG", ".jpg", "image/jpeg"), ("WEBP", ".webp", "image/webp")])
def test_default_ocr_stack_handles_images_and_requires_review(format, extension, mime, monkeypatch):
    calls = []
    def run(command, **kwargs):
        calls.append(command)
        assert command[0] == "tesseract"
        assert Path(command[1]).exists()
        return subprocess.CompletedProcess(command, 0, stdout="Recognized source evidence. " * 20, stderr="")
    monkeypatch.setattr(subprocess, "run", run)
    result = router().parse(source("scan" + extension, mime, image_bytes(format)), parser_profile="default", ocr_enabled=True)
    assert len(calls) == 1 and result.ocr_used
    assert all(block.page_number is None for block in result.blocks)
    assert _quality_report(result, extraction_profile="default").requires_review


def test_oversized_image_is_rejected_before_external_ocr(monkeypatch):
    monkeypatch.setitem(CATALOG["limits"]["image"], "pixels", 100)
    monkeypatch.setattr(subprocess, "run", lambda *a, **kw: pytest.fail("Pixel limit precedes OCR"))
    with pytest.raises(ParserError) as exc:
        router().parse(source("scan.png", "image/png", image_bytes("PNG")), parser_profile="default", ocr_enabled=True)
    assert exc.value.code == "OCR_IMAGE_SIZE_LIMIT"


def test_animated_image_cannot_silently_use_only_its_first_frame():
    buffer = BytesIO()
    Image.new("RGB", (32, 32), "white").save(buffer, format="WEBP", save_all=True,
        append_images=[Image.new("RGB", (32, 32), "black")], duration=200)
    with pytest.raises(ParserError) as exc:
        router().parse(source("scan.webp", "image/webp", buffer.getvalue()), parser_profile="default", ocr_enabled=True)
    assert exc.value.code == "OCR_IMAGE_FRAMES_UNSUPPORTED"


def test_format_mismatch_and_disabled_image_ocr_fail_explicitly():
    with pytest.raises(ParserError) as exc:
        router().parse(source("scan.png", "text/plain", image_bytes("PNG")), parser_profile="default", ocr_enabled=True)
    assert exc.value.code == "DOCUMENT_FORMAT_MIME_MISMATCH"
    with pytest.raises(ParserError) as exc:
        router().parse(source("scan.png", "image/png", image_bytes("PNG")), parser_profile="default", ocr_enabled=False)
    assert exc.value.code == "OCR_DISABLED"
