from __future__ import annotations

import json
import os
import ipaddress
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping
from urllib.parse import urlparse

KNOWN_AUTH_MODES = {"disabled", "bearer", "mock", "oidc"}
KNOWN_REGISTRY_MODES = {"http", "mock"}
KNOWN_OBJECT_STORAGE_MODES = {"local", "http", "mock"}
KNOWN_EMBEDDING_MODES = {"http", "mock"}
KNOWN_INDEXER_TARGETS = {"qdrant", "opensearch", "mock"}
KNOWN_OCR_PROVIDERS = {"disabled", "sidecar", "tesseract", "ocrmypdf"}
KNOWN_PDF_ENGINES = {"auto", "pymupdf", "pypdf"}
RAG_V2_MODES = {"off", "shadow", "enforce"}


class ConfigError(ValueError):
    """Raised when environment configuration is invalid."""


def _get(env: Mapping[str, str], key: str, default: str) -> str:
    value = env.get(key)
    if value is None or value == "":
        return default
    return value


def _is_internal_url(value: str) -> bool:
    hostname = urlparse(value).hostname
    if not hostname:
        return False
    if hostname in {"localhost", "host.docker.internal"} or "." not in hostname:
        return True
    if hostname.endswith((".home.cz", ".internal", ".local")):
        return True
    try:
        return ipaddress.ip_address(hostname).is_private
    except ValueError:
        return False


def _parse_bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _parse_csv(value: str) -> tuple[str, ...]:
    return tuple(item.strip() for item in value.split(",") if item.strip())


def _parse_indexer_targets(value: str) -> tuple[str, ...]:
    targets = tuple(dict.fromkeys(item.strip().lower() for item in value.split(",") if item.strip()))
    if not targets:
        raise ConfigError("AKL_INGESTION_INDEXER_MODE must not be empty")
    unknown = sorted(set(targets) - KNOWN_INDEXER_TARGETS)
    if unknown:
        raise ConfigError("AKL_INGESTION_INDEXER_MODE must contain only: qdrant, opensearch, mock")
    if "mock" in targets and len(targets) > 1:
        raise ConfigError("AKL_INGESTION_INDEXER_MODE=mock cannot be combined with other indexers")
    return targets


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


def _parse_json_int_object(value: str, variable_name: str) -> dict[str, int]:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise ConfigError(f"{variable_name} must be a JSON object") from exc
    if not isinstance(parsed, dict):
        raise ConfigError(f"{variable_name} must be a JSON object")

    result: dict[str, int] = {}
    for key, item in parsed.items():
        if not isinstance(key, str) or not isinstance(item, int):
            raise ConfigError(f"{variable_name} keys must be strings and values must be integers")
        if item <= 0:
            raise ConfigError(f"{variable_name} values must be greater than zero")
        result[key] = item
    return result


def _parse_optional_int(value: str) -> int | None:
    stripped = value.strip()
    if stripped == "":
        return None
    return int(stripped)


def _secret_value(source: Mapping[str, str], value_key: str, file_key: str) -> str | None:
    direct = source.get(value_key)
    if direct:
        return direct
    path = source.get(file_key)
    if not path:
        return None
    try:
        value = Path(path).read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise ConfigError(f"{file_key} could not be read") from exc
    return value or None


def _file_preferred_secret_value(
    source: Mapping[str, str],
    value_key: str,
    file_key: str,
) -> str | None:
    path = source.get(file_key)
    if path:
        try:
            value = Path(path).read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise ConfigError(f"{file_key} could not be read") from exc
        if not value:
            raise ConfigError(f"{file_key} must not be empty")
        return value
    return source.get(value_key) or None


