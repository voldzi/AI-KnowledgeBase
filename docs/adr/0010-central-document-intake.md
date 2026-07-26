# ADR 0010: Central AKB Document Intake

## Status

Accepted for implementation on 2026-07-26.

## Context

AKB receives documents from authenticated employees, STRATOS applications and
controlled public-source collectors. Separate binary upload implementations
would create inconsistent malware, format, integrity, retention and audit
controls. Requiring a person to approve every technically clean upload would
add work without improving the decision.

## Decision

AKB is the sole authority for accepting document binaries into the STRATOS
document estate. Every supported origin uses the versioned Document Intake
content endpoint:

```text
PUT /api/document-intake/v1/sessions/{sessionId}/content
```

Origin-specific preflight and confirmation operations remain temporarily
available because they enforce different actor, service-identity, governance
and idempotency contracts. They all issue the same signed session format,
return the canonical content URL and execute the same intake implementation.
Legacy content URLs are compatibility adapters to that implementation and
cannot bypass it.

The intake sequence is:

1. authenticate the person or exact source-application service identity;
2. validate the signed session, declared type, size and SHA-256;
3. write only to an AKB quarantine location;
4. verify the file signature against its declared type;
5. scan the bounded stream through internal ClamAV `INSTREAM`;
6. retain infected or failed items outside normal storage;
7. publish only a clean item to immutable object storage;
8. issue a signed `akb-document-intake-receipt-1`;
9. make Registry verify that receipt against the exact immutable file;
10. permit ingestion only when Registry carries the required clean attestation.

Scanner failure, timeout, malformed response and `FOUND` fail closed. Neither a
filename nor successful format validation is evidence that a file is clean.
The ClamAV port stays private on the application network.

## Human responsibilities

Technical controls are automatic. Normal clean uploads do not wait for a
person.

- The **gestor** owns the document's business correctness, metadata and
  lifecycle.
- The **approver** is required only where publication, classification,
  exception or a governed business workflow requires an independent decision.
- One person may hold both responsibilities when organizational policy permits
  it. Cardinality and separation-of-duty rules remain configurable.

Source applications keep their domain roles and permissions. They do not gain
AKB document-management authority. Their exact service identity may submit a
binary, while the current user remains the recorded business actor where the
integration contract requires one. Global role names, prompt text and
unverified headers cannot authorize intake.

The binding for current STRATOS applications is maintained in
`docs/integration/STRATOS_DOCUMENT_INTAKE_HANDOFF.md`.

## Rollout

`STRATOS_CONTENT_SECURITY_REQUIRED=false` is a migration state, not the target
security posture. In this state new files are still scanned when
`STRATOS_CONTENT_SECURITY_MODE=clamd`, but legacy unattested versions remain
readable. Promotion to `true` requires:

1. healthy ClamAV readiness and clean positive/negative smoke tests;
2. removal or controlled rescan of legacy unattested test data;
3. confirmation that every current source application uses the signed receipt;
4. zero unexpected `document_intake_attestation_invalid` events;
5. backup and rollback evidence for the Registry migration.

After promotion, Registry rejects every new file-bearing version without an
exact clean attestation, and ingestion rejects an unattested version before
reading its object.

## Consequences

- There is one binary security boundary and one audit vocabulary.
- Applications no longer implement their own malware decisions.
- Existing business APIs remain compatible while migrating to the canonical
  route.
- Upload latency includes the malware scan. Large-file asynchronous intake can
  be added later without changing receipt or Registry semantics.
- ClamAV detects known malware; it does not replace DLP, Information Policy,
  sandboxing, OCR hardening or business approval.
