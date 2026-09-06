"""Permanent intake reference fences, including direct SQL writers.

No objects are removed and no existing rows are backfilled.
"""
from alembic import op
import sqlalchemy as sa

revision = "0029_intake_cleanup_fences"
down_revision = "0028_native_intake_identity"
branch_labels = None
depends_on = None

# Frozen SQL: changing runtime guards does not rewrite migration history.
POSTGRES_SQL = ['CREATE FUNCTION akb_intake_uri_canonical(candidate text) RETURNS boolean LANGUAGE sql IMMUTABLE '
 'AS $$\n'
 '      SELECT candidate IS NULL OR (candidate ~ '
 "'^s3://[a-z0-9][a-z0-9.-]*/[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*$' AND candidate !~ "
 "'/[.]{1,2}(/|$)')\n"
 '    $$',
 'CREATE FUNCTION akb_intake_fence_uri(candidate text) RETURNS void LANGUAGE plpgsql AS $$\n'
 '    DECLARE digest text; existing intake_object_fences%ROWTYPE;\n'
 '    BEGIN\n'
 '      IF NOT akb_intake_uri_canonical(candidate) THEN\n'
 "        RAISE EXCEPTION 'intake_source_uri_not_canonical' USING ERRCODE = '23514';\n"
 '      END IF;\n'
 '      IF candidate IS NULL THEN RETURN; END IF;\n'
 "      digest := encode(sha256(convert_to(candidate, 'UTF8')), 'hex');\n"
 '      INSERT INTO intake_object_fences (uri_hash, source_uri) VALUES (digest, candidate)\n'
 '        ON CONFLICT (uri_hash) DO NOTHING;\n'
 '      SELECT * INTO existing FROM intake_object_fences WHERE uri_hash = digest FOR UPDATE;\n'
 '      IF existing.source_uri IS DISTINCT FROM candidate OR existing.claim_id IS NOT NULL THEN\n'
 "        RAISE EXCEPTION 'intake_object_cleanup_claimed' USING ERRCODE = '23514';\n"
 '      END IF;\n'
 '    END $$',
 'CREATE FUNCTION akb_intake_fence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$\n'
 '    BEGIN\n'
 "      IF TG_OP = 'DELETE' THEN\n"
 "        IF OLD.claim_id IS NOT NULL THEN RAISE EXCEPTION 'intake cleanup tombstone is "
 "permanent'; END IF;\n"
 '        RETURN OLD;\n'
 '      END IF;\n'
 '      IF OLD.source_uri IS DISTINCT FROM NEW.source_uri OR OLD.uri_hash IS DISTINCT FROM '
 'NEW.uri_hash\n'
 '        OR (OLD.claim_id IS NOT NULL AND OLD IS DISTINCT FROM NEW) THEN\n'
 "        RAISE EXCEPTION 'intake cleanup tombstone is permanent';\n"
 '      END IF;\n'
 '      RETURN NEW;\n'
 '    END $$',
 'CREATE TRIGGER intake_fence_immutable BEFORE UPDATE OR DELETE ON intake_object_fences FOR EACH '
 'ROW EXECUTE FUNCTION akb_intake_fence_immutable()',
 'CREATE FUNCTION akb_intake_fence_document_versions() RETURNS trigger LANGUAGE plpgsql AS $$\n'
 '        DECLARE candidate text;\n'
 '        BEGIN\n'
 '          FOR candidate IN SELECT DISTINCT (source_file_uri) COLLATE "C" FROM intake_new_rows '
 'WHERE source_file_uri IS NOT NULL ORDER BY 1 LOOP\n'
 '            PERFORM akb_intake_fence_uri(candidate);\n'
 '          END LOOP;\n'
 '          RETURN NULL;\n'
 '        END $$',
 'CREATE TRIGGER intake_fence_document_versions_insert AFTER INSERT ON document_versions '
 'REFERENCING NEW TABLE AS intake_new_rows FOR EACH STATEMENT EXECUTE FUNCTION '
 'akb_intake_fence_document_versions()',
 'CREATE TRIGGER intake_fence_document_versions_update AFTER UPDATE ON document_versions '
 'REFERENCING NEW TABLE AS intake_new_rows FOR EACH STATEMENT EXECUTE FUNCTION '
 'akb_intake_fence_document_versions()',
 'CREATE FUNCTION akb_intake_fence_document_files() RETURNS trigger LANGUAGE plpgsql AS $$\n'
 '        DECLARE candidate text;\n'
 '        BEGIN\n'
 '          FOR candidate IN SELECT DISTINCT (uri) COLLATE "C" FROM intake_new_rows WHERE uri IS '
 'NOT NULL ORDER BY 1 LOOP\n'
 '            PERFORM akb_intake_fence_uri(candidate);\n'
 '          END LOOP;\n'
 '          RETURN NULL;\n'
 '        END $$',
 'CREATE TRIGGER intake_fence_document_files_insert AFTER INSERT ON document_files REFERENCING NEW '
 'TABLE AS intake_new_rows FOR EACH STATEMENT EXECUTE FUNCTION akb_intake_fence_document_files()',
 'CREATE TRIGGER intake_fence_document_files_update AFTER UPDATE ON document_files REFERENCING NEW '
 'TABLE AS intake_new_rows FOR EACH STATEMENT EXECUTE FUNCTION akb_intake_fence_document_files()',
 'CREATE FUNCTION akb_intake_fence_document_publications() RETURNS trigger LANGUAGE plpgsql AS $$\n'
 '        DECLARE candidate text;\n'
 '        BEGIN\n'
 '          FOR candidate IN SELECT DISTINCT (source_file_uri) COLLATE "C" FROM intake_new_rows '
 'WHERE source_file_uri IS NOT NULL ORDER BY 1 LOOP\n'
 '            PERFORM akb_intake_fence_uri(candidate);\n'
 '          END LOOP;\n'
 '          RETURN NULL;\n'
 '        END $$',
 'CREATE TRIGGER intake_fence_document_publications_insert AFTER INSERT ON document_publications '
 'REFERENCING NEW TABLE AS intake_new_rows FOR EACH STATEMENT EXECUTE FUNCTION '
 'akb_intake_fence_document_publications()',
 'CREATE TRIGGER intake_fence_document_publications_update AFTER UPDATE ON document_publications '
 'REFERENCING NEW TABLE AS intake_new_rows FOR EACH STATEMENT EXECUTE FUNCTION '
 'akb_intake_fence_document_publications()',
 'CREATE FUNCTION akb_intake_fence_external_document_refs() RETURNS trigger LANGUAGE plpgsql AS '
 '$$\n'
 '        DECLARE candidate text;\n'
 '        BEGIN\n'
 '          FOR candidate IN SELECT DISTINCT (akb_source_uri) COLLATE "C" FROM intake_new_rows '
 'WHERE akb_source_uri IS NOT NULL ORDER BY 1 LOOP\n'
 '            PERFORM akb_intake_fence_uri(candidate);\n'
 '          END LOOP;\n'
 '          RETURN NULL;\n'
 '        END $$',
 'CREATE TRIGGER intake_fence_external_document_refs_insert AFTER INSERT ON external_document_refs '
 'REFERENCING NEW TABLE AS intake_new_rows FOR EACH STATEMENT EXECUTE FUNCTION '
 'akb_intake_fence_external_document_refs()',
 'CREATE TRIGGER intake_fence_external_document_refs_update AFTER UPDATE ON external_document_refs '
 'REFERENCING NEW TABLE AS intake_new_rows FOR EACH STATEMENT EXECUTE FUNCTION '
 'akb_intake_fence_external_document_refs()',
 'CREATE FUNCTION akb_intake_fence_document_profile_version_snapshots() RETURNS trigger LANGUAGE '
 'plpgsql AS $$\n'
 '        DECLARE candidate text;\n'
 '        BEGIN\n'
 "          FOR candidate IN SELECT DISTINCT (payload->'sourceLineage'->>'contentUri') COLLATE "
 '"C" FROM intake_new_rows WHERE payload->\'sourceLineage\'->>\'contentUri\' IS NOT NULL ORDER BY '
 '1 LOOP\n'
 '            PERFORM akb_intake_fence_uri(candidate);\n'
 '          END LOOP;\n'
 '          RETURN NULL;\n'
 '        END $$',
 'CREATE TRIGGER intake_fence_document_profile_version_snapshots_insert AFTER INSERT ON '
 'document_profile_version_snapshots REFERENCING NEW TABLE AS intake_new_rows FOR EACH STATEMENT '
 'EXECUTE FUNCTION akb_intake_fence_document_profile_version_snapshots()',
 'CREATE TRIGGER intake_fence_document_profile_version_snapshots_update AFTER UPDATE ON '
 'document_profile_version_snapshots REFERENCING NEW TABLE AS intake_new_rows FOR EACH STATEMENT '
 'EXECUTE FUNCTION akb_intake_fence_document_profile_version_snapshots()',
 'CREATE INDEX ix_intake_ref_document_versions ON document_versions ((md5(source_file_uri)))',
 'CREATE INDEX ix_intake_noncanonical_document_versions ON document_versions ((1)) WHERE NOT '
 'akb_intake_uri_canonical(source_file_uri)',
 'CREATE INDEX ix_intake_ref_document_files ON document_files ((md5(uri)))',
 'CREATE INDEX ix_intake_noncanonical_document_files ON document_files ((1)) WHERE NOT '
 'akb_intake_uri_canonical(uri)',
 'CREATE INDEX ix_intake_ref_document_publications ON document_publications '
 '((md5(source_file_uri)))',
 'CREATE INDEX ix_intake_noncanonical_document_publications ON document_publications ((1)) WHERE '
 'NOT akb_intake_uri_canonical(source_file_uri)',
 'CREATE INDEX ix_intake_ref_external_document_refs ON external_document_refs '
 '((md5(akb_source_uri)))',
 'CREATE INDEX ix_intake_noncanonical_external_document_refs ON external_document_refs ((1)) WHERE '
 'NOT akb_intake_uri_canonical(akb_source_uri)',
 'CREATE INDEX ix_intake_ref_document_profile_version_snapshots ON '
 "document_profile_version_snapshots ((md5(payload->'sourceLineage'->>'contentUri')))",
 'CREATE INDEX ix_intake_noncanonical_document_profile_version_snapshots ON '
 'document_profile_version_snapshots ((1)) WHERE NOT '
 "akb_intake_uri_canonical(payload->'sourceLineage'->>'contentUri')"]
