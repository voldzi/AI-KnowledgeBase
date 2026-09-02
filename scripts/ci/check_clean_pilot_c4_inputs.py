#!/usr/bin/env python3
"""Fail closed when a Clean Pilot C4 application build input is mutable."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


PYTHON_SERVICES = (
    "registry-api",
    "ingestion-service",
    "rag-retrieval-service",
    "evaluation-service",
)
PYTHON_BASE = "python:3.12-slim@sha256:e5c9fa26ffb76e11e0f054f30dc2523a2f9693f0c36c0cf1e39b27e152d899fc"
NODE_BASE = "node:26-alpine@sha256:2d984a15c9b54fd0aeb608b8e0d0d83529eb34d2966db27a1fb4f1edc3d298a3"
PNPM_CHECKSUM = "sha256:deafa7ec98a1218b6a047289b92fbe2395c1e22d3495bb711653013218ee15ee"
DEBIAN_SNAPSHOT = "snapshot.debian.org/archive/debian/20260824T000000Z"
DEBIAN_SECURITY_SNAPSHOT = "snapshot.debian.org/archive/debian-security/20260824T000000Z"
UPSTREAM_NAMES = ("postgresql", "s3-object-storage", "opensearch", "qdrant")


def stop(message: str) -> None:
    raise SystemExit(f"C4 locked-input check failed: {message}")


def logical_requirements(text: str) -> list[str]:
    result: list[str] = []
    current = ""
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        current = f"{current} {line}".strip()
        if current.endswith("\\"):
            current = current[:-1].strip()
            continue
        result.append(current)
        current = ""
    if current:
        stop("truncated Python lock entry")
    return result


def check_python_lock(path: Path) -> None:
    if not path.is_file():
        stop(f"missing {path.relative_to(path.parents[2])}")
    entries = logical_requirements(path.read_text(encoding="utf-8"))
    if not entries:
        stop(f"empty Python lock {path}")
    for entry in entries:
        if entry.startswith(("--index-url", "--trusted-host", "--find-links")):
            stop(f"mutable package source directive in {path.name}")
        requirement = entry.split(" ; ", 1)[0]
        if "==" not in requirement:
            stop(f"non-exact Python requirement in {path.name}: {requirement}")
        hashes = re.findall(r"--hash=sha256:[0-9a-f]{64}", entry)
        if not hashes:
            stop(f"unhashed Python requirement in {path.name}: {requirement}")


def require(text: str, value: str, label: str) -> None:
    if value not in text:
        stop(f"missing {label}")


def reject(text: str, value: str, label: str) -> None:
    if value in text:
        stop(f"forbidden {label}")


def check(root: Path) -> None:
    for service in PYTHON_SERVICES:
        service_root = root / "services" / service
        dockerfile = (service_root / "Dockerfile").read_text(encoding="utf-8")
        require(dockerfile, f"FROM {PYTHON_BASE}", f"pinned Python base for {service}")
        require(dockerfile, "--require-hashes -r requirements.c4.lock", f"hashed install for {service}")
        check_python_lock(service_root / "requirements.c4.lock")

    registry = (root / "services/registry-api/Dockerfile").read_text(encoding="utf-8")
    require(registry, "ARG SOURCE_DATE_EPOCH", "registry wheel build epoch argument")
    require(registry, 'test "$SOURCE_DATE_EPOCH" -gt 0', "positive registry wheel build epoch")
    require(registry, "export SOURCE_DATE_EPOCH", "registry wheel build epoch environment")
    require(registry, "export PIP_NO_CACHE_DIR=1", "disabled isolated wheel pip cache")
    require(registry, "rm -rf /root/.cache/pip", "isolated wheel pip cache cleanup")

    ingestion = (root / "services/ingestion-service/Dockerfile").read_text(encoding="utf-8")
    require(ingestion, DEBIAN_SNAPSHOT, "fixed Debian snapshot")
    require(ingestion, DEBIAN_SECURITY_SNAPSHOT, "fixed Debian security snapshot")
    reject(ingestion, "http://deb.debian.org", "mutable Debian mirror")
    for package in (
        "ghostscript=", "libreoffice-calc-nogui=", "libreoffice-impress-nogui=",
        "libreoffice-writer-nogui=", "fonts-dejavu-core=", "fonts-liberation=",
        "fonts-noto-core=", "ocrmypdf=", "poppler-utils=", "qpdf=",
        "tesseract-ocr=", "tesseract-ocr-ces=", "tesseract-ocr-eng=",
        "tesseract-ocr-osd=", "unpaper=",
    ):
        require(ingestion, package, f"version pin for {package[:-1]}")
    require(
        ingestion,
        "--require-hashes -r requirements-docling.c4.lock",
        "hash-locked Docling install",
    )
    require(ingestion, "--only-binary=:all:", "binary-only Python installs")
    require(
        ingestion,
        "--extra-index-url https://download.pytorch.org/whl/cpu",
        "reviewed CPU-only PyTorch package source",
    )
    reject(ingestion, "requirements-docling.txt", "unlocked Docling requirements")
    docling_lock = root / "services/ingestion-service/requirements-docling.c4.lock"
    check_python_lock(docling_lock)
    require(
        docling_lock.read_text(encoding="utf-8"),
        "docling-slim==2.124.0",
        "pinned Docling runtime",
    )
    reject(
        docling_lock.read_text(encoding="utf-8"),
        "rapidocr==",
        "unused RapidOCR dependency",
    )
    require(
        docling_lock.read_text(encoding="utf-8"),
        "torch==2.14.0+cpu",
        "pinned CPU-only PyTorch runtime",
    )
    macos_docling_lock = (
        root / "services/ingestion-service/requirements-docling-macos.c4.lock"
    )
    check_python_lock(macos_docling_lock)
    macos_docling = macos_docling_lock.read_text(encoding="utf-8")
    require(macos_docling, "docling-slim==2.124.0", "pinned macOS Docling runtime")
    require(macos_docling, "mlx==0.32.2", "pinned Apple Silicon MLX runtime")
    reject(macos_docling, "docling-parse==", "macOS source-only docling-parse dependency")
    for locked_requirements in (docling_lock, macos_docling_lock):
        require(
            locked_requirements.read_text(encoding="utf-8"),
            "#    scripts/ci/compile_docling_locks.sh",
            f"reproducible generator header in {locked_requirements.name}",
        )
    lock_generator = (
        root / "scripts/ci/compile_docling_locks.sh"
    ).read_text(encoding="utf-8")
    require(lock_generator, 'UV_VERSION="0.12.9"', "pinned Docling lock resolver")
    require(
        lock_generator,
        'PACKAGE_CUTOFF="2026-09-02T20:00:00Z"',
        "Docling package publication cutoff",
    )
    local_setup = (root / "scripts/setup_docling_local.sh").read_text(encoding="utf-8")
    require(
        local_setup,
        "AKL_DOCLING_MIN_FREE_GIB:-20",
        "Docling local disk-space preflight",
    )

    web = (root / "apps/web/Dockerfile").read_text(encoding="utf-8")
    if web.count(f"FROM {NODE_BASE}") != 3:
        stop("all three web stages must use the pinned Node base")
    require(web, f"ADD --checksum={PNPM_CHECKSUM}", "pnpm tarball checksum")
    require(web, "pnpm.cjs install --frozen-lockfile", "frozen pnpm install")
    reject(web, "npm install", "npm registry metadata install")
    reject(web, "apk add", "mutable Alpine package install")
    pnpm_lock = (root / "apps/web/pnpm-lock.yaml").read_text(encoding="utf-8")
    require(pnpm_lock, "lockfileVersion:", "pnpm lockfile")
    require(pnpm_lock, "integrity: sha512-", "pnpm package integrity")

    publisher = (root / "scripts/ci/publish_clean_pilot_c4_images.sh").read_text(encoding="utf-8")
    for value, label in (
        ("docker buildx build --pull", "Buildx pull build"),
        ('--build-arg "SOURCE_DATE_EPOCH=$source_date_epoch"', "commit timestamp"),
        ("--provenance=false", "disabled provenance"),
        ("--sbom=false", "disabled SBOM"),
        ("unpack=false,rewrite-timestamp=true", "non-unpacking timestamp rewrite"),
        ("scripts/ci/check_clean_pilot_c4_inputs.py", "locked-input preflight"),
    ):
        require(publisher, value, label)
    require(
        publisher,
        "build_and_publish ingestion-service services/ingestion-service --build-arg AKL_INSTALL_DOCLING=true",
        "Docling-enabled immutable ingestion image",
    )
    copied = dict(re.findall(
        r"^publish_existing\s+([a-z0-9-]+)\s+([^\s]+)$",
        publisher,
        flags=re.MULTILINE,
    ))
    if tuple(copied) != UPSTREAM_NAMES:
        stop("copied infrastructure image set or order drift")
    for name, image in copied.items():
        if not re.fullmatch(r"[^\s@]+@sha256:[0-9a-f]{64}", image):
            stop(f"mutable infrastructure image for {name}")

    print("C4 locked-input check PASS")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    check(args.root.resolve())


if __name__ == "__main__":
    main()
