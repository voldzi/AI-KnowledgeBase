"""Permanent reference fence. Locks are database transactions, never process locks.

ORM writers acquire the entire known URI set in lexical order before flush.
Statement triggers also protect raw SQL and bulk statements. Only READ COMMITTED
is admitted: the reference query must see a writer that committed while we waited.
"""
import hashlib
import re
import sqlite3
from datetime import datetime

from sqlalchemy import DateTime, String, bindparam, event, select, text
from sqlalchemy.orm import Mapped, Session, mapped_column
from sqlalchemy.engine import Engine

from app.database import Base
from app.errors import problem


class IntakeObjectFence(Base):
    __tablename__ = "intake_object_fences"
    uri_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    source_uri: Mapped[str] = mapped_column(String(1024), nullable=False)
    claim_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    manifest_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    claimed_by: Mapped[str | None] = mapped_column(String(160), nullable=True)


# These are all content-owner references. Audit/log text and queue payloads are
# observations of a version, not an independent permission to preserve a blob.
REFERENCE_COLUMNS = {
    "document_versions": "source_file_uri",
    "document_files": "uri",
    "document_publications": "source_file_uri",
    "external_document_refs": "akb_source_uri",
    "document_profile_version_snapshots": "payload->'sourceLineage'->>'contentUri'",
}

# Clean intake emits one ASCII, unescaped s3://bucket/key representation. Source
# readers can otherwise decode %xx or collapse path segments into the same file.
CANONICAL_URI_PATTERN = r"^s3://[a-z0-9][a-z0-9.-]*/[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*$"


def canonical_source_uri(uri):
    return uri is None or (isinstance(uri, str) and re.fullmatch(CANONICAL_URI_PATTERN, uri) is not None
                           and not any(part in {".", ".."} for part in uri.split("/")[3:]))


@event.listens_for(Engine, "connect")
def sqlite_uri_verifier(connection, _record):
    if isinstance(connection, sqlite3.Connection):
        connection.create_function("akb_intake_uri_canonical", 1, lambda uri: int(canonical_source_uri(uri)), deterministic=True)


def lock_uris(db, uris):
    connection = db.connection()
    dialect = connection.dialect.name
    if dialect not in {"postgresql", "sqlite"}:
        raise RuntimeError("Intake reference fencing is unsupported by this database")
    if dialect == "postgresql" and connection.get_isolation_level() != "READ COMMITTED":
        raise RuntimeError("Intake cleanup requires READ COMMITTED isolation")
    rows = {}
    for uri in sorted(set(uris)):
        if not canonical_source_uri(uri):
            raise problem(409, "intake_source_uri_not_canonical", "Content references require the exact canonical s3://bucket/key emitted by intake")
        digest = hashlib.sha256(uri.encode()).hexdigest()
        # SQLite INSERT obtains the shared database writer lock as well. An
        # existing row is deliberately no-op updated to serialize SQLite writes.
        db.execute(text("INSERT INTO intake_object_fences (uri_hash, source_uri) VALUES (:hash, :uri) "
                        "ON CONFLICT (uri_hash) DO UPDATE SET source_uri = intake_object_fences.source_uri"),
                   {"hash": digest, "uri": uri})
        row = db.scalar(select(IntakeObjectFence).where(IntakeObjectFence.uri_hash == digest).with_for_update().execution_options(populate_existing=True))
        if row.source_uri != uri:
            raise RuntimeError("Intake fence URI digest collision")
        rows[uri] = row
    return rows


def _orm_reference_uris(session):
    uris = set()
    for record in set(session.new).union(session.dirty):
        table = getattr(record, "__tablename__", "")
        field = REFERENCE_COLUMNS.get(table)
        if not field:
            continue
        if table == "document_profile_version_snapshots":
            uri = ((record.payload or {}).get("sourceLineage") or {}).get("contentUri")
        else:
            uri = getattr(record, field, None)
        if uri:
            uris.add(uri)
    return uris


@event.listens_for(Session, "before_flush")
def fence_reference_writes(session, _context, _instances):
    for row in lock_uris(session, _orm_reference_uris(session)).values():
        if row.claim_id is not None:
            raise problem(409, "intake_object_cleanup_claimed", "The expired intake object has been claimed for cleanup; create a new upload session")


def reference_counts(db, uri):
    return reference_counts_for_uris(db, [uri])[uri]


