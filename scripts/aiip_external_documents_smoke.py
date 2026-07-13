#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool


ROOT = Path(__file__).resolve().parents[1]
SERVICE_DIR = ROOT / "services" / "registry-api"


def main() -> int:
    os.environ.setdefault("AKL_ENV", "test")
    os.environ.setdefault("AKL_AUTH_MODE", "mock")
    os.environ.setdefault("AKL_MOCK_ROLES", '["admin"]')
    os.environ.setdefault("AKL_AUTO_CREATE_SCHEMA", "false")

    sys.path.insert(0, str(SERVICE_DIR))

    from fastapi.testclient import TestClient  # noqa: WPS433

    from app.database import Base, get_db  # noqa: WPS433
    import app.models  # noqa: F401,WPS433
    from app.main import create_app  # noqa: WPS433

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine)
    session = session_factory()
    app = create_app()

    def override_get_db() -> Iterator[Session]:
        yield session

    app.dependency_overrides[get_db] = override_get_db
    headers = {
        "X-AKL-Subject": "svc_aiip",
        "X-AKL-Roles": "stratos_service,document_manager",
        "X-Request-ID": "aiip-external-documents-smoke",
        "X-Correlation-ID": "aiip-external-documents-smoke",
    }
    try:
        with TestClient(app) as client:
            verify_aiip_external_document_flow(client, headers)
            verify_aiip_secret_sensitivity_rejected(client, headers)
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)

    print("OK aiip_external_system=STRATOS_AIIP")
    print("OK aiip_upsert=idempotent")
    print("OK aiip_filters=tenant_external_entity_ref_tag")
    print("OK aiip_secret_sensitivity=rejected")
    return 0


def aiip_payload(**overrides):
    payload = {
        "tenant_id": "tenant_aiip_default",
        "external_system": "STRATOS_AIIP",
        "external_ref": "aiip:idea:idea_smoke:requirement-card",
        "entity_type": "InnovationRequest",
        "entity_id": "idea_smoke",
        "document_type": "ai_requirement_card",
        "title": "AIIP smoke requirement card",
        "classification": "internal",
        "owner": {"user_id": "svc_aiip", "display_name": "AIIP service"},
        "gestor_unit": "AI Innovation Portal",
        "tags": [
            "aiip",
            "aiip-idea:idea_smoke",
            "aiip-stage:NOVY_PODNET",
            "aiip-document-type:requirement_card",
        ],
        "metadata": {
            "aiip": {
                "idea_id": "idea_smoke",
                "source_document_id": "srcdoc_smoke",
                "schema_version": "AIIP-DOCX-1.0",
                "document_type": "requirement_card",
                "lifecycle_stage": "NOVY_PODNET",
                "input_data_sensitivity": "Interni",
                "output_data_sensitivity": "Interni",
            }
        },
        "source_location": {
            "kind": "uploaded_file",
            "file_name": "aiip_requirement_card_smoke.docx",
            "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "sha256": "e" * 64,
            "repository": "AIIP",
            "path": "/ideas/idea_smoke/documents/srcdoc_smoke",
            "version": "1",
        },
        "preview_url": "https://ip.zeleznalady.cz/ideas/idea_smoke",
    }
    payload.update(overrides)
    return payload


def verify_aiip_external_document_flow(client, headers: dict[str, str]) -> None:
    first = client.post("/api/v1/external-documents/upsert", headers=headers, json=aiip_payload())
    if first.status_code != 200:
        raise RuntimeError(f"AIIP first upsert failed: {first.status_code} {first.text}")
    first_body = first.json()
    if first_body["created"] is not True:
        raise RuntimeError(f"AIIP first upsert did not create a document: {first_body}")

    second = client.post("/api/v1/external-documents/upsert", headers=headers, json=aiip_payload())
    if second.status_code != 200:
        raise RuntimeError(f"AIIP second upsert failed: {second.status_code} {second.text}")
    second_body = second.json()
    if second_body["created"] is not False:
        raise RuntimeError(f"AIIP second upsert was not idempotent: {second_body}")
    if second_body["external_document"]["external_document_id"] != first_body["external_document"]["external_document_id"]:
        raise RuntimeError("AIIP idempotent upsert returned a different external_document_id")

    listing = client.get(
        "/api/v1/documents"
        "?tenant_id=tenant_aiip_default"
        "&external_system=STRATOS_AIIP"
        "&entity_type=InnovationRequest"
        "&entity_id=idea_smoke"
        "&external_ref=aiip%3Aidea%3Aidea_smoke%3Arequirement-card"
        "&context_tag=aiip-idea%3Aidea_smoke",
        headers=headers,
    )
    if listing.status_code != 200:
        raise RuntimeError(f"AIIP filtered listing failed: {listing.status_code} {listing.text}")
    items = listing.json()["items"]
    if len(items) != 1 or items[0]["document_type"] != "ai_requirement_card":
        raise RuntimeError(f"AIIP filtered listing returned unexpected items: {items}")


def verify_aiip_secret_sensitivity_rejected(client, headers: dict[str, str]) -> None:
    response = client.post(
        "/api/v1/external-documents/upsert",
        headers=headers,
        json=aiip_payload(
            external_ref="aiip:idea:idea_smoke:data-security-appendix",
            document_type="ai_security_appendix",
            metadata={
                "aiip": {
                    "idea_id": "idea_smoke",
                    "document_type": "data_security_appendix",
                    "input_data_sensitivity": "Tajné",
                }
            },
        ),
    )
    if response.status_code != 422:
        raise RuntimeError(f"AIIP secret sensitivity should be rejected, got {response.status_code}: {response.text}")


if __name__ == "__main__":
    raise SystemExit(main())
