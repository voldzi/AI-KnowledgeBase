# AKB Document Intake V1

Implementation status, 2026-09-05: the current working increment hardens intake
authorization and local immutable-file replay. Complete Budget retry remains
blocked on the central STRATOS root/version idempotency behavior described in
[the handoff](STRATOS_DOCUMENT_INTAKE_HANDOFF.md#blocking-central-replay-change).
Local tests do not establish cross-application acceptance or deployment.

Target admission policy, approved 2026-09-05: effective TLP is mandatory for all
AKB documents and versions. There is no "approved without TLP" exception, including
official-source collection and service imports. The working implementation now
requires explicit TLP in document write contracts and rejects incomplete stored
policy before binary intake, processing, indexing and production retrieval.
Shared nullable Policy V2 readers remain defensive; they cannot authorize
document admission. Verified active responsibility and approved source profiles
still require the atomic STRATOS admission contract before intake enablement.
See [ADR 0017](../adr/0017-mandatory-document-policy.md).

## Purpose

Document Intake is the single AKB-controlled binary entry point for documents
uploaded by a person, submitted by a STRATOS application or collected from an
approved internet source. It covers directives, policies, laws, contracts,
project material and other allowlisted document formats.

It does not let a source application choose authorization, classification or
publication. Those decisions remain in the current STRATOS access projection,
Information Policy and the relevant Registry workflow.

## Contract

The source first obtains an origin-specific signed preflight decision. Every
preflight now returns a canonical `upload_url` under:

```text
/api/document-intake/v1/sessions/{sessionId}/content
```

The binary request is:

```http
PUT {upload_url}
Content-Type: {exact signed MIME type}
X-AKL-Upload-Token: {opaque signed session}
X-AKL-Content-SHA256: sha256:{64 lowercase hex characters}
```

The signed token does not replace current authorization. Interactive AKB
preflight and content PUT require `document.version.create`, the same current
person as the signed session and unchanged policy coordinates. All production
upload tokens also bind a complete version `document_profile` with
`expected_root_metadata_revision`; native/Budget confirmation rejects a changed
proposal and checks current root snapshot authority before stored-file reads. Budget content
PUT is server-to-server: it additionally requires `Authorization: Bearer
<service-token>` and, for interactive uploads only,
`X-STRATOS-Actor-Authorization: Bearer <person-token>`. Service credentials must
never be passed to a browser. Budget preflight returns a credential-free
`required_authentication` descriptor alongside the exact file headers.

Before reading upload bytes or confirming stored bytes, the Budget web bridge asks Registry's dedicated
`POST /api/v1/integrations/stratos-budget-upload/documents/{document_id}/intake-authorization`
operation to validate signed coordinates against the stored document/source
lineage, exact current root profile revision and current central authority. This operation creates no local version
or ingestion job; it re-confirms the existing central Budget document root
idempotently. A live actor must also have current scoped upload authority.

Official-source collection invokes the authorized internal intake core; its
purpose is not accepted by the public HTTP upload endpoint. The previous
controlled-document and Budget content aliases are removed under ADR 0016.

Success is HTTP `201` and includes:

- `intake_status`;
- exact file metadata;
- bounded scanner metadata;
- opaque `upload_receipt`.

The caller must return both `upload_token` and `upload_receipt` in its
origin-specific confirmation request, together with the unchanged nested
`document_profile` returned by preflight. Budget preparation receives a root
`document_profile` and a `document_version_profile` draft; Registry supplies
the actual root revision before signing. See the
[profile cutover](STRATOS_DOCUMENT_INTAKE_HANDOFF.md#required-document-profile-cutover). The receipt is not a reusable bearer
credential. Registry verifies its HMAC, expiry and exact document ID, source
URI, filename, MIME type, byte size and SHA-256.

## Native confirmation recovery

`POST /api/controlled-document/ingestion` can be repeated after a lost Registry
or ingestion response. Native preflight reads the current Registry ingestion
attempt after authorization and signs its exact predecessor ID (including an
explicit `null`). Confirmation keeps that predecessor; it never substitutes the
new current job on retry. Tokens without this field require a new preparation.

Registry `POST /api/v1/documents/{document_id}/versions` binds native AKB versions
to a database-unique `(document_id, native_intake_session_hash)`, where the hash
comes from the HMAC-verified receipt's session ID. Migration
`0028_native_intake_identity` adds this nullable identity without guessing or
backfilling identities for existing versions or imported sources. A transaction
reserves the identity before central resource registration; independent
concurrent requests cannot admit a second version for that session.

Replay requires the same authenticated creator, current root revision, complete
version profile, effective policy and scope, version label, validity, change
summary, source location, file URI/name/type/size/hash, and the exact original
clean scanner receipt. A second scan of the same session cannot replace the
first receipt. Supplied `uploaded_by` cannot impersonate the native creator.
Registry rechecks both current root and exact version authority, including the
atomic current profile confirmation, before returning the saved version.
It preserves the original file, snapshot, admission proof, timestamps and state.
Fresh authority precedes stored-byte reads in the BFF on every attempt.

The first version creation returns HTTP `201`; exact replay returns HTTP `200`
with `version.idempotent_replay=true` in the native BFF result (the Registry
version response carries the flag directly). This is a response-only indicator,
not stored document state. The ingestion key remains
`controlled:{document_version_id}` with the dedicated web ingestion service
namespace. BFF verifies the deterministic returned job ID and exact version,
and attempts one immediate reconciliation of a pending authorization/claim.
Unresolved activation returns `503`, leaving the admitted version available for
the same authorized retry. Changed payloads or root revisions return a conflict;
changed or unavailable authority fails closed. Expired token/receipt proofs are
not extended by replay. Recovery does not publish or mark a draft effective.

Both native browser forms retain the exact serialized confirmation, token and
receipt in component memory after a successful content PUT. A lost confirmation
reply therefore offers a confirmation-only retry: it performs no new preflight,
upload or scan. File and metadata controls stay locked and keyboard focus returns
to the retry action. Ending the attempt explicitly opens the current document
detail so the operator can inspect any version already created. This in-page
recovery does not survive closing or reloading the page and does not make root
document creation idempotent. The browser does not persist these proofs in local
storage or extend their expiry.

Native creation and responsibility transfer keep the owner, authors, gestor and
uploading actor distinct. The denormalized `gestor_unit` is the exact unit ID for
an organizational gestor and `null` for a person; display labels are not IDs.
Missing or invalid profiles return `422` and malformed JSON returns `400` at the
web creation and assignment boundaries, before Registry writes.

Local verification on 2026-09-05 includes separate SQL sessions confirming one
file-backed SQLite version concurrently, and the same real HTTP race against
PostgreSQL 16 in a new temporary database migrated to the current Alembic head.
The PostgreSQL test checks the actual `0028` unique constraint and proves one
version, file and immutable profile snapshot. It creates and drops only its own
random test database; opt in with `AKB_NATIVE_REPLAY_TEST_POSTGRES_URL` pointed at
a disposable QA server. Actual BFF handler tests use real temporary stored
bytes and simulate lost upstream replies. These checks do not establish live
STRATOS acceptance or a production deployment.

## States and errors

The quarantine state exists before a durable Registry version is created.

| State | Meaning | Next action |
| --- | --- | --- |
| `pending_scan` | Binary exists only in temporary AKB quarantine. | Automatic scan. |
| `clean` | Type, size, hash and ClamAV verdict passed. | Promote and confirm. |
| `infected` | ClamAV returned `FOUND`. | Keep isolated; security event; no Registry version. |
| `scan_failed` | Timeout, connection failure, `ERROR` or invalid response. | Keep isolated; retry or reject; never mark clean. |
| `legacy_unattested` | Version predates mandatory intake. | Read-only migration state; rescan/reset before enforcement. |

Important response codes include:

- `UPLOAD_CONTENT_SIGNATURE_MISMATCH`;
- `CONTENT_SECURITY_FILE_TOO_LARGE`;
- `CONTENT_SECURITY_UNAVAILABLE`;
- `CONTENT_SECURITY_TIMEOUT`;
- `CONTENT_SECURITY_SCAN_ERROR`;
- `CONTENT_SECURITY_INVALID_RESPONSE`;
- `UPLOAD_MALWARE_DETECTED`;
- `document_intake_attestation_required`;
- `document_intake_attestation_invalid`;
- `document_intake_attestation_conflict`;
- `DOCUMENT_INTAKE_SCAN_REQUIRED`.

No error response or ordinary log contains the document body. Malware audit
metadata is limited to document/session identifiers, declared type, size,
result, timing and signature name where applicable.

## Limits

AKB applies the lowest applicable limit:

- origin-specific upload maximum;
- Document Intake maximum, default 100 MiB;
- ClamAV stream and recursive-analysis limits.

The current ClamAV profile is expected to allow at most 100 MiB per file,
approximately 400 MiB total analyzed data, 120 seconds and 17 archive levels.
An archive remains subject to all limits.

## Identity and roles

Interactive intake requires the current user and the existing scoped AKB
create/upload capability. Application intake requires the exact allowlisted
service identity for that integration and, where required, a separate current
person token. Requested scopes narrow access only.

Document workflow remains deliberately small:

- gestor: content, metadata and lifecycle owner;
- approver: independent governed decision when required.

The role catalog of Budget, ProjectFlow and ArchFlow is not duplicated in
AKB. Those applications decide who may initiate their domain action; AKB
decides whether the resulting document binary and document record may enter
the governed document estate.

The application-specific mapping and migration acceptance suite are defined in
`docs/integration/STRATOS_DOCUMENT_INTAKE_HANDOFF.md`.

## Operations

Required internal connection:

```text
hostname: scan.home.cz
port: 3310/TCP
protocol: clamd INSTREAM
network: shared service in the server VLAN
```

The scanner is not part of the AKB Docker Compose project and must not expose
a public port. Network policy limits access to approved application hosts.

Recommended production settings:

```text
STRATOS_CONTENT_SECURITY_MODE=clamd
STRATOS_CONTENT_SECURITY_REQUIRED=true
STRATOS_CONTENT_SECURITY_ENDPOINT=tcp://scan.home.cz:3310
STRATOS_CONTENT_SECURITY_CONNECT_TIMEOUT_MS=3000
STRATOS_CONTENT_SECURITY_SCAN_TIMEOUT_MS=120000
STRATOS_CONTENT_SECURITY_MAX_FILE_BYTES=104857600
```

`REQUIRED=false` is a non-production migration mode only. Production remains
fail-closed with `REQUIRED=true`.

`GET /api/ready` reports `document_intake_content_security`. A required or
configured scanner that is unavailable makes web readiness fail.

Scanner readiness verifies a well-formed ClamAV VERSION reply including engine
and database versions. It does not run INSTREAM, measure signature freshness or
prove end-to-end upload. A malformed VERSION reply also prevents creation of a
clean scan result with missing scanner metadata. The web readiness aggregate's
ingestion probe is liveness; full ingestion readiness requires its dedicated
operational identity.

## Retry and immutable evidence

An exact Budget replay may use a new signed upload session. The new token,
receipt and uploaded bytes still require full verification. Registry preserves
the original file, canonical URI and original scan attestation; confirmation
verifies and uses that original source for ingestion. Changed content or source
lineage fails. Redundant session objects are not deleted during confirmation,
because another retry may still need them. Durable expiration cleanup must
verify that an object is no longer referenced and that its retry window ended.

The clean target uses a coordinated client/server release with no compatibility
window or historical rescan phase; see ADR 0016 and the STRATOS handoff.

## Acceptance

The release must prove:

1. clean PDF, Office, image and text fixtures are accepted;
2. EICAR is rejected and absent from normal object storage and Registry;
3. hash, MIME, size, document ID and source URI tampering is rejected;
4. timeout, unavailable scanner and malformed response fail closed;
5. direct Registry creation without receipt fails in required mode;
6. direct ingestion of an unattested version fails before object read;
7. controlled and Budget upload paths both return the canonical content
   URL and preserve idempotency;
8. logs and audit contain no binary, extracted text, token or receipt.


Contract execution and extraction are separate states. The `akb.contract`
profile uses `record` lifecycle for `draft` and `terminated` evidence; signed
or effective contracts require explicit normative effectivity. A draft original
can pass the existing authorized ingestion flow for review and confirm reports
`document_version_status: "draft"`; extraction does not publish it or permit
current RAG retrieval. A centrally confirmed terminated record can be historical
evidence, but is not proof that the contract is currently in force. Consumers
must retain the returned workflow status and lifecycle/execution evidence and
must not equate `INDEXED` with approval or legal effectivity.

Each accepted byte path now persists a signed expiry manifest before its first
quarantine write. The manifest does not change the upload credential or receipt
wire format. Expired orphan cleanup uses a permanent Registry reference fence;
an attempt to attach a claimed object returns `409 intake_object_cleanup_claimed`
and requires a new session. Existing attached versions remain protected. Cleanup
requires a separate dedicated operator service; Budget, public-source collectors
and normal ingestion clients do not receive that grant. The canonical source URI
must be preserved exactly. Operational details and limits are in
[Intake object cleanup](../OPERATIONS/intake-object-cleanup.md).
