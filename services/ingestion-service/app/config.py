from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

KNOWN_AUTH_MODES = {"disabled", "bearer", "mock", "oidc"}
KNOWN_REGISTRY_MODES = {"http", "mock"}
KNOWN_OBJECT_STORAGE_MODES = {"local", "http", "mock"}
KNOWN_EMBEDDING_MODES = {"http", "mock"}
KNOWN_INDEXER_MODES = {"qdrant", "mock"}
KNOWN_OCR_PROVIDERS = {"disabled", "sidecar", "tesseract"}


class ConfigError(ValueError):
    """Raised when environment configuration is invalid."""


def _get(env: Mapping[str, str], key: str, default: str) -> str:
    value = env.get(key)
    if value is None or value == "":
        return default
    return value


def _parse_bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _parse_csv(value: str) -> tuple[str, ...]:
    return tuple(item.strip() for item in value.split(",") if item.strip())


def _parse_json_object(value: str, variable_name: str) -> dict[str, str]:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise ConfigError(f"{variable_name} must be a JSON object") from exc
    if not isinstance(parsed, dict):
        raise ConfigError(f"{variable_name} must be a JSON object")

    result: dict[str, str] = {}
    for key, item in parsed.items():
        if not isinstance(key, str) or not isinstance(item, str):
            raise ConfigError(f"{variable_name} keys and values must be strings")
        result[key] = item
    return result


