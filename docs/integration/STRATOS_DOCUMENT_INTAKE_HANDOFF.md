# STRATOS handoff: AKB Document Intake V1

## Objective

Budget, ProjectFlow, ArchFlow, AIIP and other approved STRATOS applications
must use AKB as the only binary entry point for governed documents. A source
application remains the authority for its business action and local roles.
AKB remains the authority for document identity, binary integrity, malware
control, Information Policy, document lifecycle and ingestion.

No application should operate its own final document store or independently
declare a file clean. A local temporary attachment may exist only until AKB
returns a confirmed immutable document/version reference.

## Common flow

Each integration must perform the following sequence:

1. authorize the initiating action in the source application;
2. call its approved AKB preflight operation with the current actor and exact
   source resource lineage;
3. use the returned `upload_url`, which must be under
   `/api/document-intake/v1/sessions/{sessionId}/content`;
4. upload the exact signed MIME type, size and SHA-256;
5. receive `upload_receipt` only after AKB quarantine, file-signature checks
   and the configured ClamAV decision;
6. return the opaque token and receipt to the integration-specific confirm
   operation;
7. store only the returned AKB document ID, version ID and permitted deep
   links in the source application;
8. use AKB lifecycle/status operations for reconciliation and idempotent retry.

The receipt is opaque. Applications must not decode it, log it, persist it as a
business record or use it as an authorization token.

## Identity and authorization

Do not add a portfolio-wide upload role to source-application users.

- A human is authorized by the source application's current capability and
  scope for the business object.
- The integration uses its exact allowlisted service identity and audience.
- Where the contract requires actor binding, the current person token is
  separate from the service token.
- Requested scopes can narrow an operation only.
- Prompt text, metadata, forwarded headers and a source application's local
  administrator role cannot create AKB authorization.
- Registry continues to require the applicable AKB capability, such as
  `akb:upload` or `akb:manage_document`, through the approved projection or
  delegated integration contract.

The document workflow has only two user-facing responsibilities:

| Responsibility | Required | Purpose |
| --- | --- | --- |
| Gestor | Yes | Business correctness, metadata, classification proposal and lifecycle. |
| Approver | Conditional | Independent publication, classification, exception or domain-gate decision. |

One person may hold both responsibilities when the approved policy allows it.
Applications may keep richer operational roles for finance, projects, needs or
ideas, but must not copy those roles into AKB document assignments.

## Application mapping

| Application | Local authority before intake | AKB integration behavior |
| --- | --- | --- |
| Budget | User may perform the relevant contract, budget or evidence action in the covered scope. | Use the Budget upload bridge for current and historical batches; preserve tenant, project, contract and batch lineage. |
| ProjectFlow | User may attach or publish project evidence for the covered project/portfolio. | Use the generic governed STRATOS bridge with canonical project/resource lineage; store only AKB references after confirm. |
| ArchFlow | User may attach evidence to a need, assessment or handoff. | Bind the upload to the canonical need and current actor; do not infer Budget or ProjectFlow access. |
| AIIP | User may submit or assess the covered idea. | Use the dedicated AIIP document identity and governance contract; AIIP service credentials never call Registry, RAG or ClamAV directly. |
| SecurityPreflight | User or service may create approved assessment evidence. | Use a dedicated exact source namespace and classification ceiling; findings do not grant document access. |
| AKB web | Current projection contains the required upload/manage capability. | Interactive upload uses the controlled-document preflight and the same canonical binary endpoint. |
| Official source collector | Manager approved the source collection and URL allowlist. | Downloaded bytes pass through the same intake core; a public origin does not bypass scanning. |

## Required client changes

For every existing application:

1. reject a preflight response whose `upload_url` is outside the configured AKB
   origin or canonical Document Intake path;
2. send the binary once with the exact required headers;
3. treat `FOUND`, scanner error, timeout and HTTP `5xx` as incomplete intake,
   never as a clean upload;
4. include the returned `upload_receipt` unchanged in confirm;
5. make confirm idempotent on the integration's canonical lineage and SHA-256;
6. distinguish `pending_scan`, blocked, unavailable and confirmed states in its
   local UI without exposing scanner internals;
7. delete any temporary local copy according to the application's approved
   retry policy after confirmation;
8. never expose the ClamAV host or port outside the AKB private network.

## Acceptance

Each application must provide positive and negative fixtures proving:

- clean upload, confirm, immutable reference and lifecycle reconciliation;
- idempotent replay without another Registry version;
- changed hash under the same immutable version fails;
- MIME, size, token, receipt, actor and source-lineage tampering fails;
- EICAR and scanner unavailability create no Registry version;
- revoked or out-of-scope actor fails before binary acceptance;
- logs contain no binary, extracted content, person token, upload token or
  receipt;
- the source application cannot read or publish a document solely because it
  initiated the upload.

## Coordinated rollout

1. Deploy AKB with `STRATOS_CONTENT_SECURITY_MODE=clamd` and
   `STRATOS_CONTENT_SECURITY_REQUIRED=false`.
2. Migrate all source applications and observe clean/error counters.
3. Perform the planned non-production data reset or controlled rescan of
   legacy unattested files.
4. Run the cross-application acceptance suite and EICAR test.
5. Set `STRATOS_CONTENT_SECURITY_REQUIRED=true` in web, Registry and Ingestion
   as one coordinated release.
6. Remove legacy content URLs only after telemetry proves that no supported
   client uses them.

Production enforcement must not be enabled application by application. A
partially enforced estate can accept a file that a later stage refuses to
ingest.