def _optional_readable_file(
    source: Mapping[str, str],
    key: str,
) -> Path | None:
    raw_path = source.get(key)
    if not raw_path:
        return None
    path = Path(raw_path)
    try:
        with path.open("rb"):
            pass
    except OSError as exc:
        raise ConfigError(f"{key} could not be read") from exc
    return path


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
    oidc_issuer: str | None
    oidc_audience: str | None
    oidc_jwks_url: str | None
    web_ingestion_client_id: str
    web_ingestion_role: str

    registry_client_mode: str
    registry_base_url: str
    registry_service_token_url: str | None
    registry_service_client_id: str | None
    registry_service_client_secret: str | None
    registry_mock_allow: bool
    registry_mock_classification: str
    registry_mock_access_scope: tuple[str, ...]

    object_storage_mode: str
    object_storage_root: Path
    max_file_bytes: int

    ocr_provider: str
    ocr_language: str
    tesseract_command: str
    ocrmypdf_command: str
    ocr_timeout_seconds: float
    min_extracted_chars_before_ocr: int

    default_extraction_profile: str
    pdf_engine: str
    default_parser_profile: str
    default_chunking_strategy: str
    chunk_target_chars: int
    chunk_overlap_chars: int
    max_chunk_chars: int
    max_chunks_per_job: int

    embedding_client_mode: str
    llm_gateway_base_url: str
    llm_gateway_token: str | None
    llm_gateway_audience: str
    default_embedding_model: str
    default_embedding_dimensions: int | None
    embedding_profile_model_map: dict[str, str]
    embedding_profile_dimensions_map: dict[str, int]
    embedding_batch_size: int
    embedding_concurrency: int
    mock_embedding_dimensions: int

    indexer_mode: str
    indexer_targets: tuple[str, ...]
    qdrant_base_url: str
    qdrant_api_key: str | None
    qdrant_collection: str
    qdrant_vector_size: int
    qdrant_distance: str
    qdrant_delete_existing_version: bool
    rag_v2_mode: str
    qdrant_v2_collection: str
    qdrant_colbert_vector_size: int
    colbert_index_mode: str
    colbert_base_url: str
    colbert_model: str
    colbert_token: str | None
    colbert_timeout_seconds: float
    colbert_batch_size: int
    opensearch_base_url: str
    opensearch_index: str
    opensearch_username: str | None
    opensearch_password: str | None
    opensearch_password_file: Path | None
    opensearch_ca_file: Path | None
    opensearch_auto_create_index: bool
    opensearch_delete_existing_version: bool

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
    indexer_targets = _parse_indexer_targets(indexer_mode)
    ocr_provider = _get(source, "AKL_INGESTION_OCR_PROVIDER", "sidecar").strip().lower()
    pdf_engine = _get(source, "AKL_INGESTION_PDF_ENGINE", "auto").strip().lower()

    if auth_mode not in KNOWN_AUTH_MODES:
        raise ConfigError("AKL_AUTH_MODE must be one of: disabled, bearer, mock, oidc")
    if registry_mode not in KNOWN_REGISTRY_MODES:
        raise ConfigError("AKL_INGESTION_REGISTRY_CLIENT_MODE must be one of: http, mock")
    if object_storage_mode not in KNOWN_OBJECT_STORAGE_MODES:
        raise ConfigError("AKL_INGESTION_OBJECT_STORAGE_MODE must be one of: local, http, mock")
    if embedding_mode not in KNOWN_EMBEDDING_MODES:
        raise ConfigError("AKL_INGESTION_EMBEDDING_CLIENT_MODE must be one of: http, mock")
    if ocr_provider not in KNOWN_OCR_PROVIDERS:
        raise ConfigError("AKL_INGESTION_OCR_PROVIDER must be one of: disabled, sidecar, tesseract, ocrmypdf")
    if pdf_engine not in KNOWN_PDF_ENGINES:
        raise ConfigError("AKL_INGESTION_PDF_ENGINE must be one of: auto, pymupdf, pypdf")

    try:
        max_file_bytes = int(_get(source, "AKL_INGESTION_MAX_FILE_BYTES", str(128 * 1024 * 1024)))
        min_extracted_chars_before_ocr = int(_get(source, "AKL_INGESTION_MIN_EXTRACTED_CHARS_BEFORE_OCR", "20"))
        chunk_target_chars = int(_get(source, "AKL_INGESTION_CHUNK_TARGET_CHARS", "1400"))
        chunk_overlap_chars = int(_get(source, "AKL_INGESTION_CHUNK_OVERLAP_CHARS", "160"))
        max_chunk_chars = int(_get(source, "AKL_INGESTION_MAX_CHUNK_CHARS", "3000"))
        max_chunks_per_job = int(_get(source, "AKL_INGESTION_MAX_CHUNKS_PER_JOB", "5000"))
        embedding_batch_size = int(_get(source, "AKL_INGESTION_EMBEDDING_BATCH_SIZE", "32"))
        embedding_concurrency = int(_get(source, "AKL_INGESTION_EMBEDDING_CONCURRENCY", "2"))
        mock_embedding_dimensions = int(_get(source, "AKL_MOCK_EMBEDDING_DIMENSIONS", "8"))
        default_embedding_dimensions = _parse_optional_int(
            _get(source, "AKL_INGESTION_DEFAULT_EMBEDDING_DIMENSIONS", "")
        )
        qdrant_vector_size = int(_get(source, "AKL_QDRANT_VECTOR_SIZE", "1024"))
        qdrant_colbert_vector_size = int(_get(source, "AKL_QDRANT_COLBERT_VECTOR_SIZE", "128"))
        colbert_timeout_seconds = float(_get(source, "AKL_RAG_COLBERT_TIMEOUT_SECONDS", "30"))
        colbert_batch_size = int(_get(source, "AKL_RAG_COLBERT_BATCH_SIZE", "8"))
        request_timeout_seconds = float(_get(source, "AKL_INGESTION_REQUEST_TIMEOUT_SECONDS", "30"))
        ocr_timeout_seconds = float(_get(source, "AKL_INGESTION_OCR_TIMEOUT_SECONDS", "300"))
    except ValueError as exc:
        raise ConfigError("Numeric AKL_INGESTION_* or AKL_QDRANT_* configuration value is invalid") from exc

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
    if embedding_concurrency <= 0 or embedding_concurrency > 16:
        raise ConfigError("AKL_INGESTION_EMBEDDING_CONCURRENCY must be between 1 and 16")
    if mock_embedding_dimensions <= 0:
        raise ConfigError("AKL_MOCK_EMBEDDING_DIMENSIONS must be greater than zero")
    if default_embedding_dimensions is not None and default_embedding_dimensions <= 0:
        raise ConfigError("AKL_INGESTION_DEFAULT_EMBEDDING_DIMENSIONS must be greater than zero")
    if qdrant_vector_size <= 0:
        raise ConfigError("AKL_QDRANT_VECTOR_SIZE must be greater than zero")
    if qdrant_colbert_vector_size <= 0:
        raise ConfigError("AKL_QDRANT_COLBERT_VECTOR_SIZE must be greater than zero")
    if colbert_timeout_seconds <= 0:
        raise ConfigError("AKL_RAG_COLBERT_TIMEOUT_SECONDS must be greater than zero")
    if colbert_batch_size <= 0 or colbert_batch_size > 64:
        raise ConfigError("AKL_RAG_COLBERT_BATCH_SIZE must be between 1 and 64")
    if request_timeout_seconds <= 0:
        raise ConfigError("AKL_INGESTION_REQUEST_TIMEOUT_SECONDS must be greater than zero")
    if ocr_timeout_seconds <= 0:
        raise ConfigError("AKL_INGESTION_OCR_TIMEOUT_SECONDS must be greater than zero")

    service_token = source.get("AKL_SERVICE_TOKEN") or None
    rag_v2_mode = _get(source, "AKL_RAG_V2_INDEX_MODE", "off").strip().lower()
    if rag_v2_mode not in RAG_V2_MODES:
        raise ConfigError("AKL_RAG_V2_INDEX_MODE must be one of: off, shadow, enforce")
    colbert_index_mode = _get(source, "AKL_RAG_COLBERT_INDEX_MODE", "off").strip().lower()
    if colbert_index_mode not in RAG_V2_MODES:
        raise ConfigError("AKL_RAG_COLBERT_INDEX_MODE must be one of: off, shadow, enforce")
    colbert_base_url = _get(source, "AKL_RAG_COLBERT_BASE_URL", "").rstrip("/")
    if colbert_index_mode != "off" and not colbert_base_url:
        raise ConfigError("AKL_RAG_COLBERT_BASE_URL is required when ColBERT indexing is enabled")
    if colbert_index_mode != "off" and not _is_internal_url(colbert_base_url):
        raise ConfigError("AKL_RAG_COLBERT_BASE_URL must be an internal endpoint")
    if colbert_index_mode != "off" and rag_v2_mode == "off":
        raise ConfigError("AKL_RAG_COLBERT_INDEX_MODE requires AKL_RAG_V2_INDEX_MODE")
    service_account_subject = _get(source, "AKL_SERVICE_ACCOUNT_SUBJECT", "svc-ingestion")
    web_ingestion_client_id = _get(
        source,
        "AKL_INGESTION_WEB_CLIENT_ID",
        "svc-akb-web-ingestion",
    )
    web_ingestion_role = _get(
        source,
        "AKL_INGESTION_WEB_ROLE",
        "service_akb_web_ingestion",
    )
    service_account_token = source.get("AKL_SERVICE_ACCOUNT_TOKEN") or service_token
    registry_service_token_url = source.get("AKL_REGISTRY_SERVICE_TOKEN_URL") or None
    registry_service_client_id = source.get("AKL_REGISTRY_SERVICE_CLIENT_ID") or None
    registry_service_client_secret = _secret_value(
        source,
        "AKL_REGISTRY_SERVICE_CLIENT_SECRET",
        "AKL_REGISTRY_SERVICE_CLIENT_SECRET_FILE",
    )
    registry_service_credentials = (
        registry_service_token_url,
        registry_service_client_id,
        registry_service_client_secret,
    )
    opensearch_base_url = _get(
        source,
        "AKL_OPENSEARCH_BASE_URL",
        "http://localhost:9200",
    ).rstrip("/")
    opensearch_username = source.get("AKL_OPENSEARCH_USERNAME") or None
    opensearch_password_file = _optional_readable_file(
        source,
        "AKL_OPENSEARCH_PASSWORD_FILE",
    )
    opensearch_password = _file_preferred_secret_value(
        source,
        "AKL_OPENSEARCH_PASSWORD",
        "AKL_OPENSEARCH_PASSWORD_FILE",
    )
    opensearch_ca_file = _optional_readable_file(
        source,
        "AKL_OPENSEARCH_CA_FILE",
    )
    opensearch_auto_create_index = _parse_bool(
        _get(source, "AKL_OPENSEARCH_AUTO_CREATE_INDEX", "true")
    )
    if any(registry_service_credentials) and not all(registry_service_credentials):
        raise ConfigError(
            "Registry service identity requires AKL_REGISTRY_SERVICE_TOKEN_URL, "
            "AKL_REGISTRY_SERVICE_CLIENT_ID, and AKL_REGISTRY_SERVICE_CLIENT_SECRET or "
            "AKL_REGISTRY_SERVICE_CLIENT_SECRET_FILE"
        )
    if (
        registry_mode == "http"
        and auth_mode in {"bearer", "oidc"}
        and not all(registry_service_credentials)
    ):
        raise ConfigError(
            "Authenticated HTTP Registry transport requires a dedicated Registry service identity"
        )
    if registry_service_client_id == "aiip-service":
        raise ConfigError(
            "AKL_REGISTRY_SERVICE_CLIENT_ID must identify ingestion-service, not aiip-service"
        )

    if env_name == "production":
        if auth_mode != "oidc":
            raise ConfigError("Production requires AKL_AUTH_MODE=oidc")
        if registry_mode == "mock":
            raise ConfigError("Production must not use mock Registry API client")
        if not all(registry_service_credentials):
            raise ConfigError("Production requires a dedicated Registry service identity")
        if registry_service_token_url is None or not registry_service_token_url.startswith(
            "https://"
        ):
            raise ConfigError("Production Registry service token URL must use HTTPS")
        if registry_service_client_id != "svc-ingestion":
            raise ConfigError(
                "Production AKL_REGISTRY_SERVICE_CLIENT_ID must be svc-ingestion"
            )
        if registry_service_client_id != service_account_subject:
            raise ConfigError(
                "Production AKL_REGISTRY_SERVICE_CLIENT_ID must match "
                "AKL_SERVICE_ACCOUNT_SUBJECT"
            )
        if auth_mode == "oidc" and not all(
            source.get(name)
            for name in ("AKL_OIDC_ISSUER", "AKL_OIDC_AUDIENCE", "AKL_OIDC_JWKS_URL")
        ):
            raise ConfigError("Production OIDC requires issuer, audience, and JWKS URL")
        if web_ingestion_client_id != "svc-akb-web-ingestion":
            raise ConfigError(
                "Production AKL_INGESTION_WEB_CLIENT_ID must be svc-akb-web-ingestion"
            )
        if web_ingestion_role != "service_akb_web_ingestion":
            raise ConfigError(
                "Production AKL_INGESTION_WEB_ROLE must be service_akb_web_ingestion"
            )
        if object_storage_mode == "mock":
            raise ConfigError("Production must not use mock object storage")
        if embedding_mode == "mock":
            raise ConfigError("Production must not use mock embedding client")
        if "mock" in indexer_targets:
            raise ConfigError("Production must not use mock indexer")
        if "opensearch" in indexer_targets:
            if not opensearch_base_url.startswith("https://"):
                raise ConfigError("Production OpenSearch must use HTTPS")
            if not opensearch_username or not opensearch_password:
                raise ConfigError("Production OpenSearch requires Basic Auth credentials")
            if opensearch_password_file is None:
                raise ConfigError(
                    "Production OpenSearch requires AKL_OPENSEARCH_PASSWORD_FILE"
                )
            if opensearch_ca_file is None:
                raise ConfigError("Production OpenSearch requires AKL_OPENSEARCH_CA_FILE")
            if opensearch_auto_create_index:
                raise ConfigError(
                    "Production OpenSearch requires AKL_OPENSEARCH_AUTO_CREATE_INDEX=false"
                )
        if not _parse_bool(_get(source, "AKL_INGESTION_PROCESS_JOBS_INLINE", "true")):
            raise ConfigError(
                "Production requires AKL_INGESTION_PROCESS_JOBS_INLINE=true until a durable worker is deployed"
            )

    return Settings(
        service_name=_get(source, "AKL_SERVICE_NAME", "ingestion-service"),
        service_version=_get(source, "AKL_SERVICE_VERSION", "dev"),
        env=env_name,
        log_level=_get(source, "AKL_LOG_LEVEL", "INFO").upper(),
        auth_mode=auth_mode,
        service_token=service_token,
        service_account_subject=service_account_subject,
        service_account_roles=_parse_csv(
            _get(source, "AKL_SERVICE_ACCOUNT_ROLES", "service_ingestion,document_manager")
        ),
        service_account_token=service_account_token,
        oidc_issuer=source.get("AKL_OIDC_ISSUER") or None,
        oidc_audience=source.get("AKL_OIDC_AUDIENCE") or None,
        oidc_jwks_url=source.get("AKL_OIDC_JWKS_URL") or None,
        web_ingestion_client_id=web_ingestion_client_id,
        web_ingestion_role=web_ingestion_role,
        registry_client_mode=registry_mode,
        registry_base_url=_get(source, "AKL_REGISTRY_API_BASE_URL", "http://localhost:8000").rstrip("/"),
        registry_service_token_url=registry_service_token_url,
        registry_service_client_id=registry_service_client_id,
        registry_service_client_secret=registry_service_client_secret,
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
        ocrmypdf_command=_get(source, "AKL_INGESTION_OCRMYPDF_COMMAND", "ocrmypdf"),
        ocr_timeout_seconds=ocr_timeout_seconds,
        min_extracted_chars_before_ocr=min_extracted_chars_before_ocr,
        default_extraction_profile=_get(source, "AKL_INGESTION_DEFAULT_EXTRACTION_PROFILE", "document_text_v1"),
        pdf_engine=pdf_engine,
        default_parser_profile=_get(source, "AKL_INGESTION_DEFAULT_PARSER_PROFILE", "controlled_document"),
        default_chunking_strategy=_get(source, "AKL_INGESTION_DEFAULT_CHUNKING_STRATEGY", "legal_structured"),
        chunk_target_chars=chunk_target_chars,
        chunk_overlap_chars=chunk_overlap_chars,
        max_chunk_chars=max_chunk_chars,
        max_chunks_per_job=max_chunks_per_job,
        embedding_client_mode=embedding_mode,
        llm_gateway_base_url=_get(source, "AKL_LLM_GATEWAY_BASE_URL", "http://localhost:8080").rstrip("/"),
        llm_gateway_token=source.get("AKL_LLM_GATEWAY_TOKEN") or service_account_token,
        llm_gateway_audience=_get(source, "AKL_LLM_GATEWAY_AUDIENCE", "llm-gateway-service"),
        default_embedding_model=_get(source, "AKL_INGESTION_DEFAULT_EMBEDDING_MODEL", "mock-embedding"),
        default_embedding_dimensions=default_embedding_dimensions,
        embedding_profile_model_map=_parse_json_object(
            _get(source, "AKL_INGESTION_EMBEDDING_PROFILE_MODEL_MAP", "{}"),
            "AKL_INGESTION_EMBEDDING_PROFILE_MODEL_MAP",
        ),
        embedding_profile_dimensions_map=_parse_json_int_object(
            _get(source, "AKL_INGESTION_EMBEDDING_PROFILE_DIMENSIONS_MAP", "{}"),
            "AKL_INGESTION_EMBEDDING_PROFILE_DIMENSIONS_MAP",
        ),
        embedding_batch_size=embedding_batch_size,
        embedding_concurrency=embedding_concurrency,
        mock_embedding_dimensions=mock_embedding_dimensions,
        indexer_mode=indexer_mode,
        indexer_targets=indexer_targets,
        qdrant_base_url=_get(source, "AKL_QDRANT_BASE_URL", "http://localhost:6333").rstrip("/"),
        qdrant_api_key=source.get("AKL_QDRANT_API_KEY") or None,
        qdrant_collection=_get(source, "AKL_QDRANT_COLLECTION", "akl_document_chunks"),
        qdrant_vector_size=qdrant_vector_size,
        qdrant_distance=_get(source, "AKL_QDRANT_DISTANCE", "Cosine"),
        qdrant_delete_existing_version=_parse_bool(
            _get(source, "AKL_QDRANT_DELETE_EXISTING_VERSION", "true")
        ),
        rag_v2_mode=rag_v2_mode,
        qdrant_v2_collection=_get(source, "AKL_QDRANT_V2_COLLECTION", "document_chunks_v2"),
        qdrant_colbert_vector_size=qdrant_colbert_vector_size,
        colbert_index_mode=colbert_index_mode,
        colbert_base_url=colbert_base_url,
        colbert_model=_get(source, "AKL_RAG_COLBERT_MODEL", "colbert-multilingual-v2"),
        colbert_token=_secret_value(
            source,
            "AKL_RAG_COLBERT_TOKEN",
            "AKL_RAG_COLBERT_TOKEN_FILE",
        ),
        colbert_timeout_seconds=colbert_timeout_seconds,
        colbert_batch_size=colbert_batch_size,
        opensearch_base_url=opensearch_base_url,
        opensearch_index=_get(source, "AKL_OPENSEARCH_INDEX", "akl_document_chunks"),
        opensearch_username=opensearch_username,
        opensearch_password=opensearch_password,
        opensearch_password_file=opensearch_password_file,
        opensearch_ca_file=opensearch_ca_file,
        opensearch_auto_create_index=opensearch_auto_create_index,
        opensearch_delete_existing_version=_parse_bool(
            _get(source, "AKL_OPENSEARCH_DELETE_EXISTING_VERSION", "true")
        ),
        job_store_path=Path(_get(source, "AKL_INGESTION_JOB_STORE_PATH", "./ingestion-jobs")),
        process_jobs_inline=_parse_bool(_get(source, "AKL_INGESTION_PROCESS_JOBS_INLINE", "true")),
        request_timeout_seconds=request_timeout_seconds,
    )
