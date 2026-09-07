# Intake object cleanup

AKB records signed expiry evidence before the first quarantine write. Cleanup is
an explicit operator operation; no scheduler, deletion, production grant or
production configuration is activated by this change. The command defaults to
dry-run and accepts an explicit batch of 1–100 durable manifest files.
Local apply is implemented. **S3 apply is unavailable for every backend** until
an approved immutable-version deletion contract is implemented; there is no
configuration flag to enable it. The command rejects S3 apply before a Registry
claim or any storage mutation. S3 dry-run remains available.

## Durable evidence

Every new intake session writes the same immutable manifest to:

- `<quarantine-root>/manifests/<session>.manifest` on the accepting web node;
- `<bucket>/.intake/manifests/<session>.manifest` in the configured object store.

Local writes sync the file and directory entries; S3 writes use the existing
no-clobber object-storage adapter. Both writes precede quarantine bytes. A
manifest contains schema version, key ID, session/document ID, exact bucket/key
and source URI, normalized filename, byte count, SHA-256 and the signed upload
expiry. It contains no bearer/upload token, policy, actor identity or document
body. The envelope is `base64url(JSON).base64url(HMAC-SHA256)`; its signature uses
the distinct `akb-intake-manifest-1` domain followed by a NUL and the encoded
payload. `kid` is the first 16 hex characters of SHA-256 of the signing key.

The current key is `AKL_WEB_UPLOAD_SIGNING_SECRET`. For key rotation, add retained
old keys to `AKL_INTAKE_MANIFEST_VERIFY_KEYS` as JSON `{kid: secret}` on Registry
and the operator environment before rotating the web key. Keep each verification
key while its manifests may still be used; an unknown key means retain, never
infer expiry from a modification time. The public cross-language test vector in
`contracts/akb/document-intake/v1/manifest-test-vector.json` is not a deployment key.

Objects without a valid manifest, including pre-cutover files, are outside this
cleanup authority and remain untouched. Manifests and claimed tombstones remain
durable after deletion. They support retries after a lost response and an upload
or scanner that finishes late and recreates identical unreferenced bytes.

## Reference and transaction contract

Migration `0029_intake_cleanup_fences` follows the native replay migration `0028`.
It installs a permanent URI fence and INSERT/UPDATE triggers on every content
owner: all `document_versions.source_file_uri`, `document_files.uri`,
`document_publications.source_file_uri`, `external_document_refs.akb_source_uri`,
and the immutable version-profile `payload.sourceLineage.contentUri`.
Reference checks include historical, cancelled, revoked, private and otherwise
user-invisible rows. Audit text and queue messages refer to these owners and do
not establish an independent content-retention reference. A future content-owner
table must extend both the complete query and the transaction triggers.

The audited application writers are native and Budget version/file creation,
external-reference preparation/confirmation, publication creation, and
`document_profile_storage.persist_version_snapshot`. All use ORM writes. The
PostgreSQL smoke also uses raw SQL; database triggers protect that path and bulk
statements. ORM hooks acquire the complete known URI set before an early flush,
including native replay reservation, in sorted order. PostgreSQL statement
triggers acquire their transition-row URI set in sorted order; raw transactions
writing multiple statements should likewise sort their entire URI set. A
deadlock or timeout rolls back; it never permits deletion.

Content references use the canonical ASCII `s3://bucket/key` representation
emitted by intake. Both ORM and database guards reject encoded characters,
double encoding, query/fragment suffixes, dot segments, empty path segments and
other URI classes. Existing ambiguous references stop the complete check until
explicit review; they are never rewritten or assumed unrelated. Registry checks
the manifest against its configured `AKL_S3_BUCKET` and refuses cleanup if
`AKL_OBJECT_STORAGE_LEGACY_BUCKETS` names a different physical alias. The operator
tool enforces the same single-bucket constraint. This clean cutover does not
silently support old aliases or local-path/HTTP content references.

`POST /api/v1/admin/intake-cleanup/dry-run` accepts `{manifests: [...]}` and makes
no database writes. `POST /api/v1/admin/intake-cleanup/claim` verifies the same
signed identities, obtains row locks keyed by SHA-256 of the exact canonical
source URI, checks every reference in one complete query, and commits a permanent
claim only after signed expiry plus `AKL_INTAKE_CLEANUP_GRACE_SECONDS` (default
24 hours, minimum one hour). There is no user-filtered document list or pagination
in the authoritative reference check. PostgreSQL uses READ COMMITTED, a five
second statement/lock timeout, and refuses unsupported isolation. SQLite uses
its database writer lock. Missing migrations, disabled reference triggers,
unavailable queries or inconsistent evidence fail closed.
All five reference expressions have lookup indexes. PostgreSQL uses a bounded
MD5 lookup index followed by exact URI comparison; this digest is only an index
optimization, not the SHA-256 fence identity or content proof. Partial indexes
also cover pre-existing noncanonical references, so checking their absence does
not require scanning every document on each cleanup batch. The complete owner
query is never replaced by pagination; a timeout retains the entire batch.

- Reference transaction wins: cleanup waits and then retains the object.
- Claim transaction wins: late ORM, bulk or raw-SQL references are rejected.
- Claim rolls back: no permission to delete is returned and the writer can proceed.

