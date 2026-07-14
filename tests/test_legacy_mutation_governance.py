from __future__ import annotations

import os
import subprocess
from pathlib import Path, PurePosixPath
from unittest.mock import patch

import pytest

from scripts import (
    phase_01_smoke,
    phase_02_controlled_document_smoke,
    phase_03_docs_import_smoke,
    phase_03_document_viewer_smoke,
)
from tools import import_docs_folder, import_original_pdf_versions
from tools.import_docs_folder import ImportOptions
from tools.legacy_mutation_guard import LegacyMutationBlocked, retire_legacy_mutation


ROOT = Path(__file__).resolve().parents[1]


def _import_options(tmp_path: Path, *, dry_run: bool) -> ImportOptions:
    return ImportOptions(
        source=tmp_path / "docs",
        manifest_path=tmp_path / "manifest.yaml",
        mode="skip-existing",
        limit=None,
        dry_run=dry_run,
        report_path=tmp_path / "report.json",
        registry_url="http://arbitrary.invalid",
        ingestion_url="http://arbitrary.invalid",
        qdrant_url="http://arbitrary.invalid",
        qdrant_collection="chunks",
        opensearch_url="http://arbitrary.invalid",
        opensearch_index="chunks",
        require_opensearch=False,
        ingestion_container="arbitrary-container",
        subject_id="retired-importer",
        roles="admin",
        storage_bucket="arbitrary-bucket",
        storage_prefix="arbitrary-prefix",
        timeout_seconds=10,
        okf_profile=False,
        bearer_token="unused-credential",
        information_policy=None,
        approve_for_publish=False,
    )


def _original_pdf_options(tmp_path: Path) -> import_original_pdf_versions.Options:
    return import_original_pdf_versions.Options(
        imports_root=tmp_path / "imports",
        storage_root=tmp_path / "storage",
        bucket="arbitrary-bucket",
        domains=("arbitrary-domain",),
        report_path=tmp_path / "report.json",
        apply=True,
        compose_file=tmp_path / "compose.yml",
        env_file=None,
        registry_service="arbitrary-registry",
        actor_id="retired-importer",
        roles="admin",
        ingestion_url="http://arbitrary.invalid",
        qdrant_url="http://arbitrary.invalid",
        qdrant_collection="chunks",
        timeout_seconds=10,
        keep_superseded_qdrant=False,
        storage_writer_service="arbitrary-writer",
        storage_container_root=PurePosixPath("/arbitrary/storage"),
        ingestion_bearer_token="unused-credential",
    )


@pytest.mark.parametrize(
    "environment",
    [
        {},
        {"AKL_ENV": "development", "AKL_AUTH_MODE": "disabled"},
        {"AKL_ENV": "test", "AKL_AUTH_MODE": "mock"},
        {"AKL_ENV": "production", "AKL_AUTH_MODE": "oidc"},
    ],
)
def test_retire_guard_is_unconditional(environment: dict[str, str]) -> None:
    with (
        patch.dict(os.environ, environment, clear=True),
        pytest.raises(LegacyMutationBlocked, match="LEGACY_MUTATION_RETIRED"),
    ):
        retire_legacy_mutation("retired-test")


@pytest.mark.parametrize(
    "environment",
    [
        {},
        {
            "AKL_ENV": "development",
            "AKL_AUTH_MODE": "disabled",
            "AKL_IMPORT_INGESTION_BEARER_TOKEN": "unused",
        },
        {"AKL_ENV": "production", "AKL_AUTH_MODE": "oidc"},
    ],
)
def test_original_pdf_apply_stops_before_any_read_or_mutation(
    environment: dict[str, str],
) -> None:
    with (
        patch.dict(os.environ, environment, clear=True),
        patch.object(import_original_pdf_versions, "discover_plan") as discover,
        patch.object(import_original_pdf_versions, "copy_pdf_objects") as copy_objects,
        patch.object(import_original_pdf_versions, "run_registry_migration") as migrate,
        patch.object(import_original_pdf_versions, "write_reports") as write_reports,
        patch.object(import_original_pdf_versions.subprocess, "run") as run_process,
        patch.object(import_original_pdf_versions.urllib.request, "urlopen") as urlopen,
        patch.object(Path, "read_bytes") as read_bytes,
        pytest.raises(LegacyMutationBlocked, match="LEGACY_MUTATION_RETIRED"),
    ):
        import_original_pdf_versions.main(
            [
                "--apply",
                "--imports-root",
                "/arbitrary/imports",
                "--storage-root",
                "/arbitrary/storage",
                "--compose-file",
                "/arbitrary/compose.yml",
                "--env-file",
                "/arbitrary/env",
                "--ingestion-url",
                "http://arbitrary.invalid/api/v1",
            ]
        )

    discover.assert_not_called()
    copy_objects.assert_not_called()
    migrate.assert_not_called()
    write_reports.assert_not_called()
    run_process.assert_not_called()
    urlopen.assert_not_called()
    read_bytes.assert_not_called()


