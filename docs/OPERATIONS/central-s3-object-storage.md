# Central S3 Object Storage

AKB production stores original document binaries in the internal SeaweedFS S3
gateway at `http://storage.home.cz:8333`. The canonical bucket for new objects
is `akb-documents`; path-style addressing is mandatory. Public AKB upload,
download, preview, ingestion, authorization, malware scanning, and audit APIs do
not change.

## Security and data model

- S3 is reachable only from the server VLAN. It is not a public document API.
- Credentials are read from protected files and are never committed or logged.
- Uploads remain in the local quarantine until ClamAV returns `OK`. Only clean
  content is copied to S3 and confirmed in Registry.
- A storage timeout or error fails closed. AKB never confirms an object that was
  not durably stored and hash-verified.
- Registry remains the authority for filename, MIME type, size, SHA-256,
  classification, policy, version, and audit metadata.
- Historical immutable Registry records use `s3://akl-documents/...`. The
  `akl-documents` logical name is an explicit compatibility alias to the
  physical `akb-documents` bucket. Historical publication records are not
  rewritten.
- The legacy filesystem stays mounted read-only during the rollback window.
  Fallback reads are temporary and must be disabled only after a complete S3
  verification and backup checkpoint.

## Configuration

Production uses:

```dotenv
AKL_OBJECT_STORAGE_MODE=s3
AKL_S3_ENDPOINT=http://storage.home.cz:8333
AKL_S3_BUCKET=akb-documents
AKL_S3_REGION=us-east-1
AKL_S3_FORCE_PATH_STYLE=true
AKL_OBJECT_STORAGE_LEGACY_BUCKETS=akl-documents
AKL_OBJECT_STORAGE_LOCAL_FALLBACK_READ=true
AKL_S3_ACCESS_KEY_ID_SOURCE_FILE=/srv/akl/env/akb-s3.access-key-id
AKL_S3_SECRET_ACCESS_KEY_SOURCE_FILE=/srv/akl/env/akb-s3.secret-access-key
```

The two credential files must be owned by the deployment operator and readable
only by the required service boundary. Never place their values in Compose,
Git, command output, or an incident report.

## Migration sequence

1. Create `akb-documents` and a dedicated least-privilege AKB S3 identity.
2. Deploy the S3-capable release while production remains in `local` mode.
3. Run a dry run from Registry:

   ```bash
   python -m app.object_storage_migration \
     --storage-root /data/object-storage \
     --source-bucket akl-documents \
     --report /tmp/akb-s3-dry-run.json
   ```

4. Run the verified copy with `--apply`. The command is idempotent, does not
   delete local files, and fails on any size or SHA-256 conflict.
5. Stop document writes briefly, rerun `--apply`, and require zero conflicts and
   errors with all discovered bytes verified.
6. Run `scripts/s3_object_storage_smoke.py` using credential file variables.
7. Set `AKL_OBJECT_STORAGE_MODE=s3`, retain fallback reads, and deploy once.
8. Verify `/akb/api/health`, `/akb/api/ready`, upload, ClamAV scan, confirmation,
   ingestion, preview/download, historical publication delivery, and an
   authorized chat citation.
9. Keep the original local data unchanged through the rollback window. A
   rollback changes only `AKL_OBJECT_STORAGE_MODE=local` and redeploys the last
   verified release.

Do not rewrite immutable publication URIs, delete source files, or enable S3
mode before the final copy is complete.

## Verification

The repository provides two layers of verification:

- unit tests for local lifecycle, logical legacy bucket compatibility, and the
  idempotent migration;
- `scripts/s3_object_storage_smoke.py` for upload, head, read, SHA-256, list,
  delete, and post-delete verification against the actual S3-compatible
  backend.

Operational output contains counts, byte totals, status, and key fingerprints,
not document names or contents.
