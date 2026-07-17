# Official Public Sources

AKB can import approved collections of original PDF, DOCX and explicitly
approved structured open-data documents from official public authorities
without turning every item into a separately managed internal document
workflow.

## Product Model

- A document manager approves and starts one named collection in the
  **Public sources** workspace.
- Discovery follows only HTTPS URLs on the collection's explicit host
  allowlist. Redirects are checked again and IP-address destinations are
  rejected.
- Every file is downloaded by the AKB web backend, checked for the expected PDF,
  OOXML or collection-approved JSON signature, bounded by the normal upload
  limit, hashed and stored in AKB object storage.
- The canonical source URL and capture time are recorded on the immutable AKB
  version. Repeated synchronization is idempotent by collection plus canonical
  URL and SHA-256. A changed hash creates and publishes a new version; an
  unchanged hash does not create a duplicate.
- Collection approval authorizes the mechanical source-origin, file-type and
  hash checks. It does not bypass Registry authorization or Ingestion proofs.
  Each version still uses the current actor, Registry policy binding and exact
  web-to-Ingestion delegated proof.
- AKB forwards the policy owner plus `issuedAt` and nullable `reviewAt` to the
  STRATOS Policy Registry. The Registry validates and immutably stores these
  metadata and AKB accepts only the authoritative matching response.
- Failed indexing remains resumable. Re-running the collection retries the
  failed current attempt or continues from the first missing version.

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

The curated pilot target is 354 documents:

| Collection | Target | Mode |
| --- | ---: | --- |
| NÚKIB supporting materials | 70 | official-site discovery |
| Public procurement methods | 82 | official-site discovery |
| DIA architecture and eGovernment | 37 | official-site discovery |
| Selected EUR-Lex acts | 26 | fixed CELEX catalog |
| Open FitSM IT service management | 25 | official-site discovery |
| Czech Statistical Office | 24 | official-site discovery |
| Czech legislation from e-Sbírka | 90 | credential-free official open data |

All seven collections are synchronizable without a new credential. The
e-Sbírka connector reads the legal-act JSON-LD description, selects the newest
effective version not later than the synchronization date and downloads its
ordered official fragments through the public SPARQL endpoint. The stable AKB
document identity uses the undated canonical e-Sbírka URL, so a later effective
version creates a new immutable AKB version instead of a duplicate document.
The open-data provider currently warns that identifiers and structure may still
change; synchronization therefore relies on the reviewed catalog, hashes and
idempotent replacement rather than undocumented scraping.

## Operator Procedure

1. Sign in with an AKB profile that has `akb:manage_document` and the effective
   update, publish and ingest actions.
2. Open **Public sources**.
3. For a collection, select **Load catalog** and review the source count,
   authority and any warnings.
4. Select **Synchronize collection**. The browser uses two bounded workers.
   Leaving the page stops new browser requests but committed documents remain;
   running synchronization again resumes idempotently.
5. Verify that failures are zero and that newly created ingestion attempts reach
   `INDEXED`. A failed item can be retried by synchronizing the collection again.
6. Ask a representative question in Knowledge chat and verify that the answer
   cites the official authority and opens the stored original.

## Maintenance

The collection definitions and host allowlists are code-reviewed in
`apps/web/src/lib/public-sources/catalog.ts`. Discovery and synchronization are
implemented in the adjacent `discovery.ts` and `sync.ts` modules. A source is
never accepted only because a browser supplied its URL.