def test_original_pdf_programmatic_mutators_stop_before_any_write(tmp_path: Path) -> None:
    options = _original_pdf_options(tmp_path)
    source = tmp_path / "source.pdf"
    plan = [
        {
            "status": "planned",
            "source_path": "source.pdf",
            "pdf_path": str(source),
            "object_key": "arbitrary/source.pdf",
            "sha256": "sha256:unused",
        }
    ]
    operations = [
        lambda: import_original_pdf_versions.copy_pdf_objects(plan, options),
        lambda: import_original_pdf_versions.copy_pdf_object_via_container(source, plan[0], options),
        lambda: import_original_pdf_versions.run_registry_migration(plan, options),
        lambda: import_original_pdf_versions.enrich_qdrant_results(
            {"documents": [{"status": "ingested"}]}, options
        ),
        lambda: import_original_pdf_versions.qdrant_delete(
            options.qdrant_url, options.qdrant_collection, "unused-version"
        ),
    ]

    with (
        patch.object(Path, "exists") as path_exists,
        patch.object(Path, "mkdir") as mkdir,
        patch.object(Path, "read_bytes") as read_bytes,
        patch.object(import_original_pdf_versions.shutil, "copyfile") as copyfile,
        patch.object(import_original_pdf_versions.subprocess, "run") as run_process,
        patch.object(import_original_pdf_versions, "registry_migration_code") as migration_code,
        patch.object(import_original_pdf_versions, "resolve_qdrant_url") as resolve_qdrant,
        patch.object(import_original_pdf_versions, "qdrant_request_json") as qdrant_request,
    ):
        for operation in operations:
            with pytest.raises(LegacyMutationBlocked, match="LEGACY_MUTATION_RETIRED"):
                operation()

    path_exists.assert_not_called()
    mkdir.assert_not_called()
    read_bytes.assert_not_called()
    copyfile.assert_not_called()
    run_process.assert_not_called()
    migration_code.assert_not_called()
    resolve_qdrant.assert_not_called()
    qdrant_request.assert_not_called()


def test_original_pdf_generated_migration_and_direct_non_read_http_are_retired() -> None:
    with (
        patch.object(import_original_pdf_versions.urllib.request, "urlopen") as urlopen,
        pytest.raises(LegacyMutationBlocked, match="LEGACY_MUTATION_RETIRED"),
    ):
        import_original_pdf_versions.registry_migration_code(
            plan_b64="W10=",
            actor_id="unused",
            roles="unused",
            ingestion_url="http://arbitrary.invalid",
            qdrant_url="http://arbitrary.invalid",
            qdrant_collection="unused",
            timeout_seconds=1,
            ingestion_bearer_token="unused",
        )
    urlopen.assert_not_called()

    with (
        patch.object(import_original_pdf_versions.urllib.request, "urlopen") as urlopen,
        pytest.raises(LegacyMutationBlocked, match="LEGACY_MUTATION_RETIRED"),
    ):
        import_original_pdf_versions.qdrant_request_json(
            "http://arbitrary.invalid",
            "POST",
            "/collections/unused/points/delete",
            {"filter": {}},
        )
    urlopen.assert_not_called()


def test_original_pdf_dry_run_remains_planning_only(tmp_path: Path) -> None:
    with (
        patch.object(import_original_pdf_versions, "discover_plan", return_value=[]) as discover,
        patch.object(import_original_pdf_versions, "copy_pdf_objects") as copy_objects,
        patch.object(import_original_pdf_versions, "run_registry_migration") as migrate,
        patch.object(import_original_pdf_versions, "enrich_qdrant_results") as enrich,
        patch.object(import_original_pdf_versions, "write_reports") as write_reports,
    ):
        result = import_original_pdf_versions.main(
            [
                "--imports-root",
                str(tmp_path / "imports"),
                "--storage-root",
                str(tmp_path / "storage"),
                "--report",
                str(tmp_path / "report.json"),
                "--env-file",
                "",
            ]
        )

    assert result == 0
    discover.assert_called_once()
    write_reports.assert_called_once()
    copy_objects.assert_not_called()
    migrate.assert_not_called()
    enrich.assert_not_called()