Claims bind the exact manifest digest and retain one stable claim ID on replay.
They never expire, cannot be deleted or rebound by ordinary UPDATE/DELETE, and
cannot be downgraded away by Alembic. Recovery is roll-forward. Database owner
privileges that can disable triggers or truncate tables are maintenance authority
and must not be given to an application or cleanup client.

## Service grant and clean cutover

Use a dedicated operator service identity, for example `svc-akb-intake-cleanup`.
The exact name is a deployment choice, not an implicitly trusted built-in user.
STRATOS/identity administration must provision its client credential with the
existing Registry audience and trusted service-account identity shape. AKB
operators then explicitly set:

- `AKL_INTAKE_CLEANUP_SERVICE_CLIENT_ID` to that exact client;
- the same client in `AKL_TRUSTED_SERVICE_CLIENT_IDS`;
- exactly `client=intake-cleanup` in `AKL_SERVICE_CLIENT_ROUTE_GRANTS`.

The verified service identity and its route grant are both required. Human admin
roles, `service_ingestion`, another service with the grant, and a client ID header
without verified identity do not authorize production cleanup. Existing service
principals intentionally have no end-user capability projection; the dedicated
`intake-cleanup` route grant is the minimum operation-specific service capability.
Do not grant documents-write, access-admin or other namespaces to this client.
The cleanup credential only calls AKB; it does not fetch STRATOS document bytes.
Neither existing STRATOS Budget nor public-source clients receive this grant.

Promote migration and runtime together before allowing new intake writes. Keep
cleanup disabled until that release is verified. Prepare retained verification
keys and inventory manifest files from every accepting web node or the object
store. There is no legacy mtime-based fallback and no automatic backfill.

## Operator command

Run from `services/registry-api` in a verified checkout with its installed Python
dependencies. Provide a dedicated bearer token through a protected token file,
the matching manifest verification keys through the environment, and explicitly
select manifest files copied from the durable locations above. Never reconstruct
or manually sign expiry for old data.

```sh
python -m app.intake_cleanup_cli \
  --registry-url https://registry.example.internal \
  --token-file /run/secrets/intake-cleanup-token \
  --storage-mode local --bucket akl-documents \
  --object-root /data/object-storage \
  --quarantine-root /data/upload-quarantine \
  --manifest /data/upload-quarantine/manifests/upl_EXACT_SESSION.manifest
```

The example session is a placeholder. Repeat `--manifest` for a bounded batch.
Review dry-run status `eligible`, `referenced`, or `not_expired`. A complete result
covers every URI in that batch, not an assertion that the entire bucket inventory
has been enumerated. To apply the reviewed batch, repeat the command with
`--apply`; it obtains fresh authoritative claims rather than trusting the earlier
dry-run. Incomplete, redirected, oversized or identity-mismatched responses stop
the operation. A lost claim response is safe to retry with the same manifests.

Local removal opens every directory with `O_NOFOLLOW` and directory file
descriptors, requires a regular file, verifies exact size/hash and stable inode,
then unlinks through the same directory descriptor and syncs it. Storage roots
must be operator-owned; the supported intake writer never overwrites a published
file. Quarantine pending/failed/infected copies use the same exact manifest and
reference decision. Referenced sessions retain these copies conservatively.

For S3 dry-run use `--storage-mode s3` and the existing `AKL_S3_ENDPOINT`,
`AKL_S3_BUCKET`, region, path-style and credential/file settings. Logical legacy
bucket aliases are not cleanup targets. `--apply` returns
`S3_CLEANUP_APPLY_UNAVAILABLE` (exit 2) before calling Registry claim or reading
or mutating storage. Unversioned and versioned S3 objects remain untouched.
Restoring apply requires an approved immutable-version identity/deletion and
retention contract, its implementation, and actual backend verification.
Run once on each web node to inspect its local quarantine; this command does not
claim that another node's filesystem was inspected. Manifest discovery and
retention scheduling are deliberately operator-controlled.

## Verification

Focused tests cover signatures and retained keys, exact coordinates, expiry and
grace, every owner reference, raw SQL and ORM rejection, immutable tombstones,
service boundaries, symlink/hash/path refusal, S3 apply refusal, incomplete
Registry responses, dry-run and idempotent apply on temporary files. The opt-in
`AKB_INTAKE_CLEANUP_TEST_POSTGRES_URL` test creates and removes only a new random
database on an explicitly supplied disposable QA server; it migrates to head and
proves both orderings of the raw writer/cleanup race with independent connections.
Actual local backend verification used the already-local image
`sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e`,
MinIO `RELEASE.2025-09-07T16-13-09Z`, commit
`07c3a429bfed433e49018cb0f78a52145d4bedeb`. The capability probe proved that a
wrong `DeleteObject IfMatch` returned 204 and removed its disposable synthetic
object, rather than rejecting with 412. This backend therefore **does not
provide the required conditional-delete guarantee**. A normal exact-match
delete succeeding does not prove safety.

The opt-in `AKB_INTAKE_CLEANUP_TEST_MINIO_IMAGE` test requires an explicit local
image ID, creates a fresh loopback-only container with tmpfs and synthetic
credentials, and removes that container after testing. It records this unsupported
capability and proves that AKB's S3 apply guard performs no claim/read/delete,
preserves unversioned and versioned objects, and keeps the real Registry dry-run
path usable. No existing MinIO instance or bucket was used.
