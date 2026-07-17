# Official Public Sources

AKB can import approved collections of original PDF, DOCX, reviewed HTML
catalog pages and explicitly approved structured open-data documents from official public authorities
without turning every item into a separately managed internal document
workflow.

## Product Model

- A document manager approves and starts one named collection in the
  **Public sources** workspace.
- Discovery follows only HTTPS URLs on the collection's explicit host
  allowlist. Redirects are checked again and IP-address destinations are
  rejected.
- Every file is downloaded by the AKB web backend, checked for the expected PDF,
  OOXML, reviewed HTML or collection-approved JSON signature, bounded by the normal upload
  limit, hashed and stored in AKB object storage.
- The canonical source URL and capture time are recorded on the immutable AKB
  version. Repeated synchronization is idempotent by collection plus canonical
  URL and SHA-256. A changed hash creates and publishes a new version; an
  unchanged hash does not create a duplicate.
- Collection approval authorizes the mechanical source-origin, file-type and
  hash checks. It does not bypass Registry authorization or Ingestion proofs.
  A manager with `akb:manage_document` starts the synchronization. Registry
  registers only the strictly marked public-reference document and version
  through the existing fixed `service:akb` identity, while retaining the
  manager as `metadata.auditActorSubjectId`. All central runtime decisions for
  a strictly marked official-public-reference document also use that fixed
  system identity. Local collection approval, audit and the exact
  web-to-Ingestion proof remain bound to the current manager; ordinary uploads
  continue to use their verified interactive bearer.
- AKB forwards the policy owner plus `issuedAt` and nullable `reviewAt` to the
  STRATOS Policy Registry. The Registry validates and immutably stores these
  metadata and AKB accepts only the authoritative matching response.
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

The source metadata uses:

- `source_model=official-public-reference-v1`
- `source_public=true`
- `audience=organization`
- `anonymous_publication=false`
- `collection_id`, `authority`, `canonical_url`, and `license_note`

## Pilot Catalog

The curated pilot target is 384 documents:

| Collection | Target | Mode |
| --- | ---: | --- |
| NÚKIB supporting materials | 70 | official-site discovery |
| Public procurement methods | 82 | official-site discovery |
| DIA architecture and eGovernment | 37 | official-site discovery |
| Selected EU legal acts | 33 | fixed CELEX catalog through the official Cellar dissemination API |
| Open FitSM IT service management | 25 | official-site discovery |
| Czech Statistical Office | 40 | official-site discovery plus reviewed HTML catalog pages |
| Czech legislation from e-Sbírka | 97 | credential-free official open data |

All seven collections are synchronizable without a new credential. The
EU-law connector downloads the official Czech XHTML expression from the
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

The e-Sbírka connector reads the legal-act JSON-LD description, selects the newest
effective version not later than the synchronization date and downloads its
ordered official fragments through the public SPARQL endpoint. The stable AKB
document identity uses the undated canonical e-Sbírka URL, so a later effective
version creates a new immutable AKB version instead of a duplicate document.
The open-data provider currently warns that identifiers and structure may still
change; synchronization therefore relies on the reviewed catalog, hashes and
idempotent replacement rather than undocumented scraping.

No additional Keycloak user or client is created for this workflow. It reuses
the existing `AKB_POLICY_SERVICE_TOKEN` mapped by STRATOS to `service:akb`.
Missing or invalid service credentials fail closed before an AKB document is
committed.

Licensed or copyrighted internal references, including organization-owned ITIL
copies, are not added to this public-source catalog. They are imported as
ordinary controlled documents with `classification=internal`, an
organization-only audience and explicit licensing metadata. Openly licensed
FitSM material remains in the public collection.

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
3. For a collection, select **Load catalog** and review the source count,
   authority and any warnings.
4. Select **Synchronize collection**. The browser uses two bounded workers.
   Leaving the page stops new browser requests but committed documents remain;
   running synchronization again resumes idempotently. Transient network,
   timeout, HTTP 429 and HTTP 5xx failures receive one automatic retry.
5. Verify that failures are zero and that newly created ingestion attempts reach
   `INDEXED`. A failed item can be retried by synchronizing the collection again.
6. Ask a representative question in Knowledge chat and verify that the answer
   cites the official authority and opens the stored original.

## Maintenance

The collection definitions and host allowlists are code-reviewed in
`apps/web/src/lib/public-sources/catalog.ts`. Discovery and synchronization are
implemented in the adjacent `discovery.ts` and `sync.ts` modules. A source is
never accepted only because a browser supplied its URL.