def test_docs_import_cli_stops_before_policy_file_or_any_mutator() -> None:
    environment = {
        "AKL_ENV": "development",
        "AKL_AUTH_MODE": "mock",
        "AKL_IMPORT_INFORMATION_POLICY_FILE": "/must/not/be/read.json",
        "AKL_IMPORT_BEARER_TOKEN": "must-not-be-used",
        "AKL_IMPORT_REGISTRY_URL": "http://arbitrary.invalid",
        "AKL_IMPORT_INGESTION_URL": "http://arbitrary.invalid",
    }
    with (
        patch.dict(os.environ, environment, clear=True),
        patch.object(import_docs_folder, "load_information_policy_file") as load_policy,
        patch.object(import_docs_folder, "run_import") as run_import,
        patch.object(import_docs_folder, "write_reports") as write_reports,
        patch.object(import_docs_folder, "seed_ingestion_object") as seed,
        patch.object(import_docs_folder.subprocess, "run") as run_process,
        patch.object(import_docs_folder.urllib.request, "urlopen") as urlopen,
        patch.object(Path, "read_bytes") as read_bytes,
        pytest.raises(LegacyMutationBlocked, match="LEGACY_MUTATION_RETIRED"),
    ):
        import_docs_folder.main([])

    load_policy.assert_not_called()
    run_import.assert_not_called()
    write_reports.assert_not_called()
    seed.assert_not_called()
    run_process.assert_not_called()
    urlopen.assert_not_called()
    read_bytes.assert_not_called()


def test_programmatic_docs_import_stops_before_manifest_discovery_or_http(
    tmp_path: Path,
) -> None:
    options = _import_options(tmp_path, dry_run=False)
    with (
        patch.object(import_docs_folder, "load_manifest") as load_manifest,
        patch.object(import_docs_folder, "discover_markdown_files") as discover,
        patch.object(import_docs_folder, "documents_by_source_path") as list_documents,
        patch.object(import_docs_folder, "seed_ingestion_object") as seed,
        patch.object(import_docs_folder.urllib.request, "urlopen") as urlopen,
        pytest.raises(LegacyMutationBlocked, match="LEGACY_MUTATION_RETIRED"),
    ):
        import_docs_folder.run_import(options)

    load_manifest.assert_not_called()
    discover.assert_not_called()
    list_documents.assert_not_called()
    seed.assert_not_called()
    urlopen.assert_not_called()


def test_docs_import_programmatic_mutation_helpers_stop_before_io(tmp_path: Path) -> None:
    options = _import_options(tmp_path, dry_run=False)
    path = tmp_path / "must-not-be-read.md"
    metadata = {
        "document_type": "project_documentation",
        "owner": "unused",
        "area": "unused",
        "classification": "internal",
        "tags": [],
        "status": "valid",
    }
    existing = {"document_id": "unused-document", "metadata": {}}
    version = {"document_version_id": "unused-version"}
    operations = [
        lambda: import_docs_folder.import_existing_version(path, "unused.md", existing, options),
        lambda: import_docs_folder.import_new_version(path, "unused.md", existing, options, metadata),
        lambda: import_docs_folder.import_new_document(path, "unused.md", options, metadata),
        lambda: import_docs_folder.create_document(path, "unused.md", metadata, options),
        lambda: import_docs_folder.patch_existing_document(
            "unused-document", path, "unused.md", metadata, options
        ),
        lambda: import_docs_folder.patch_document("unused-document", {}, options),
        lambda: import_docs_folder.create_version(
            "unused-document", path, "unused.md", "s3://unused/source", options
        ),
        lambda: import_docs_folder.publish_if_valid(
            "unused-document", version, metadata, options
        ),
        lambda: import_docs_folder.approve_document_for_publication(
            "unused-document", options
        ),
        lambda: import_docs_folder.run_ingestion(
            "unused-document", "unused-version", "s3://unused/source", options
        ),
        lambda: import_docs_folder.seed_ingestion_object(
            path, "s3://unused/source", options
        ),
    ]

    with (
        patch.object(Path, "read_bytes") as read_bytes,
        patch.object(Path, "read_text") as read_text,
        patch.object(import_docs_folder.subprocess, "run") as run_process,
        patch.object(import_docs_folder.urllib.request, "urlopen") as urlopen,
    ):
        for operation in operations:
            with pytest.raises(LegacyMutationBlocked, match="LEGACY_MUTATION_RETIRED"):
                operation()

    read_bytes.assert_not_called()
    read_text.assert_not_called()
    run_process.assert_not_called()
    urlopen.assert_not_called()


