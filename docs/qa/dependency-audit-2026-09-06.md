# Dependency audit — 6 September 2026

## Result

The AKB application, build tools, infrastructure containers, document
processing stack, model-serving profiles, and local S3 fixture were checked as
one dependency surface. All dependencies managed by this repository are bound
to reviewed versions. Package audits found no known vulnerabilities in the
resolved production Node or Python graphs. Every repository-managed container
reference resolves by immutable multi-platform digest.

The only external runtime version not verified by this audit is the SeaweedFS
instance at `storage.home.cz:8333`. Production uses that service as its S3
object store. The endpoint is reachable but does not expose a version, and the
storage host was not available to this audit. The newest reviewed upstream
release is SeaweedFS `4.45`; the installed production version and a complete S3
lifecycle smoke remain release-readiness checks.

## Reviewed dependency set

| Area | Reviewed version | Result |
| --- | --- | --- |
| Web runtime | Node 26.8.1, pnpm 11.19.0 | Current reviewed, build passed |
| Python runtime | Python 3.12.14, uv 0.12.9 | Current reviewed, locks verified |
| Document extraction | Docling 2.126.0 | Current reviewed, platform locks verified |
| Databases and search | PostgreSQL 18.6, Qdrant 1.19.1, OpenSearch 3.8.0 | Immutable images, lifecycle smokes passed |
| Identity | Keycloak 26.7.3 | Immutable image, health and version passed |
| Malware scanning | ClamAV 1.5.4 | Immutable image, engine and signatures started |
| Observability | Prometheus 3.14.0, Grafana 13.2.1, Loki 3.7.7 | Immutable images, startup and version passed |
| Local AI services | Ollama 0.33.3, TEI 1.9.3, reviewed llama.cpp server digest | Immutable references verified |
| Local S3 fixture | MinIO RELEASE.2025-09-07T16-13-09Z | Put/get/delete smoke passed |
| Production S3 | SeaweedFS; reviewed upstream 4.45 | Installed version and production lifecycle smoke open |
| CI runtime | Gitea act_runner 0.3.0, Docker CLI 29.7.2 | CI image built and runtime versions verified |
| STRATOS cache | Redis 8.10.1 | Reviewed in STRATOS; AKB has no Redis dependency |

Exact container references and documented exceptions are stored in
`infra/dependency-images.json`. MinIO remains a local S3-compatibility fixture;
it is not the AKB production object store. The upstream MinIO source release is
newer than its last official container, so the repository retains the last
official immutable image rather than building an unreviewed replacement.

## Verification evidence

- Dependency quality checked 302 components with zero stale direct Node or
  Python requirements and zero known vulnerabilities.
- Six production Python lock sets, both Docling platform locks, and the native
  reranker environment resolved successfully.
- All 19 repository-managed image references resolved in their source
  registries.
- PostgreSQL create/read, Qdrant collection and point, OpenSearch index and
  document, and MinIO object lifecycle smokes passed in isolated containers.
- Keycloak, Prometheus, Grafana, Loki, Caddy, Ollama, and ClamAV startup or
  version checks passed.
- The complete local fast check passed twice: once with eight production image
  builds and once from the local cache with eight hits and no misses.
- The affected registry tests passed: 20 tests. Skeleton and OpenAPI checks,
  Compose rendering, Python compilation, and whitespace validation passed.

The audit did not deploy or modify production. It also did not restart the
shared `akb-stratos-test` environment.

## Release gates still required

1. Read the actual SeaweedFS version on `storage.home.cz` and record it in the
   release evidence.
2. Run `scripts/s3_object_storage_smoke.py` against the production-compatible
   SeaweedFS boundary using credential files, including upload, metadata,
   content hash, listing, deletion, and post-delete verification.
3. Run the combined AKB and STRATOS acceptance suite from clean committed
   source revisions and record both SHAs.
4. Let the trusted exact-SHA Gitea workflow repeat dependency, security, build,
   and acceptance gates before any production promotion.