SQLITE_SQL = ['CREATE TRIGGER intake_fence_document_versions_insert BEFORE INSERT ON document_versions BEGIN '
 'SELECT CASE WHEN NOT akb_intake_uri_canonical(NEW.source_file_uri) THEN RAISE(ABORT, '
 "'intake_source_uri_not_canonical') END; SELECT CASE WHEN EXISTS (SELECT 1 FROM "
 'intake_object_fences WHERE source_uri = NEW.source_file_uri AND claim_id IS NOT NULL) THEN '
 "RAISE(ABORT, 'intake_object_cleanup_claimed') END; END",
 'CREATE TRIGGER intake_fence_document_versions_update BEFORE UPDATE ON document_versions BEGIN '
 'SELECT CASE WHEN NOT akb_intake_uri_canonical(NEW.source_file_uri) THEN RAISE(ABORT, '
 "'intake_source_uri_not_canonical') END; SELECT CASE WHEN EXISTS (SELECT 1 FROM "
 'intake_object_fences WHERE source_uri = NEW.source_file_uri AND claim_id IS NOT NULL) THEN '
 "RAISE(ABORT, 'intake_object_cleanup_claimed') END; END",
 'CREATE TRIGGER intake_fence_document_files_insert BEFORE INSERT ON document_files BEGIN SELECT '
 'CASE WHEN NOT akb_intake_uri_canonical(NEW.uri) THEN RAISE(ABORT, '
 "'intake_source_uri_not_canonical') END; SELECT CASE WHEN EXISTS (SELECT 1 FROM "
 'intake_object_fences WHERE source_uri = NEW.uri AND claim_id IS NOT NULL) THEN RAISE(ABORT, '
 "'intake_object_cleanup_claimed') END; END",
 'CREATE TRIGGER intake_fence_document_files_update BEFORE UPDATE ON document_files BEGIN SELECT '
 'CASE WHEN NOT akb_intake_uri_canonical(NEW.uri) THEN RAISE(ABORT, '
 "'intake_source_uri_not_canonical') END; SELECT CASE WHEN EXISTS (SELECT 1 FROM "
 'intake_object_fences WHERE source_uri = NEW.uri AND claim_id IS NOT NULL) THEN RAISE(ABORT, '
 "'intake_object_cleanup_claimed') END; END",
 'CREATE TRIGGER intake_fence_document_publications_insert BEFORE INSERT ON document_publications '
 'BEGIN SELECT CASE WHEN NOT akb_intake_uri_canonical(NEW.source_file_uri) THEN RAISE(ABORT, '
 "'intake_source_uri_not_canonical') END; SELECT CASE WHEN EXISTS (SELECT 1 FROM "
 'intake_object_fences WHERE source_uri = NEW.source_file_uri AND claim_id IS NOT NULL) THEN '
 "RAISE(ABORT, 'intake_object_cleanup_claimed') END; END",
 'CREATE TRIGGER intake_fence_document_publications_update BEFORE UPDATE ON document_publications '
 'BEGIN SELECT CASE WHEN NOT akb_intake_uri_canonical(NEW.source_file_uri) THEN RAISE(ABORT, '
 "'intake_source_uri_not_canonical') END; SELECT CASE WHEN EXISTS (SELECT 1 FROM "
 'intake_object_fences WHERE source_uri = NEW.source_file_uri AND claim_id IS NOT NULL) THEN '
 "RAISE(ABORT, 'intake_object_cleanup_claimed') END; END",
 'CREATE TRIGGER intake_fence_external_document_refs_insert BEFORE INSERT ON '
 'external_document_refs BEGIN SELECT CASE WHEN NOT akb_intake_uri_canonical(NEW.akb_source_uri) '
 "THEN RAISE(ABORT, 'intake_source_uri_not_canonical') END; SELECT CASE WHEN EXISTS (SELECT 1 FROM "
 'intake_object_fences WHERE source_uri = NEW.akb_source_uri AND claim_id IS NOT NULL) THEN '
 "RAISE(ABORT, 'intake_object_cleanup_claimed') END; END",
 'CREATE TRIGGER intake_fence_external_document_refs_update BEFORE UPDATE ON '
 'external_document_refs BEGIN SELECT CASE WHEN NOT akb_intake_uri_canonical(NEW.akb_source_uri) '
 "THEN RAISE(ABORT, 'intake_source_uri_not_canonical') END; SELECT CASE WHEN EXISTS (SELECT 1 FROM "
 'intake_object_fences WHERE source_uri = NEW.akb_source_uri AND claim_id IS NOT NULL) THEN '
 "RAISE(ABORT, 'intake_object_cleanup_claimed') END; END",
 'CREATE TRIGGER intake_fence_document_profile_version_snapshots_insert BEFORE INSERT ON '
 'document_profile_version_snapshots BEGIN SELECT CASE WHEN NOT '
 "akb_intake_uri_canonical(json_extract(NEW.payload, '$.sourceLineage.contentUri')) THEN "
 "RAISE(ABORT, 'intake_source_uri_not_canonical') END; SELECT CASE WHEN EXISTS (SELECT 1 FROM "
 "intake_object_fences WHERE source_uri = json_extract(NEW.payload, '$.sourceLineage.contentUri') "
 "AND claim_id IS NOT NULL) THEN RAISE(ABORT, 'intake_object_cleanup_claimed') END; END",
 'CREATE TRIGGER intake_fence_document_profile_version_snapshots_update BEFORE UPDATE ON '
 'document_profile_version_snapshots BEGIN SELECT CASE WHEN NOT '
 "akb_intake_uri_canonical(json_extract(NEW.payload, '$.sourceLineage.contentUri')) THEN "
 "RAISE(ABORT, 'intake_source_uri_not_canonical') END; SELECT CASE WHEN EXISTS (SELECT 1 FROM "
 "intake_object_fences WHERE source_uri = json_extract(NEW.payload, '$.sourceLineage.contentUri') "
 "AND claim_id IS NOT NULL) THEN RAISE(ABORT, 'intake_object_cleanup_claimed') END; END",
 'CREATE TRIGGER intake_fence_no_delete BEFORE DELETE ON intake_object_fences WHEN OLD.claim_id IS '
 "NOT NULL BEGIN SELECT RAISE(ABORT, 'intake cleanup tombstone is permanent'); END",
 'CREATE TRIGGER intake_fence_no_rewrite BEFORE UPDATE ON intake_object_fences WHEN OLD.source_uri '
 '!= NEW.source_uri OR OLD.uri_hash != NEW.uri_hash OR (OLD.claim_id IS NOT NULL AND (OLD.claim_id '
 'IS NOT NEW.claim_id OR OLD.manifest_digest IS NOT NEW.manifest_digest OR OLD.expires_at IS NOT '
 'NEW.expires_at OR OLD.claimed_at IS NOT NEW.claimed_at OR OLD.claimed_by IS NOT NEW.claimed_by)) '
 "BEGIN SELECT RAISE(ABORT, 'intake cleanup tombstone is permanent'); END",
 'CREATE INDEX ix_intake_ref_document_versions ON document_versions ((source_file_uri))',
 'CREATE INDEX ix_intake_noncanonical_document_versions ON document_versions ((1)) WHERE NOT '
 'akb_intake_uri_canonical(source_file_uri)',
 'CREATE INDEX ix_intake_ref_document_files ON document_files ((uri))',
 'CREATE INDEX ix_intake_noncanonical_document_files ON document_files ((1)) WHERE NOT '
 'akb_intake_uri_canonical(uri)',
 'CREATE INDEX ix_intake_ref_document_publications ON document_publications ((source_file_uri))',
 'CREATE INDEX ix_intake_noncanonical_document_publications ON document_publications ((1)) WHERE '
 'NOT akb_intake_uri_canonical(source_file_uri)',
 'CREATE INDEX ix_intake_ref_external_document_refs ON external_document_refs ((akb_source_uri))',
 'CREATE INDEX ix_intake_noncanonical_external_document_refs ON external_document_refs ((1)) WHERE '
 'NOT akb_intake_uri_canonical(akb_source_uri)',
 'CREATE INDEX ix_intake_ref_document_profile_version_snapshots ON '
 "document_profile_version_snapshots ((json_extract(payload, '$.sourceLineage.contentUri')))",
 'CREATE INDEX ix_intake_noncanonical_document_profile_version_snapshots ON '
 'document_profile_version_snapshots ((1)) WHERE NOT '
 "akb_intake_uri_canonical(json_extract(payload, '$.sourceLineage.contentUri'))"]


def upgrade():
    op.create_table("intake_object_fences",
        sa.Column("uri_hash", sa.String(64), primary_key=True),
        sa.Column("source_uri", sa.String(1024), nullable=False),
        sa.Column("claim_id", sa.String(64), nullable=True),
        sa.Column("manifest_digest", sa.String(64), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("claimed_by", sa.String(160), nullable=True),
    )
    for statement in SQLITE_SQL if op.get_bind().dialect.name == "sqlite" else POSTGRES_SQL:
        op.execute(statement)


def downgrade():
    # A rollback must not resurrect intake credentials or destroy tombstones.
    raise RuntimeError("Permanent intake cleanup fences cannot be downgraded; roll forward")