@pytest.mark.parametrize("method", ["POST", "post", "PATCH", "DELETE", "PUT"])
def test_docs_import_request_helper_blocks_direct_non_read_http(
    tmp_path: Path,
    method: str,
) -> None:
    options = _import_options(tmp_path, dry_run=False)
    with (
        patch.object(import_docs_folder.urllib.request, "urlopen") as urlopen,
        pytest.raises(LegacyMutationBlocked, match="LEGACY_MUTATION_RETIRED"),
    ):
        import_docs_folder.request_json(
            method,
            "http://arbitrary.invalid",
            {},
            options=options,
        )
    urlopen.assert_not_called()


def test_docs_import_dry_run_remains_planning_only(tmp_path: Path) -> None:
    options = _import_options(tmp_path, dry_run=True)
    with (
        patch.object(import_docs_folder, "load_manifest", return_value={}) as load_manifest,
        patch.object(import_docs_folder, "discover_markdown_files", return_value=[]) as discover,
        patch.object(import_docs_folder, "documents_by_source_path") as list_documents,
        patch.object(import_docs_folder, "seed_ingestion_object") as seed,
        patch.object(import_docs_folder.urllib.request, "urlopen") as urlopen,
    ):
        report = import_docs_folder.run_import(options)

    assert report["dry_run"] is True
    load_manifest.assert_called_once()
    discover.assert_called_once()
    list_documents.assert_not_called()
    seed.assert_not_called()
    urlopen.assert_not_called()


@pytest.mark.parametrize(
    "module",
    [phase_03_docs_import_smoke, phase_03_document_viewer_smoke],
)
def test_retired_phase_03_smokes_stop_before_health_policy_or_import(module) -> None:
    with (
        patch.object(module, "check_health") as check_health,
        patch.object(module, "load_information_policy_file") as load_policy,
        patch.object(module, "run_import") as run_import,
        patch.object(module, "write_reports") as write_reports,
        patch.object(module.urllib.request, "urlopen") as urlopen,
        pytest.raises(LegacyMutationBlocked, match="LEGACY_MUTATION_RETIRED"),
    ):
        module.main()

    check_health.assert_not_called()
    load_policy.assert_not_called()
    run_import.assert_not_called()
    write_reports.assert_not_called()
    urlopen.assert_not_called()


@pytest.mark.parametrize(
    "module",
    [phase_03_docs_import_smoke, phase_03_document_viewer_smoke],
)
def test_retired_phase_03_import_and_non_read_http_helpers_are_blocked(module) -> None:
    with (
        patch.object(module, "load_information_policy_file") as load_policy,
        patch.object(module, "run_import") as run_import,
        patch.object(module, "write_reports") as write_reports,
        patch.object(module.urllib.request, "urlopen") as urlopen,
        pytest.raises(LegacyMutationBlocked, match="LEGACY_MUTATION_RETIRED"),
    ):
        module.import_docs_subset()

    load_policy.assert_not_called()
    run_import.assert_not_called()
    write_reports.assert_not_called()
    urlopen.assert_not_called()

    with (
        patch.object(module.urllib.request, "urlopen") as urlopen,
        pytest.raises(LegacyMutationBlocked, match="LEGACY_MUTATION_RETIRED"),
    ):
        module.request_json("POST", "http://arbitrary.invalid", {})
    urlopen.assert_not_called()


