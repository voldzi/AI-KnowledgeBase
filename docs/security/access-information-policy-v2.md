# STRATOS Access And Information Policy V2

## Accepted Contract

AKB G2/G3 accepts these exact versions:

- `stratos-access-1`
- `information-policy-2.0.0`
- `stratos-integration-envelope-1`

The byte-identical snapshot and conformance fixtures are under
`contracts/stratos/`. Run `scripts/verify_stratos_contract_snapshot.py` before
integration acceptance. Contract changes require a versioned replacement and
an impact review; unknown versions, obligations, bindings, or legal
classifications fail closed.

## Access Decision

For a `stratos-access-1` principal, AKB requires all of the following:

1. active identity, organization membership, and AKB application access;
2. `organizationId=org_stratos`;
3. the operation-specific `akb:*` capability;
4. a scope matching the document policy audience;
5. a valid current Information Policy V2 binding.

Global roles `stratos_user` and `stratos_admin` do not grant document content,
administration, or export by themselves. In particular, `stratos_admin` still
requires `akb:manage_access` for AKB administration. Registry remains the
authoritative enforcement point; web navigation is only progressive
disclosure.

The Keycloak token is accepted only after signature, issuer, audience, and
expiry verification and serves only as identity proof. For users, web and
Registry load the current AKB projection from STRATOS `GET /api/v1/auth/me`
using the user's bearer token. Capabilities, scopes, active membership, and AKB
application access are not read from `stratos_access`, top-level token claims,
or client headers. Missing, malformed, rejected, expired, or unavailable
projection data fails closed. The default projection cache TTL is zero; any
configured cache is bounded by token expiry.

Service-to-service document and audit decisions use STRATOS
`POST /api/v1/policy/decisions` with an AKB runtime credential and delegated
actor subject. Production callers cannot delegate roles, capabilities, scopes,
or active flags through `X-AKL-*`, `X-STRATOS-*`, or authz request fields.
Those inputs exist only in explicit mock/E2E mode.

Every production document operation also sends the concrete stored resource
scope to the central decision endpoint. AKB does not replace an
`organization_unit:it` or `project:*` scope with organization-wide scope. A
deactivated or unrelated scope therefore fails immediately even if an older
projection or index entry still exists.

Legacy AKB roles remain as an explicit pre-reset compatibility path only for
mock/local execution. They are not part of the new epoch and must not be
assigned by the G7 Keycloak baseline.

## Policy Inheritance

Upload admission validates the binding and integration envelope before binary
storage. The document and each immutable version store:

- organization id;
- policy binding id and policy version;
- canonical `sha256:` policy hash;
- policy summary used for local decisions.

They additionally store the central `GovernedInformationResource` id,
immutable source version, parent id, concrete registered scope, registration
status, and registration timestamp. User operations register with the verified
user bearer. External service upserts use the AKB runtime token only together
with `actorSubjectId` taken from the validated integration envelope; STRATOS
then reloads that actor and rechecks active identity, membership,
`akb:assign_policy`, and the active scope. The service token alone grants
nothing, and a missing delegated actor fails closed. `akb:upload` deliberately
does not imply `akb:assign_policy`. Because AKB has no safe `POLICY_PENDING`
read model, a denied resource registration aborts the complete document or
version write; no readable deferred record is created. Child scope must equal
the parent scope or be its active registered descendant. AKB never creates a
new governance scope as a side effect of an upload.

The same binding reference is inherited by extracted chunks, embeddings,
Qdrant payloads, OpenSearch payloads, RAG answers, citations, source-open tokens,
and controlled exports. Qdrant and OpenSearch retrieval bind an authorized
`document_id` to its current policy hash. A stale or missing hash is excluded.
Citation and source-open re-read Registry state before returning source bytes.
RAG authorization also binds every candidate to a currently `valid` immutable
`document_version_id`; archiving or superseding the version denies stale index
content immediately.

TLP:RED is not treated as a rank. It requires `recipient_set`, explicit
recipient subject ids, and an originator. Only an explicit recipient may read.

## AI And Export Obligations

The LLM Gateway receives the most restrictive handling class and the union of
obligations inherited from all selected chunks. Local providers may process up
to `RESTRICTED`. External providers reject:

- missing policy metadata;
- `RESTRICTED` content;
- `NO_EXTERNAL_AI`;
- `LOCAL_PROCESSING_ONLY`;
- classified or unknown policy input.

Export requires `akb:export`. `NO_EXPORT` is denied, and obligations such as
`WATERMARK` must be fulfilled rather than silently ignored. Prompts, answers,
document bodies, bearer tokens, and credentials are not logged.

The export bridge does not trust policy ids, hashes, or obligations posted by
the browser. It extracts every cited document/hash from the normalized report,
requests a fresh `rag.export` decision for each source, verifies the current
hash, unions authoritative obligations, and only then generates XLSX/PDF. The
assistant hides export formats when any source denies export. Metadata-only
reports without immutable cited source snapshots are view-only and also hide
export formats.

## Organization Audience Versus True Public

`handlingClass=PUBLIC` or an AKB legacy `classification=public` does not make a
document anonymous. Organization audience still requires OIDC, AKB capability,
scope, and source policy. True public additionally requires an unscoped
`audience.scopeType=public`, `PUBLIC_INFORMATION`, `AUDIT_ACCESS`, allowed
TLP/PAP and no export-prohibiting obligation, followed by an active central
`InformationPublication` and a fresh no-store public decision.

AKB currently has no anonymous content-delivery endpoint bound to that central
publication lifecycle. This is intentional fail-closed behavior: the existing
source-content route requires an authenticated source-open decision and a
short-lived signed token. A future public endpoint must deliver a separately
approved immutable representation, call
`POST /api/v1/policy/public-decisions` on every read/download, emit
`Cache-Control: no-store`, and stop serving immediately after revoke. Until
that endpoint exists, AKB content is not anonymously public.

## Integration Envelope

External upload accepts only `stratos-integration-envelope-1`. Its organization,
binding id/version/hash, and classification must equal the supplied policy.
Only safe envelope metadata is retained for audit and idempotency. The payload
does not override AKB authorization, ingestion, DLP, or audit behavior.
