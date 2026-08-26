# AKB Application Administration Guide

## Document control

| Field | Value |
| --- | --- |
| Status | Draft; behavior verified from current route and authorization catalogs |
| Evidence baseline | AKB `6405261f9279031bb090a85930fad61397fafe47`, 2026-08-26 |
| Owner | AKB application owner |
| Approvers | Security, records-management and platform owners |
| Classification | Internal |

## Administrative planes

AKB administration is deliberately split. No single browser role should own
all three planes by default.

| Plane | Typical owner | Scope |
| --- | --- | --- |
| Content administration | Document manager, owner/gestor, approver | Metadata, versions, attachments, workflow, controlled packages, publication |
| Access administration | Authorized AKB access administrator plus central IAM owner | Directory lookup, AKB role mappings, capability/scope projection verification, session revocation |
| Platform administration | Release/platform/database/security operators | Images, configuration, secrets, stores, monitoring, backup and recovery |

The browser administration surface is not a Keycloak admin console, database
console, object-store browser or deployment tool.

## Canonical authorization model

Navigation is a usability projection only. Server route guards, Registry
authorization and Information Policy remain authoritative.

| Capability family | User-visible purpose | Does not grant |
| --- | --- | --- |
| `akb:access` | Enter the AKB application | Document read, chat or administration by itself |
| `akb:chat` | Use the governed knowledge chat | Unfiltered document or live-source access |
| `akb:read_document` | Read only specifically authorized documents/versions | Upload, edit, approve or publish |
| document management capability | Create metadata and manage allowed versions/workflows | Audit or platform administration unless separately granted |
| audit capability | Read authorized audit/diagnostic metadata | Document content or mutation by itself |
| admin capability | Manage supported AKB-local role mappings and admin surfaces | Central IAM/Keycloak superadmin or policy bypass |

Exact action names and role mappings are code contracts in Registry and
`apps/web/src/lib/auth/authorization.ts`; the route matrix is documented in
`docs/ui/information-architecture.md`. Do not maintain a second manually
invented role catalog in a deployment appendix.

In integrated production, current STRATOS access projection is the authority
for application capabilities and scopes. Registry-local role mappings may
narrow or support application workflows but cannot override missing central
access or policy.

## Baseline employee access

A normal active employee may receive `akb:access`, `akb:chat` and
`akb:read_document` with `public` and
`recipient_set:employee-directives` scopes. This recipient scope is not a broad
internal-document grant. Registry still requires an effective valid controlled
package, source type `internal_directive`, suitable metadata, an allowed
classification and an organization-wide internal Information Policy.

The employee can read the published directive and ask cited questions but
cannot edit, approve, publish, export protected material or inspect technical
audit unless separately authorized.

## Identity and access tasks

### Grant or change application access

Prerequisites: approved request, owner, expiry/review date and separation-of-
duties check.

1. Find the person through the approved organization directory integration.
2. Select the minimum AKB role/capability and scope required.
3. Record reason, owner, effective date and expiry where supported.
4. Verify the fresh STRATOS projection, not only the UI label.
5. Test one allowed and one denied route/action as the subject or through an
   approved role preview.

Expected: the shell shows only authorized areas; a direct URL to another area
is denied or redirected; Registry denies unauthorized actions.

Rollback: deactivate the mapping/grant and revalidate. Do not delete audit
history.

### Remove access

Deactivate the central application grant or the specific AKB capability/scope.
Revoke relevant AKB sessions when immediate termination is required. Within the
configured identity validation interval, and on every fresh projection/policy
decision, the user must lose access. Verify direct document source, citation,
chat history and live-tool routes as well as navigation.

### Revoke sessions

AKB supports local logout, one-device revocation and all-session revocation.
Session records may be inspected only as metadata. Never export encrypted
tokens, selector hashes or cookie values. Key rotation is a controlled global
logout when old payloads cannot be decrypted.

### Service identity administration

