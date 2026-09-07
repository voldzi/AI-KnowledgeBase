# Official Public Sources

AKB prepares and imports centrally approved official-source documents under the
`akb.official-public-reference` profile. The AKB picker/client and strict intake
path are implemented; live collection approval and exact source preparation
require the new [STRATOS collections V1 contract](../integration/STRATOS_OFFICIAL_SOURCE_COLLECTIONS_V1.md).
Until that contract is jointly verified and configured, synchronization is
unavailable. The local discovery catalog does not grant approval.

## Product Model

- A permitted document manager selects a named collection from the fresh STRATOS
  approved-list projection in **Public sources**. The picker shows its issuer,
  owner, gestor, review rule and explicit TLP. No opaque authority IDs or policy
  JSON are entered by the user.
- Discovery follows only HTTPS URLs on the collection's explicit host
  allowlist. Redirects are checked again and IP-address destinations are
  rejected.
- Every file is downloaded by the AKB web backend, checked for the expected PDF,
  supported OOXML package (DOCX, PPTX or XLSX), reviewed HTML or
  collection-approved JSON signature, bounded by the normal upload
  limit, hashed and stored in AKB object storage.
- The canonical source URL and capture time are recorded on the immutable AKB
  version. Repeated synchronization is idempotent by collection plus canonical
  URL, SHA-256 and immutable version metadata. Reuse requires the same file
  metadata, root revision/hash, lifecycle and domain evidence. Changed content
  or immutable metadata creates a new version; earlier snapshots remain intact.
- Every synchronization freshly prepares the individual source in STRATOS. Its
  complete profile, explicit PUBLIC/TLP:CLEAR policy, issuer evidence, owner,
  gestor and lifecycle/domain evidence are validated before any original is
  downloaded. `sourceGovernedResourceId` identifies the individual upstream
  document; collection identity is separate.
- Registry creates or freshly admits the current root before downloading. AKB
  compares the returned canonical root hash/revision/profile and policy with the
  prepared source. Changed existing metadata returns a conflict requiring an
  explicit update with the current revision; a stale list projection never
  substitutes for fresh admission.
- The complete nested version proposal is signed with its expected root
  revision. Registry builds final source lineage from the verified file/receipt
  and requires central root/version snapshot confirmation before activation.
  Merely approved-looking metadata, `active: true` assignments or an official
  URL are not an authority proof. Root and version protection remains explicit.
- Failed indexing remains resumable. Re-running the collection retries the
  failed current attempt or continues from the first missing version.
- A transient browser request failure and a transient official-source download
  failure each receive one bounded retry. Only network/timeout failures, HTTP
  429 and HTTP 5xx are retryable; permanent source errors such as HTTP 404 stay
  visible in the collection result. Idempotent hashes prevent a retry from
  creating a duplicate document or version.

## Public Origin Is Not Anonymous Publication

Imported sources use `classification=public` because their origin is public,
but their default audience is the authenticated STRATOS organization. They are
immediately available to authorized AKB chat users after indexing. AKB does not
create an anonymous `InformationPublication` or public download page for them.
Anonymous publication remains a separate explicit governed lifecycle.

An active user with `akb:chat` and the synthetic `public` chat scope may use
only `rag.query` over an exact valid version of a document that satisfies the
complete `official-public-reference-v1` marker, metadata, policy and
organization-scope contract. This narrow path does not grant
`document.read`, does not expose source storage, and does not apply to an
archived, malformed or ordinary organization document. Identity, organization
membership, AKB application access, capability, candidate policy hash and exact
version validity still fail closed.

The source metadata uses:

- `source_model=official-public-reference-v1`
- `source_public=true`
- `audience=organization`
- `anonymous_publication=false`
- `collection_id`, `authority`, `canonical_url`, and `license_note`

## Pilot Catalog

The curated technical discovery target is 385 documents; this count is not a count of centrally approved imports:

| Collection | Target | Mode |
| --- | ---: | --- |
| NÚKIB supporting materials | 70 | official-site discovery |
| Public procurement methods | 82 | official-site discovery |
| DIA architecture and eGovernment | 37 | official-site discovery |
| Selected EU legal acts | 33 | fixed CELEX catalog through the official Cellar dissemination API |
| Open FitSM IT service management | 25 | official-site discovery |
| Czech Statistical Office | 40 | official-site discovery plus reviewed HTML catalog pages |
| Czech legislation from e-Sbírka | 98 | credential-free official open data |

All seven technical discovery adapters can read the public catalogs without
source credentials. Intake additionally requires a permitted interactive STRATOS
actor, an active centrally approved collection and exact source preparation;
this is not established by the adapter catalog. The EU-law connector downloads the official Czech XHTML expression from the
Publications Office Cellar API with the CELEX identifier and retains EUR-Lex as
the canonical human reference. XHTML is used consistently because Cellar does
not expose one-file Czech PDFs for every selected act, while the official XHTML
expression is complete and directly indexable. The connector does not scrape
the browser-facing EUR-Lex site or depend on its interactive WAF challenge.
Cellar's legacy same-host HTTP redirect is upgraded back to HTTPS before
download; redirects to HTTP or to another host remain rejected.

