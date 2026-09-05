#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
SERVICE_ROOT = ROOT / "services" / "ingestion-service"
sys.path.insert(0, str(SERVICE_ROOT))

from app.config import load_settings  # noqa: E402
from app.object_storage import SourceObject  # noqa: E402
from parsers.docling import DoclingParser, directory_sha256  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run a content-safe local Docling/GraniteDocling ingestion smoke test."
    )
    parser.add_argument("inputs", nargs="+", type=Path)
    parser.add_argument("--artifacts", required=True, type=Path)
    parser.add_argument("--pipeline", choices=("standard", "granite"), default="granite")
    parser.add_argument(
        "--device",
        choices=("auto", "cpu", "cuda", "mps", "mlx"),
        default="auto",
    )
    parser.add_argument("--ocr", action="store_true")
    args = parser.parse_args()

    artifacts_digest = directory_sha256(args.artifacts)
    settings = load_settings(
        {
            "AKL_ENV": "development",
            "AKL_AUTH_MODE": "disabled",
            "AKL_INGESTION_REGISTRY_CLIENT_MODE": "mock",
            "AKL_INGESTION_OBJECT_STORAGE_MODE": "local",
            "AKL_OBJECT_STORAGE_ROOT": str(ROOT / "data" / "docling-smoke-objects"),
            "AKL_INGESTION_EMBEDDING_CLIENT_MODE": "mock",
            "AKL_INGESTION_INDEXER_MODE": "mock",
            "AKL_INGESTION_DOCLING_MODE": "enforce",
            "AKL_INGESTION_DOCLING_PIPELINE": args.pipeline,
            "AKL_INGESTION_DOCLING_DEVICE": args.device,
            "AKL_INGESTION_DOCLING_ARTIFACTS_PATH": str(args.artifacts),
            "AKL_INGESTION_DOCLING_ARTIFACTS_SHA256": artifacts_digest,
        }
    )
    docling = DoclingParser(settings)
    if docling.readiness() != "ready":
        raise SystemExit("Docling parser is not ready; no conversion was attempted.")

    results = []
    for index, path in enumerate(args.inputs, start=1):
        content = path.read_bytes()
        source_digest = hashlib.sha256(content).hexdigest()
        source = SourceObject(
            uri=f"local-smoke://source-{index}",
            filename=path.name,
            mime_type=mimetypes.guess_type(path.name)[0] or "application/octet-stream",
            content=content,
            sha256=f"sha256:{source_digest}",
        )
        result = docling.parse(
            source,
            parser_profile="controlled_document",
            ocr_enabled=args.ocr,
        )
        results.append(
            {
                "source": index,
                "sourceSha256": f"sha256:{source_digest}",
                "suffix": path.suffix.lower(),
                "parser": result.parser_name,
                "pipeline": result.metadata.get("docling_pipeline"),
                "pages": result.pages_processed,
                "blocks": len(result.blocks),
                "tables": result.tables_detected,
                "textChars": result.text_length,
                "ocrUsed": result.ocr_used,
                "warnings": [code for code, _ in result.warnings],
                "structureSha256": result.metadata.get("docling_structural_sha256"),
                "elapsedMs": result.metadata.get("docling_elapsed_ms"),
            }
        )

    print(
        json.dumps(
            {
                "schema": "akb-docling-local-smoke-1",
                "pipeline": args.pipeline,
                "device": args.device,
                "artifactsSha256": artifacts_digest,
                "documents": results,
                "documentContentLogged": False,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