@pytest.mark.parametrize("module", [phase_01_smoke, phase_02_controlled_document_smoke])
def test_retired_smokes_stop_before_fixture_seed_subprocess_or_http(module) -> None:
    with (
        patch.object(module, "seed_ingestion_object") as seed,
        patch.object(module, "check_health") as check_health,
        patch.object(module, "create_document") as create_document,
        patch.object(module.subprocess, "run") as run_process,
        patch.object(module.urllib.request, "urlopen") as urlopen,
        patch.object(Path, "read_text") as read_text,
        pytest.raises(LegacyMutationBlocked, match="LEGACY_MUTATION_RETIRED"),
    ):
        module.main()

    seed.assert_not_called()
    check_health.assert_not_called()
    create_document.assert_not_called()
    run_process.assert_not_called()
    urlopen.assert_not_called()
    read_text.assert_not_called()


def test_phase_01_programmatic_mutation_entrypoints_are_retired() -> None:
    operations = [
        phase_01_smoke.seed_ingestion_object,
        phase_01_smoke.create_document,
        lambda: phase_01_smoke.create_version("unused-document"),
        lambda: phase_01_smoke.run_ingestion("unused-document", "unused-version"),
        phase_01_smoke.retrieve,
        phase_01_smoke.call_llm,
        phase_01_smoke.query_rag,
        lambda: phase_01_smoke.write_audit_event("unused-document"),
    ]
    with (
        patch.object(phase_01_smoke, "request_json") as request_json,
        patch.object(phase_01_smoke.subprocess, "run") as run_process,
        patch.object(phase_01_smoke.urllib.request, "urlopen") as urlopen,
    ):
        for operation in operations:
            with pytest.raises(LegacyMutationBlocked, match="LEGACY_MUTATION_RETIRED"):
                operation()

    request_json.assert_not_called()
    run_process.assert_not_called()
    urlopen.assert_not_called()


def test_phase_02_programmatic_mutation_entrypoints_are_retired() -> None:
    operations = [
        lambda: phase_02_controlled_document_smoke.seed_ingestion_object("unused"),
        phase_02_controlled_document_smoke.create_document,
        lambda: phase_02_controlled_document_smoke.create_version("unused-document", "unused"),
        lambda: phase_02_controlled_document_smoke.publish_version("unused-document", "unused-version"),
        lambda: phase_02_controlled_document_smoke.run_ingestion("unused-document", "unused-version"),
        lambda: phase_02_controlled_document_smoke.verify_qdrant_index({}, {}, {}),
        lambda: phase_02_controlled_document_smoke.query_rag("unused-document"),
        lambda: phase_02_controlled_document_smoke.write_smoke_audit(
            "unused-document", "unused-job", "unused-query"
        ),
    ]
    with (
        patch.object(phase_02_controlled_document_smoke, "request_json") as request_json,
        patch.object(phase_02_controlled_document_smoke.subprocess, "run") as run_process,
        patch.object(phase_02_controlled_document_smoke.urllib.request, "urlopen") as urlopen,
    ):
        for operation in operations:
            with pytest.raises(LegacyMutationBlocked, match="LEGACY_MUTATION_RETIRED"):
                operation()

    request_json.assert_not_called()
    run_process.assert_not_called()
    urlopen.assert_not_called()


@pytest.mark.parametrize("module", [phase_01_smoke, phase_02_controlled_document_smoke])
def test_retired_smoke_request_helper_blocks_direct_mutation(module) -> None:
    with (
        patch.object(module.urllib.request, "urlopen") as urlopen,
        pytest.raises(LegacyMutationBlocked, match="LEGACY_MUTATION_RETIRED"),
    ):
        module.request_json("POST", "http://arbitrary.invalid")

    urlopen.assert_not_called()


@pytest.mark.parametrize(
    "script_name",
    ["import_cz_digital_governance.sh", "import_security_compliance_cz.sh"],
)
def test_retired_shell_wrappers_exit_before_keycloak_or_other_commands(
    tmp_path: Path,
    script_name: str,
) -> None:
    marker = tmp_path / "external-command-called"
    for command in ("docker", "curl", "python3"):
        stub = tmp_path / command
        stub.write_text(f"#!/bin/sh\ntouch {marker}\nexit 99\n", encoding="utf-8")
        stub.chmod(0o755)

    completed = subprocess.run(
        ["/bin/bash", str(ROOT / "scripts" / script_name)],
        env={"PATH": str(tmp_path)},
        text=True,
        capture_output=True,
        check=False,
    )

    assert completed.returncode == 1
    assert "retired in every environment" in completed.stderr
    assert not marker.exists()
