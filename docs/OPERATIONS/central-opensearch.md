# Central OpenSearch Operations

This runbook covers the AKB production connection to the centrally operated
OpenSearch cluster. Local development keeps the optional Compose OpenSearch
service; `docker.home.cz` does not.

## Production Contract

| Item | Value |
| --- | --- |
| Endpoint | `https://opensearch.home.cz:9200` |
| OpenSearch version | `3.7` |
| AKB write alias | `akl_document_chunks` |
| Initial physical index | `akl_document_chunks_v1` |
| Topology | 1 primary shard, 2 replicas |
| Ingestion identity | `akl_ingestion_writer` |
| RAG identity | `akl_rag_reader` |
| CA source | `/srv/akl/env/opensearch-root-ca.pem` |
| Ingestion password source | `/srv/akl/env/akl-opensearch-ingestion.password` |
| RAG password source | `/srv/akl/env/akl-opensearch-rag.password` |

Passwords never belong in the Compose file, environment file, command line,
logs, Git, deployment records, or monitoring labels. The production Compose
mounts the CA and the role-specific password file read-only. The services read
the password once at startup, prefer the file over the local-development direct
value, use Basic Auth, and build a validating TLS context from the mounted CA.
Certificate validation is never disabled.

Ingestion must use only the writer account. RAG must use only the reader
account. The reader may search but cannot refresh, update mappings, bulk-write,
or delete. Neither account may read cluster-root or security-index APIs.

## Alias And Mapping

`akl_document_chunks` is a managed write alias. Production sets:

```env
AKL_OPENSEARCH_AUTO_CREATE_INDEX=false
```

Ingestion checks `GET /akl_document_chunks` and performs an idempotent
`PUT /akl_document_chunks/_mapping`. A missing alias is a readiness/deployment
failure; AKB must not create a physical index named after the alias.

Every chunk contains a keyword `authorization_key`. It is the SHA-256 digest of
the exact `(document_id, document_version_id, policy_hash)` coordinate.
Intelligence queries use one bounded `terms` filter over these keys instead of
one Boolean branch per authorized document. Invalid or empty coordinates
produce `match_none`; authorization remains fail-closed without raising the
cluster Boolean-clause limit.

## Rebuild From Qdrant

OpenSearch is a rebuildable retrieval index, not a canonical data store. Never
copy a Docker volume or Lucene files between OpenSearch 2.x and 3.x.

Capture the source/reference counts before the rebuild:

```text
chunks
distinct document_id
distinct document_version_id
chunks with entity_pairs
classification and policy-field missing counts
```

Run the immutable script from the active release inside the ingestion
container. It receives only file paths, never a password value:

```bash
cd /srv/akl/current
docker compose \
  --project-name akl \
  --env-file /srv/akl/env/akl.prod.env \
  -f infra/docker-compose/docker-compose.docker-home.yml \
  exec -T ingestion-service \
  python - \
    --qdrant-url http://qdrant:6333 \
    --qdrant-collection akl_document_chunks \
    --opensearch-url https://opensearch.home.cz:9200 \
    --opensearch-index akl_document_chunks \
    --opensearch-username akl_ingestion_writer \
    --opensearch-password-file /run/secrets/akl-opensearch-password \
    --opensearch-ca-file /run/secrets/opensearch-root-ca.pem \
    --no-create-index \
  < scripts/backfill_opensearch_from_qdrant.py
```

The script verifies the alias, updates the mapping, bulk-upserts every Qdrant
payload, adds the authorization key, explicitly refreshes, and prints aggregate
counts only. It does not mutate Registry, object storage, Qdrant, document
versions, classifications, policy bindings, or source files.

The separate entity backfill supports the same username, password-file, and CA
arguments. Use it only when Qdrant payloads do not already contain current
entity metadata.

## Verification

All checks must use the mounted CA and a transient Basic Auth configuration.
Do not print the configuration or password. Required results:

- reader: count/search `200`, refresh/write `403`;
- writer: count, mapping update, bulk, delete-by-query, refresh `200`;
- both identities: cluster root and security-index access `403`;
- Ingestion authenticated readiness: `ready`;
- RAG readiness: `ready`;
- BM25 fulltext, entity, facet, relationship, and analyst queries return
  authorized evidence only;
- final chunk/document/version/entity counts match the captured Qdrant and
  previous-index reference, with every deviation explained;
- no chunk is missing `document_id`, `document_version_id`, `classification`,
  `policy_binding_id`, `policy_hash`, or `authorization_key`.

For the writer mutation check, use a uniquely named disposable sentinel
document, refresh it, search it, delete it by query, refresh again, and prove
that the final sentinel count is zero. Never run delete-by-query against a
business document selector.

## Cutover And Local Cleanup

Deploy the migration only from a clean reviewed commit through the immutable
release workflow. The production Compose has no local OpenSearch service or
volume declaration, so new ingestion and RAG containers use the central
cluster. Do not remove the old container or volume until all verification above
passes.

The deployment environment and the Compose fallback both omit the removed local
OpenSearch probe from `PLATFORM_READY_CHECKS`. After the immutable release is
active, recreate only `platform-status` with the active release Compose so its
running container receives the updated readiness set; no image rebuild is
required.

After successful verification:

1. record the old container id and exact named volume;
2. stop and remove only the orphaned AKB local OpenSearch container;
3. remove only the proven AKB local OpenSearch volume;
4. run `docker compose ps`, AKB health/readiness, and public chat smoke again;
5. record the release SHA, central counts, `200/403` matrix, and cleanup result.

No other container, Docker volume, Registry data, Qdrant data, object storage,
or monitoring state is changed by this cleanup.

## Observability

OpenSearch Dashboards uses tenant `akl` and data view
`akl_document_chunks*`. The central index dashboard is:

`https://wazuh.home.cz/observability/d/akl-opensearch-index/akl-opensearch-index`

Monitor document/chunk counts, primary/replica health, indexing errors, search
latency, rejected requests, and authorization failures. Dashboards and logs
must never contain credentials, source bodies, prompts, answers, or full
connection strings.