For every machine client record:

- exact client ID and service-account subject;
- one expected audience per target route;
- minimum realm/client role;
- explicit default-deny route grant;
- secret owner, storage path, rotation and expiry evidence;
- positive and negative authorization tests.

A service-looking role without the allowlisted client identity is denied.
Never reuse a browser client, a person's token or another service's credential.

## Content administration

### Create a document and first version

1. Choose the canonical document type, classification, owner/gestor and a
   distinct approver.
2. Add descriptive metadata and scope; do not place access rules only in free
   text or tags.
3. Upload the source through Document Intake. The file remains quarantined until
   malware scan and durable storage succeed.
4. Confirm the immutable version and monitor ingestion.
5. Review extracted content, rendition, citations and warnings.
6. Complete workflow and publish only the exact reviewed version.

Expected: draft metadata is not presented as a valid publication; the current
pointer advances only through the governed workflow.

### Add attachments

Attach each source to the exact parent version. Confirm label, purpose, hash,
classification and policy alignment. An attachment never inherits access merely
from visual proximity in the UI. Verify it can be opened by an authorized user
and is denied to another subject.

### Replace with a new version

Create a new immutable version; do not overwrite the previous object or row.
Set the effective/validity window and change summary, repeat ingestion/review,
then supersede the prior version through the workflow. Historical citations
must continue resolving to the exact old version for authorized users.

### Controlled documentation and rules

1. Create a package from exact approved document versions.
2. Set source type, effective date and precedence metadata.
3. Generate extraction proposals using the versioned profile.
4. A gestor verifies each rule, citation, unit, tax basis, scope and normative
   key. Low-confidence or malformed proposals are not decision eligible.
5. Approve the package and declare it valid only after relevant rules are
   verified.
6. Test current and historical dates plus `no_data` and `conflict` outcomes.

Law outranks a conflicting internal directive. An internal rule remains
available only where it supplements a matter the law does not govern. Do not
edit authority rank or normative key merely to obtain a preferred answer.

### Official/public sources

Use only approved allowlisted source collections. Preserve canonical URL,
capture time, signature/hash and effective version. A web page changing later
does not rewrite the previously captured immutable version.

## Operational administration

### Ingestion supervision

Review queued/running/completed/warning/failed/cancelled jobs by immutable
version. Investigate parser, OCR, rendition, embedding, Qdrant and OpenSearch
separately. Retry idempotently; do not create duplicate documents or mark a
partial pipeline `INDEXED`.

### Index maintenance

Rebuild under a new collection/index revision and validate counts, scopes,
citations and negative authorization before switching the alias/current
collection. Qdrant/OpenSearch are derived; Registry and source objects remain
canonical.

### Audit and exports

Audit views contain metadata-level events and correlation IDs. Export only the
currently authorized filtered rows. Logs and audit must not include tokens,
secrets, cookie values, document bodies, prompts, answers or full cited
passages.

## Role-based UI expectation

| User family | Expected primary areas |
| --- | --- |
| Employee/reader | Chat, authorized published Documents/controlled documentation, Help |
| Reviewer or gestor | Dashboard, Tasks, Documents, Chat, Help |
| Document manager | Operations, Documents, Ingestion, Intelligence, Chat, Help |
| Analyst | Dashboard, Documents, Intelligence, Chat, Help |
| Auditor/governance | Dashboard, Tasks, Documents, Intelligence, Audit, Chat, Help |
| AKB admin | All AKB application areas; no implicit infrastructure or Keycloak superadmin |

If the UI exposes an area or action outside this projection, treat it as a
usability/security defect even if the backend correctly denies the request.

## Related evidence

- `docs/ui/information-architecture.md`
- `docs/security/stratos-identity-access-management.md`
- `docs/security/access-information-policy-v2.md`
- `docs/ARCHITECTURE/temporal-controlled-documentation.md`
- `docs/OPERATIONS/external-environment-runbook.md`
