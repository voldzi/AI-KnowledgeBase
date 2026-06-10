# Phase 01 Integration Report

Validated on 2026-06-05.

## 1. Summary

Phase 01 service baseline integration is complete for the local AKL development stack.
The development Docker Compose profile now starts the real service containers for the
web frontend, registry API, ingestion service, RAG retrieval service, LLM gateway,
evaluation service, governance service, and platform status service.

All main services expose `GET /health` with at least `status`, `service`, and
`version`. The local compose stack starts successfully, `docker compose config`
passes, and the Phase 01 smoke test completes through document creation,
document version creation, ingestion, retrieval, mock LLM answering, RAG answer
formatting, and registry audit event creation.

The integration remains a baseline, not a production-complete document workflow.
The default path still uses deterministic mock behavior for LLM responses and
retrieval/indexing where needed.

## 2. Integrated Services

- [x] Platform / Infrastructure
- [x] Identity & Document Registry API
- [x] Ingestion Service
- [x] RAG Retrieval Service
- [x] LLM Gateway Service
- [x] Web Frontend
- [x] Evaluation Service
- [x] Governance / Compliance Service

## 3. Service Healthcheck Results

| Service | URL | Status | Notes |
|---|---|---|---|
| Reverse Proxy | `http://localhost:8080/health` | OK | Caddy reverse proxy is healthy. |
| Platform Status | Internal container healthcheck | OK | Container `akl-platform-status-1` is healthy. |
| Registry API | `http://localhost:8001/health` | OK | Returns `status`, `service`, `version`. |
| Ingestion Service | `http://localhost:8090/health` | OK | Returns `status`, `service`, `version`. |
| RAG Retrieval Service | `http://localhost:8082/health` | OK | Returns `status`, `service`, `version`. |
| LLM Gateway Service | `http://localhost:8083/health` | OK | Default provider is `mock`. |
| Web Frontend | `http://localhost:3002/health` | OK | Root health route added; `/api/health` remains available. |
| Evaluation Service | `http://localhost:8084/health` | OK | Returns `status`, `service`, `version`. |
| Governance Service | `http://localhost:8085/health` | OK | Returns `status`, `service`, `version`. |
| PostgreSQL | Container healthcheck | OK | Healthy in `docker compose ps`. |
| Qdrant | Container healthcheck | OK | TCP healthcheck is healthy. |
| MinIO | Container healthcheck | OK | Healthy in `docker compose ps`. |
| Keycloak | Container healthcheck | OK | Healthy in `docker compose ps`. |
| Prometheus | Container healthcheck | OK | Healthy in `docker compose ps`. |
| Grafana | `http://localhost:3001` | Up | Container runs without an explicit compose healthcheck. |
| Loki | `http://localhost:3100` | Up | Container runs without an explicit compose healthcheck. |

## 4. Docker Compose Result

The following commands were validated against `infra/docker-compose/docker-compose.dev.yml`:

```bash
docker compose -f infra/docker-compose/docker-compose.dev.yml config
docker compose -f infra/docker-compose/docker-compose.dev.yml up -d --build
docker compose -f infra/docker-compose/docker-compose.dev.yml ps
```

Result:

- `config` passes.
- `up -d --build` builds and starts the development stack.
- `ps` shows the app containers and required infrastructure containers running.
- Healthcheck-enabled app and infrastructure containers are healthy.

Local host ports:

| Component | Host Port |
|---|---:|
| Reverse Proxy | 8080 |
| Registry API | 8001 |
| Ingestion Service | 8090 |
| RAG Retrieval Service | 8082 |
| LLM Gateway Service | 8083 |
| Evaluation Service | 8084 |
| Governance Service | 8085 |
| Web Frontend | 3002 |
| Keycloak | 8081 |
| Qdrant | 6333, 6334 |
| MinIO | 9000, 9001 |
| Prometheus | 9090 |
| Grafana | 3001 |
| Loki | 3100 |

## 5. API Contract Review

The service APIs use a versioned API prefix for business endpoints, primarily
`/api/v1`, while health and readiness endpoints remain unversioned.

| Service | Required Phase 01 Operations | Result |
|---|---|---|
| Registry API | Documents, document versions, authz check, audit events, health | Present under `/api/v1` plus `/health`. |
| Ingestion Service | Create job, get job, get report, health | Present under `/api/v1` plus `/health`. |
| RAG Retrieval Service | Retrieve, query, answer, health | Present under `/api/v1` plus `/health`. |
| LLM Gateway Service | Models, chat completions, embeddings, health | Present under `/api/v1` plus `/health`. |
| Web Frontend | Frontend app, health | Present at `/` plus `/health` and `/api/health`. |
| Evaluation Service | Evaluation APIs, health | Present and reachable. |
| Governance Service | Governance/compliance APIs, health | Present and reachable. |

Static OpenAPI files were regenerated for the Python services after the health
and compatibility contract changes.

## 6. Data Contract Review

| Contract | Result | Notes |
|---|---|---|
| Document | Compatible | Registry responses now include additive `owner` while preserving `owner_id`. |
| DocumentVersion | Compatible | Registry version response keeps required identity, status, dates, and source URI fields. |
| DocumentChunk | Compatible | Ingestion chunk shape includes the required fields plus service-specific metadata such as normalized text and access scope. |
| RetrievedChunk | Compatible | RAG citations now include additive `document_version` while preserving `version_label`. |
| Answer | Compatible | RAG answers include answer text, confidence, citations, warnings, used chunks, and missing information. |

