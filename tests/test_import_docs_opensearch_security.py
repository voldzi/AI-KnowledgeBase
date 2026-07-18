from __future__ import annotations

import base64

import pytest

from tools.import_docs_folder import opensearch_headers, parse_args


def test_import_verification_prefers_password_file_and_basic_auth(tmp_path) -> None:
    password_file = tmp_path / "opensearch.password"
    password_file.write_text("file-secret\n", encoding="utf-8")
    ca_file = tmp_path / "opensearch-ca.pem"
    ca_file.write_text("placeholder-ca\n", encoding="utf-8")

    options = parse_args(
        [
            "--dry-run",
            "--opensearch-url",
            "https://opensearch.example:9200",
            "--opensearch-username",
            "reader",
            "--opensearch-password-file",
            str(password_file),
            "--opensearch-ca-file",
            str(ca_file),
        ]
    )

    authorization = opensearch_headers(options)["Authorization"]
    scheme, encoded = authorization.split(" ", 1)
    assert scheme == "Basic"
    assert base64.b64decode(encoded).decode("utf-8") == "reader:file-secret"
    assert options.opensearch_ca_file == ca_file


def test_import_verification_rejects_https_without_ca(tmp_path) -> None:
    password_file = tmp_path / "opensearch.password"
    password_file.write_text("file-secret\n", encoding="utf-8")

    with pytest.raises(SystemExit):
        parse_args(
            [
                "--dry-run",
                "--opensearch-url",
                "https://opensearch.example:9200",
                "--opensearch-username",
                "reader",
                "--opensearch-password-file",
                str(password_file),
            ]
        )


def test_import_verification_rejects_missing_password_file(tmp_path) -> None:
    ca_file = tmp_path / "opensearch-ca.pem"
    ca_file.write_text("placeholder-ca\n", encoding="utf-8")

    with pytest.raises(SystemExit):
        parse_args(
            [
                "--dry-run",
                "--opensearch-url",
                "https://opensearch.example:9200",
                "--opensearch-username",
                "reader",
                "--opensearch-password-file",
                str(tmp_path / "missing.password"),
                "--opensearch-ca-file",
                str(ca_file),
            ]
        )
