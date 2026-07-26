# AKB Document Intake V1

## Purpose

Document Intake is the single AKB-controlled binary entry point for documents
uploaded by a person, submitted by a STRATOS application or collected from an
approved internet source. It covers directives, policies, laws, contracts,
project material, AIIP records and other allowlisted document formats.

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

Success is HTTP `201` and includes:

- `intake_status`;
- exact file metadata;
- bounded scanner metadata;
- opaque `upload_receipt`.

The caller must return both `upload_token` and `upload_receipt` in its
origin-specific confirmation request. The receipt is not a reusable bearer
credential. Registry verifies its HMAC, expiry and exact document ID, source
URI, filename, MIME type, byte size and SHA-256.

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

The role catalog of Budget, ProjectFlow, ArchFlow and AIIP is not duplicated in
AKB. Those applications decide who may initiate their domain action; AKB
decides whether the resulting document binary and document record may enter
the governed document estate.

The application-specific mapping and migration acceptance suite are defined in
`docs/integration/STRATOS_DOCUMENT_INTAKE_HANDOFF.md`.

## Operations

Required internal connection:

```text
hostname: clamav
port: 3310/TCP
protocol: clamd INSTREAM
network: akl_app_zone only
```

Recommended production settings:

```text
STRATOS_CONTENT_SECURITY_MODE=clamd
STRATOS_CONTENT_SECURITY_REQUIRED=false
STRATOS_CONTENT_SECURITY_ENDPOINT=tcp://clamav:3310
STRATOS_CONTENT_SECURITY_CONNECT_TIMEOUT_MS=3000
STRATOS_CONTENT_SECURITY_SCAN_TIMEOUT_MS=120000
STRATOS_CONTENT_SECURITY_MAX_FILE_BYTES=104857600
```

Keep `REQUIRED=false` only during the measured migration. Set it to `true`
after current source applications and corpus data satisfy ADR 0010.

`GET /api/ready` reports `document_intake_content_security`. A required or
configured scanner that is unavailable makes web readiness fail.

## Acceptance

The release must prove:

1. clean PDF, Office, image and text fixtures are accepted;
2. EICAR is rejected and absent from normal object storage and Registry;
3. hash, MIME, size, document ID and source URI tampering is rejected;
4. timeout, unavailable scanner and malformed response fail closed;
5. direct Registry creation without receipt fails in required mode;
6. direct ingestion of an unattested version fails before object read;
7. controlled, AIIP and Budget upload paths all return the canonical content
   URL and preserve idempotency;
8. logs and audit contain no binary, extracted text, token or receipt.