@dataclass(frozen=True)
class Settings:
    service_name: str
    service_version: str
    env: str
    log_level: str

    auth_mode: str
    service_token: str | None
    service_account_subject: str
    service_account_roles: tuple[str, ...]
    service_account_token: str | None

    registry_client_mode: str
    registry_base_url: str
    registry_mock_allow: bool
    registry_mock_classification: str
    registry_mock_access_scope: tuple[str, ...]

    object_storage_mode: str
    object_storage_root: Path
    max_file_bytes: int

    ocr_provider: str
    ocr_language: str
    tesseract_command: str
    min_extracted_chars_before_ocr: int

    default_parser_profile: str
    default_chunking_strategy: str
    chunk_target_chars: int
    chunk_overlap_chars: int
    max_chunk_chars: int
    max_chunks_per_job: int

    embedding_client_mode: str
    llm_gateway_base_url: str
    llm_gateway_token: str | None
    default_embedding_model: str
    embedding_profile_model_map: dict[str, str]
    embedding_batch_size: int
    mock_embedding_dimensions: int

    indexer_mode: str
    qdrant_base_url: str
    qdrant_api_key: str | None
    qdrant_collection: str
    qdrant_distance: str
    qdrant_delete_existing_version: bool

    job_store_path: Path
    process_jobs_inline: bool
    request_timeout_seconds: float


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    source = os.environ if env is None else env

    env_name = _get(source, "AKL_ENV", "development").strip().lower()
    auth_mode = _get(source, "AKL_AUTH_MODE", "disabled").strip().lower()
    registry_mode = _get(source, "AKL_INGESTION_REGISTRY_CLIENT_MODE", "mock").strip().lower()
    object_storage_mode = _get(source, "AKL_INGESTION_OBJECT_STORAGE_MODE", "local").strip().lower()
    embedding_mode = _get(source, "AKL_INGESTION_EMBEDDING_CLIENT_MODE", "mock").strip().lower()
    indexer_mode = _get(source, "AKL_INGESTION_INDEXER_MODE", "mock").strip().lower()
    ocr_provider = _get(source, "AKL_INGESTION_OCR_PROVIDER", "sidecar").strip().lower()

    if auth_mode not in KNOWN_AUTH_MODES:
        raise ConfigError("AKL_AUTH_MODE must be one of: disabled, bearer, mock, oidc")
    if registry_mode not in KNOWN_REGISTRY_MODES:
        raise ConfigError("AKL_INGESTION_REGISTRY_CLIENT_MODE must be one of: http, mock")
    if object_storage_mode not in KNOWN_OBJECT_STORAGE_MODES:
        raise ConfigError("AKL_INGESTION_OBJECT_STORAGE_MODE must be one of: local, http, mock")
    if embedding_mode not in KNOWN_EMBEDDING_MODES:
        raise ConfigError("AKL_INGESTION_EMBEDDING_CLIENT_MODE must be one of: http, mock")
    if indexer_mode not in KNOWN_INDEXER_MODES:
        raise ConfigError("AKL_INGESTION_INDEXER_MODE must be one of: qdrant, mock")
    if ocr_provider not in KNOWN_OCR_PROVIDERS:
        raise ConfigError("AKL_INGESTION_OCR_PROVIDER must be one of: disabled, sidecar, tesseract")

    try:
        max_file_bytes = int(_get(source, "AKL_INGESTION_MAX_FILE_BYTES", str(50 * 1024 * 1024)))
        min_extracted_chars_before_ocr = int(_get(source, "AKL_INGESTION_MIN_EXTRACTED_CHARS_BEFORE_OCR", "20"))
        chunk_target_chars = int(_get(source, "AKL_INGESTION_CHUNK_TARGET_CHARS", "1400"))
        chunk_overlap_chars = int(_get(source, "AKL_INGESTION_CHUNK_OVERLAP_CHARS", "160"))
        max_chunk_chars = int(_get(source, "AKL_INGESTION_MAX_CHUNK_CHARS", "3000"))
        max_chunks_per_job = int(_get(source, "AKL_INGESTION_MAX_CHUNKS_PER_JOB", "5000"))
        embedding_batch_size = int(_get(source, "AKL_INGESTION_EMBEDDING_BATCH_SIZE", "32"))
        mock_embedding_dimensions = int(_get(source, "AKL_MOCK_EMBEDDING_DIMENSIONS", "8"))
        request_timeout_seconds = float(_get(source, "AKL_INGESTION_REQUEST_TIMEOUT_SECONDS", "30"))
    except ValueError as exc:
        raise ConfigError("Numeric AKL_INGESTION_* configuration value is invalid") from exc

    if max_file_bytes <= 0:
        raise ConfigError("AKL_INGESTION_MAX_FILE_BYTES must be greater than zero")
    if min_extracted_chars_before_ocr < 0:
        raise ConfigError("AKL_INGESTION_MIN_EXTRACTED_CHARS_BEFORE_OCR must be zero or greater")
    if chunk_target_chars <= 0:
        raise ConfigError("AKL_INGESTION_CHUNK_TARGET_CHARS must be greater than zero")
    if chunk_overlap_chars < 0:
        raise ConfigError("AKL_INGESTION_CHUNK_OVERLAP_CHARS must be zero or greater")
    if max_chunk_chars < chunk_target_chars:
        raise ConfigError("AKL_INGESTION_MAX_CHUNK_CHARS must be greater than or equal to target chars")
    if chunk_overlap_chars >= chunk_target_chars:
        raise ConfigError("AKL_INGESTION_CHUNK_OVERLAP_CHARS must be lower than target chars")
    if max_chunks_per_job <= 0:
        raise ConfigError("AKL_INGESTION_MAX_CHUNKS_PER_JOB must be greater than zero")
    if embedding_batch_size <= 0:
        raise ConfigError("AKL_INGESTION_EMBEDDING_BATCH_SIZE must be greater than zero")
    if mock_embedding_dimensions <= 0:
        raise ConfigError("AKL_MOCK_EMBEDDING_DIMENSIONS must be greater than zero")
    if request_timeout_seconds <= 0:
        raise ConfigError("AKL_INGESTION_REQUEST_TIMEOUT_SECONDS must be greater than zero")

    service_token = source.get("AKL_SERVICE_TOKEN") or None
    service_account_token = source.get("AKL_SERVICE_ACCOUNT_TOKEN") or service_token

    if env_name == "production":
        if auth_mode not in {"bearer", "oidc"}:
            raise ConfigError("Production requires AKL_AUTH_MODE=bearer or oidc")
        if auth_mode == "bearer" and not service_token:
            raise ConfigError("Production requires AKL_SERVICE_TOKEN")
        if registry_mode == "mock":
            raise ConfigError("Production must not use mock Registry API client")
        if object_storage_mode == "mock":
            raise ConfigError("Production must not use mock object storage")
        if embedding_mode == "mock":
            raise ConfigError("Production must not use mock embedding client")
        if indexer_mode == "mock":
            raise ConfigError("Production must not use mock indexer")

    return Settings(
        service_name=_get(source, "AKL_SERVICE_NAME", "ingestion-service"),
        service_version=_get(source, "AKL_SERVICE_VERSION", "dev"),
        env=env_name,
        log_level=_get(source, "AKL_LOG_LEVEL", "INFO").upper(),
        auth_mode=auth_mode,
        service_token=service_token,
        service_account_subject=_get(source, "AKL_SERVICE_ACCOUNT_SUBJECT", "svc-ingestion"),
        service_account_roles=_parse_csv(
            _get(source, "AKL_SERVICE_ACCOUNT_ROLES", "service_ingestion,document_manager")
        ),
        service_account_token=service_account_token,
        registry_client_mode=registry_mode,
        registry_base_url=_get(source, "AKL_REGISTRY_API_BASE_URL", "http://localhost:8000").rstrip("/"),
        registry_mock_allow=_parse_bool(_get(source, "AKL_INGESTION_REGISTRY_MOCK_ALLOW", "true")),
        registry_mock_classification=_get(
            source,
            "AKL_INGESTION_REGISTRY_MOCK_CLASSIFICATION",
            "internal",
        ),
        registry_mock_access_scope=_parse_csv(
            _get(source, "AKL_INGESTION_REGISTRY_MOCK_ACCESS_SCOPE", "role:reader")
        ),
        object_storage_mode=object_storage_mode,
        object_storage_root=Path(_get(source, "AKL_OBJECT_STORAGE_ROOT", "./object-storage")),
        max_file_bytes=max_file_bytes,
        ocr_provider=ocr_provider,
        ocr_language=_get(source, "AKL_INGESTION_OCR_LANGUAGE", "ces+eng"),
        tesseract_command=_get(source, "AKL_INGESTION_TESSERACT_COMMAND", "tesseract"),
        min_extracted_chars_before_ocr=min_extracted_chars_before_ocr,
        default_parser_profile=_get(source, "AKL_INGESTION_DEFAULT_PARSER_PROFILE", "controlled_document"),
        default_chunking_strategy=_get(source, "AKL_INGESTION_DEFAULT_CHUNKING_STRATEGY", "legal_structured"),
        chunk_target_chars=chunk_target_chars,
        chunk_overlap_chars=chunk_overlap_chars,
        max_chunk_chars=max_chunk_chars,
        max_chunks_per_job=max_chunks_per_job,
        embedding_client_mode=embedding_mode,
        llm_gateway_base_url=_get(source, "AKL_LLM_GATEWAY_BASE_URL", "http://localhost:8080").rstrip("/"),
        llm_gateway_token=source.get("AKL_LLM_GATEWAY_TOKEN") or service_account_token,
        default_embedding_model=_get(source, "AKL_INGESTION_DEFAULT_EMBEDDING_MODEL", "mock-embedding"),
        embedding_profile_model_map=_parse_json_object(
            _get(source, "AKL_INGESTION_EMBEDDING_PROFILE_MODEL_MAP", "{}"),
            "AKL_INGESTION_EMBEDDING_PROFILE_MODEL_MAP",
        ),
        embedding_batch_size=embedding_batch_size,
        mock_embedding_dimensions=mock_embedding_dimensions,
        indexer_mode=indexer_mode,
        qdrant_base_url=_get(source, "AKL_QDRANT_BASE_URL", "http://localhost:6333").rstrip("/"),
        qdrant_api_key=source.get("AKL_QDRANT_API_KEY") or None,
        qdrant_collection=_get(source, "AKL_QDRANT_COLLECTION", "akl_document_chunks"),
        qdrant_distance=_get(source, "AKL_QDRANT_DISTANCE", "Cosine"),
        qdrant_delete_existing_version=_parse_bool(
            _get(source, "AKL_QDRANT_DELETE_EXISTING_VERSION", "true")
        ),
        job_store_path=Path(_get(source, "AKL_INGESTION_JOB_STORE_PATH", "./ingestion-jobs")),
        process_jobs_inline=_parse_bool(_get(source, "AKL_INGESTION_PROCESS_JOBS_INLINE", "true")),
        request_timeout_seconds=request_timeout_seconds,
    )
