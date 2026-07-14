import os
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("AKL_ENV", "test")
os.environ.setdefault("AKL_AUTH_MODE", "mock")
os.environ.setdefault("AKL_MOCK_ROLES", '["admin"]')
os.environ.setdefault(
    "AKL_TRUSTED_SERVICE_CLIENT_IDS",
    "aiip-service,akb-rag-service,svc-ingestion,svc-governance,svc-evaluation",
)
os.environ.setdefault(
    "AKL_SERVICE_CLIENT_ROUTE_GRANTS",
    "aiip-service=aiip-upload,"
    "akb-rag-service=authz|audit|idempotency,"
    "svc-ingestion=authz|audit|documents-read|ingestion-status,"
    "svc-governance=authz|audit|workflow-read|workflow-write,"
    "svc-evaluation=audit|idempotency",
)
os.environ.setdefault(
    "AKL_SERVICE_CLIENT_DELEGATIONS",
    "akb-rag-service=aiip-service",
)

from app.database import Base, get_db  # noqa: E402
import app.models  # noqa: F401,E402
from app.main import create_app  # noqa: E402


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine)

    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client(db_session: Session) -> Generator[TestClient, None, None]:
    app = create_app()

    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def admin_headers() -> dict[str, str]:
    return {
        "X-AKL-Subject": "user_admin",
        "X-AKL-Roles": "admin",
        "X-Request-ID": "req-test",
        "X-Correlation-ID": "corr-test",
    }


@pytest.fixture
def reader_headers() -> dict[str, str]:
    return {
        "X-AKL-Subject": "user_reader",
        "X-AKL-Roles": "reader",
    }