def reference_counts_for_uris(db, uris):
    # No subject, status, authorization projection, pagination or result limit.
    result = {uri: dict.fromkeys(REFERENCE_COLUMNS, 0) for uri in uris}
    if not uris:
        return result
    statements = []
    invalid_checks = []
    for table, field in REFERENCE_COLUMNS.items():
        expr = field
        if table == "document_profile_version_snapshots" and db.bind.dialect.name == "sqlite":
            expr = "json_extract(payload, '$.sourceLineage.contentUri')"
        # Existing ambiguous rows cannot be silently normalized or treated as
        # unrelated. Future writes are refused by the same database guard.
        invalid_checks.append(f"EXISTS (SELECT 1 FROM {table} WHERE NOT akb_intake_uri_canonical({expr}))")
        digest_filter = f"md5({expr}) IN :uri_hashes AND " if db.bind.dialect.name == "postgresql" else ""
        statements.append(f"SELECT {expr} AS source_uri, '{table}' AS owner_table, count(*) AS reference_count "
                          f"FROM {table} WHERE {digest_filter}{expr} IN :uris GROUP BY {expr}")
    if db.scalar(text("SELECT " + " OR ".join(invalid_checks))):
        raise RuntimeError("Non-canonical content references require explicit review before cleanup")
    query = text(" UNION ALL ".join(statements)).bindparams(bindparam("uris", expanding=True))
    parameters = {"uris": list(uris)}
    if db.bind.dialect.name == "postgresql":
        query = query.bindparams(bindparam("uri_hashes", expanding=True))
        parameters["uri_hashes"] = [hashlib.md5(uri.encode(), usedforsecurity=False).hexdigest() for uri in uris]
    for uri, table, count in db.execute(query, parameters):
        result[uri][table] = count
    return result


def sqlite_trigger_sql():
    statements = []
    for table, field in REFERENCE_COLUMNS.items():
        expression = "json_extract(NEW.payload, '$.sourceLineage.contentUri')" if table == "document_profile_version_snapshots" else f"NEW.{field}"
        for operation in ("INSERT", "UPDATE"):
            statements.append(f"CREATE TRIGGER intake_fence_{table}_{operation.lower()} BEFORE {operation} ON {table} BEGIN "
                f"SELECT CASE WHEN NOT akb_intake_uri_canonical({expression}) THEN RAISE(ABORT, 'intake_source_uri_not_canonical') END; "
                f"SELECT CASE WHEN EXISTS (SELECT 1 FROM intake_object_fences WHERE source_uri = {expression} AND claim_id IS NOT NULL) "
                "THEN RAISE(ABORT, 'intake_object_cleanup_claimed') END; END")
    statements.append("CREATE TRIGGER intake_fence_no_delete BEFORE DELETE ON intake_object_fences "
                      "WHEN OLD.claim_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'intake cleanup tombstone is permanent'); END")
    statements.append("CREATE TRIGGER intake_fence_no_rewrite BEFORE UPDATE ON intake_object_fences "
                      "WHEN OLD.source_uri != NEW.source_uri OR OLD.uri_hash != NEW.uri_hash OR (OLD.claim_id IS NOT NULL AND "
                      "(OLD.claim_id IS NOT NEW.claim_id OR OLD.manifest_digest IS NOT NEW.manifest_digest OR OLD.expires_at IS NOT NEW.expires_at "
                      "OR OLD.claimed_at IS NOT NEW.claimed_at OR OLD.claimed_by IS NOT NEW.claimed_by)) "
                      "BEGIN SELECT RAISE(ABORT, 'intake cleanup tombstone is permanent'); END")
    return statements + reference_index_sql("sqlite")


def reference_index_sql(dialect):
    result = []
    for table, field in REFERENCE_COLUMNS.items():
        expression = "json_extract(payload, '$.sourceLineage.contentUri')" if dialect == "sqlite" and table == "document_profile_version_snapshots" else field
        # PostgreSQL digest indexes have bounded entries even for pre-cutover
        # Unicode URIs. The query still compares the exact URI after this filter;
        # MD5 is an indexing optimization, never identity or deletion authority.
        indexed = f"md5({expression})" if dialect == "postgresql" else expression
        result.append(f"CREATE INDEX ix_intake_ref_{table} ON {table} (({indexed}))")
        result.append(f"CREATE INDEX ix_intake_noncanonical_{table} ON {table} ((1)) WHERE NOT akb_intake_uri_canonical({expression})")
    return result