Compatibility changes were intentionally additive so existing callers using
`owner_id` or `version_label` continue to work.

## 7. Service Boundary Review

No direct imports of another service's internal application code were found in
the integration path. The service structure remains independently deployable:

- Web Frontend calls API clients instead of importing service internals.
- Registry API owns document metadata, versions, authz decisions, and audit events.
- Ingestion Service uses adapters for registry, object storage, indexing, and optional LLM dependencies.
- RAG Retrieval Service uses client/adaptor boundaries for registry, retrieval, and LLM calls.
- LLM Gateway isolates the model provider behind its own API.
- Platform infrastructure provides runtime services and does not own business data.

No cross-service direct database access was introduced during this integration.

## 8. End-to-End Smoke Test

The smoke test is implemented at `scripts/phase_01_smoke.py`.

Command:

```bash
python3 scripts/phase_01_smoke.py
```

Validated flow:

- Healthchecks pass for Registry, Ingestion, RAG Retrieval, LLM Gateway, Governance, Evaluation, Web, and Reverse Proxy.
- A test document is created in Registry.
- A test document version is created in Registry.
- A local object-storage file is seeded into the ingestion container.
- An ingestion job runs and returns a report.
- RAG retrieval returns a chunk.
- LLM Gateway returns a mock chat completion.
- RAG query returns an answer with citation data.
- A registry audit event is written.

Latest validated smoke result:

```text
Phase 01 smoke test
OK seeded ingestion object storage
OK healthchecks
OK document_id= doc_0f3664c6dec64f68a25859145093bcf1
OK document_version_id= ver_a0e69f0e5a8648958300dfa1a879b20c
OK ingestion_job_id= ing_591199cc33ac492b83a33c1b7c2c4ad9
OK retrieved_chunk_id= chunk_789
OK llm_provider= mock
OK answer_confidence= medium
OK audit_event_id= audit_27948285d1f64028a9d8c9a70ba853cb
```

## 9. Issues Found

| ID | Severity | Area | Description | Proposed Fix |
|---|---|---|---|---|
| INT-001 | P1 | Retrieval/Indexing | The default compose baseline does not yet validate real Qdrant indexing and retrieval end to end. | In Phase 02, wire ingestion index output into Qdrant and configure RAG retrieval against the real collection. Keep mock mode only for deterministic tests. |
| INT-002 | P1 | LLM Runtime | LLM Gateway defaults to the mock provider. Ollama is optional and was not validated as the active runtime backend. | Add an explicit AI profile validation path and smoke test for Ollama or the selected local runtime. |
| INT-003 | P2 | Authentication | Keycloak starts, but the end-to-end OIDC login/token flow is not yet enforced through all app calls. | Define the Phase 02 auth mode and verify web-to-API token propagation and registry authz checks. |
| INT-004 | P2 | Frontend Typecheck | `npm run typecheck` can fail when stale `.next/dev` duplicate generated declaration files are present. Production Docker/Next build passes. | Clean generated `.next/dev` artifacts before local typecheck, or adjust local scripts to remove stale generated files first. |
| INT-005 | P2 | Observability | Grafana and Loki run, but do not expose explicit compose health states. | Add simple healthchecks if they become Phase 02 readiness dependencies. |
| INT-006 | P2 | Prod-like Compose | Prod-like compose still allows app stubs; only upstream ports were aligned in this phase. | Promote the real service compose pattern into prod-like once deployment assumptions are finalized. |

## 10. Fixes Applied During Integration

- Replaced development compose app stubs with real app service builds.
- Added host port defaults that avoid local collisions: Web `3002`, Grafana `3001`.
- Added missing service environment defaults and root `.env.example` entries.
- Added `AKL_SERVICE_VERSION` handling across Python services.
- Standardized health responses to include `status`, `service`, and `version`.
- Added root Web Frontend `GET /health` while preserving `/api/health`.
- Updated Docker healthchecks for Web and Qdrant.
- Added named development volumes for ingestion object storage, ingestion jobs, and evaluation reports.
- Updated reverse-proxy upstream defaults to point to real service ports.
- Regenerated static OpenAPI files for Python services.
- Added additive data-contract aliases: Document `owner` and RAG citation `document_version`.
- Added `scripts/phase_01_smoke.py` for repeatable local smoke verification.
- Updated tests for the health and compatibility contract changes.

## 11. Remaining Open Points

- Real controlled document ingestion into Qdrant needs to be validated beyond the deterministic smoke path.
- The selected non-mock LLM runtime needs an explicit compose profile and smoke command.
- Web document upload/create flows need to be connected to the integrated API baseline.
- OIDC/authz enforcement must be validated across browser, API gateway/proxy, Registry, Ingestion, and RAG.
- Production-like deployment needs a separate hardening pass for secrets, TLS, auth mode, healthchecks, migrations, and observability.

## 12. Recommendation for Phase 02

Proceed to Phase 02 - Controlled Document MVP on top of this baseline.

Recommended Phase 02 order:

1. Define the canonical controlled-document happy path from upload to approved answer.
2. Replace the mock retrieval path with ingestion-to-Qdrant-to-RAG retrieval.
3. Validate a non-mock LLM provider profile.
4. Enforce OIDC and registry authz checks in the main document and RAG flows.
5. Add a browser-level smoke test for the Web Frontend using the real APIs.
6. Convert the Phase 01 smoke test into a CI-ready integration check after service startup.