The Czech Statistical Office collection includes reviewed official HTML
originals for the product catalog, subscription products, open data, databases,
applications, classifications and methodological overview. These pages cover
questions that cannot be answered from annual statistical-program PDFs alone.
HTML is accepted only for collections with an explicit code-reviewed
`allowHtml` flag and remains subject to the same host allowlist, byte limit,
content signature, immutable hash and Registry policy as file downloads.

The e-Sbírka connector reads the legal-act JSON-LD description and selects the
effective versions needed to cover the timeline from 2023 through the
synchronization date. For each selected permanent URL it asks the public
e-Sbírka download catalogue for the informative PDF, waits for the bounded
public preparation job when necessary and accepts only a size-bounded response
with a valid PDF signature. The initial preparation response uses
`stavPozadavku`, while the public status endpoint uses `stav`; AKB validates
the two contracts separately. This avoids dependence on mutable RDF fragment
identifiers while retaining the official source and exact effective date. The
stable AKB document identity uses the undated canonical e-Sbírka URL, so each
effective text becomes an immutable version of one document instead of a
duplicate document. Download catalogue responses, preparation states and file
identifiers are validated and cannot redirect the intake outside the approved
e-Sbírka origin.

No user/client or central collection is created automatically by AKB. The new
collection/proposal API forwards the current interactive actor's bearer only to
the configured STRATOS origin, without redirects. Public source downloads never
receive that bearer. Registry's documented governance identity and fresh
admission contracts remain separate from this source preparation operation.
Missing configuration, unknown upstream endpoints or invalid central responses
fail closed before downloading.

Licensed or copyrighted internal references, including organization-owned ITIL
copies, are not added to this public-source catalog. They are imported as
ordinary controlled documents with `classification=internal`, an
organization-only audience and explicit licensing metadata. Openly licensed
FitSM material remains in the public collection.

The bundled `cz_public_governance_eval` silver evaluation dataset exercises
ordinary-employee questions over statistical service, eGovernment, digital
services, public procurement and open data. Production runs must provide
`subject_id_override` for an active test user with the standard AKB employee
profile; a no-answer or missing citation is a regression.

## Search Indexes

Registry/PostgreSQL remains authoritative for document identity, versions,
workflow, policy and audit, while object storage remains authoritative for the
immutable source bytes. Qdrant and OpenSearch are rebuildable derived indexes:

- Qdrant supplies semantic vector retrieval.
- OpenSearch supplies Czech BM25 retrieval over exact titles, legal
  identifiers, articles, paragraphs, product names and domain terminology.
- RAG combines the ranked lists and still performs Registry authorization
  before returning evidence.

Production ingestion writes every new chunk to both indexes. Environments that
already contain Qdrant chunks must run
`scripts/backfill_opensearch_from_qdrant.py` and verify equal chunk counts
before switching `AKL_RAG_FULLTEXT_MODE` to `opensearch`.

## Operator Procedure

1. Sign in with an AKB profile that has `akb:manage_document` and the effective
   update, publish and ingest actions.
2. Open **Public sources**.
3. Select a centrally approved collection by name. Review the displayed issuer,
   owner, gestor, review rule and TLP, then select **Load catalog** and review the
   candidate count and warnings. If approvals are unavailable, retry the approval
   list or ask the STRATOS administrator; importing remains disabled.
4. To update only a legal or thematic subset, enter one or more titles or act
   numbers separated by commas, semicolons or new lines. Review the matching
   count and choose **Synchronize selection**. Leave the field empty only when
   the whole collection is intended. The e-Sbírka collection uses one bounded
   worker to preserve the temporal order; other collections use two. Leaving
   the page stops new browser requests but committed documents remain; running
   synchronization again resumes idempotently. Transient network, timeout,
   HTTP 429 and HTTP 5xx failures receive one automatic retry. Approval or current
   root conflicts stop further candidates and require refreshed approval; an
   already in-flight candidate still passes its own fresh admission gates.
5. Verify that failures are zero and that newly created ingestion attempts reach
   `INDEXED`. A failed item can be retried by synchronizing the collection again.
   When a previously captured OOXML original has the correct content hash but
   legacy file-type metadata, synchronization creates a corrective immutable
   version with the detected DOCX, PPTX or XLSX metadata and keeps the earlier
   version in the audit history.
6. Ask a representative question in Knowledge chat and verify that the answer
   cites the official authority and opens the stored original.

## Maintenance

The collection definitions and host allowlists are code-reviewed in
`apps/web/src/lib/public-sources/catalog.ts`. Discovery and synchronization are
implemented in the adjacent `discovery.ts` and `sync.ts` modules. A source is
never accepted only because a browser supplied its URL. The new optional web
setting `AKL_STRATOS_OFFICIAL_SOURCES_URL` defaults to empty. Configure it only
after the joint collections/prepare and final Registry snapshot-admission
acceptance in the integration handoff. No collection-level rollout or upstream
readiness is inferred from passing local fixture tests.