def postgres_trigger_sql():
    statements = [f"""CREATE FUNCTION akb_intake_uri_canonical(candidate text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
      SELECT candidate IS NULL OR (candidate ~ '{CANONICAL_URI_PATTERN}' AND candidate !~ '/[.]{{1,2}}(/|$)')
    $$""", """CREATE FUNCTION akb_intake_fence_uri(candidate text) RETURNS void LANGUAGE plpgsql AS $$
    DECLARE digest text; existing intake_object_fences%ROWTYPE;
    BEGIN
      IF NOT akb_intake_uri_canonical(candidate) THEN
        RAISE EXCEPTION 'intake_source_uri_not_canonical' USING ERRCODE = '23514';
      END IF;
      IF candidate IS NULL THEN RETURN; END IF;
      digest := encode(sha256(convert_to(candidate, 'UTF8')), 'hex');
      INSERT INTO intake_object_fences (uri_hash, source_uri) VALUES (digest, candidate)
        ON CONFLICT (uri_hash) DO NOTHING;
      SELECT * INTO existing FROM intake_object_fences WHERE uri_hash = digest FOR UPDATE;
      IF existing.source_uri IS DISTINCT FROM candidate OR existing.claim_id IS NOT NULL THEN
        RAISE EXCEPTION 'intake_object_cleanup_claimed' USING ERRCODE = '23514';
      END IF;
    END $$""", """CREATE FUNCTION akb_intake_fence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF OLD.claim_id IS NOT NULL THEN RAISE EXCEPTION 'intake cleanup tombstone is permanent'; END IF;
        RETURN OLD;
      END IF;
      IF OLD.source_uri IS DISTINCT FROM NEW.source_uri OR OLD.uri_hash IS DISTINCT FROM NEW.uri_hash
        OR (OLD.claim_id IS NOT NULL AND OLD IS DISTINCT FROM NEW) THEN
        RAISE EXCEPTION 'intake cleanup tombstone is permanent';
      END IF;
      RETURN NEW;
    END $$""", "CREATE TRIGGER intake_fence_immutable BEFORE UPDATE OR DELETE ON intake_object_fences "
                "FOR EACH ROW EXECUTE FUNCTION akb_intake_fence_immutable()"]
    for table, field in REFERENCE_COLUMNS.items():
        function = f"akb_intake_fence_{table}"
        statements.append(f"""CREATE FUNCTION {function}() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE candidate text;
        BEGIN
          FOR candidate IN SELECT DISTINCT ({field}) COLLATE "C" FROM intake_new_rows WHERE {field} IS NOT NULL ORDER BY 1 LOOP
            PERFORM akb_intake_fence_uri(candidate);
          END LOOP;
          RETURN NULL;
        END $$""")
        for operation in ("INSERT", "UPDATE"):
            statements.append(f"CREATE TRIGGER intake_fence_{table}_{operation.lower()} AFTER {operation} ON {table} "
                f"REFERENCING NEW TABLE AS intake_new_rows FOR EACH STATEMENT EXECUTE FUNCTION {function}()")
    return statements + reference_index_sql("postgresql")


@event.listens_for(Base.metadata, "after_create")
def create_reference_triggers(_metadata, connection, **_kwargs):
    if IntakeObjectFence.__table__ not in _kwargs.get("tables", []):
        return
    statements = sqlite_trigger_sql() if connection.dialect.name == "sqlite" else postgres_trigger_sql()
    for statement in statements:
        connection.exec_driver_sql(statement)


def verify_fence_installation(db):
    expected = {f"intake_fence_{table}_{operation}" for table in REFERENCE_COLUMNS for operation in ("insert", "update")}
    if db.bind.dialect.name == "postgresql":
        expected.add("intake_fence_immutable")
        actual = set(db.scalars(text("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'O'")))
        if db.connection().get_isolation_level() != "READ COMMITTED":
            raise RuntimeError("Intake cleanup requires READ COMMITTED isolation")
    elif db.bind.dialect.name == "sqlite":
        expected.update({"intake_fence_no_delete", "intake_fence_no_rewrite"})
        actual = set(db.scalars(text("SELECT name FROM sqlite_master WHERE type = 'trigger'")))
    else:
        raise RuntimeError("Intake cleanup is unsupported by this database")
    if not expected.issubset(actual):
        raise RuntimeError("Intake cleanup reference fence migration is not complete")
