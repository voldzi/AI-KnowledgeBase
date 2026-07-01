# AKB Web Frontend

Next.js frontend for AKB Platform, focused on controlled documentation, ingestion visibility, citation-backed RAG answers, audit review and administration skeletons.

## Responsibility

This service provides:

- dashboard
- document registry UI
- document detail
- version history
- upload wizard
- ingestion status
- knowledge chat
- citation viewer
- audit viewer
- admin UI skeleton
- typed API clients for Registry API, Ingestion Service and RAG Retrieval Service
- mock API mode for early development

It does not directly access PostgreSQL, Qdrant, Ollama, vLLM or internal MinIO APIs. Upload/download flows use signed object storage URIs only.

## Local Run

```bash
pnpm install
pnpm dev
```

The app starts on `http://localhost:3000` by default.

In the repository docker-compose setup, port `3001` is Grafana. The web
container is exposed on `http://localhost:3002`.

After frontend source changes, rebuild only the web service:

```bash
docker compose -f infra/docker-compose/docker-compose.dev.yml up -d --build web
```

The standard local web runtime is the Docker web service on `http://localhost:3002`.
Avoid running a second host-side Next.js server against the same backend during normal development.
For focused host-side UI debugging, stop the Docker web service first and then run:

```bash
AKL_ENV=development \
AKL_API_CLIENT_MODE=production \
AKL_AUTH_MODE=mock \
AKL_REGISTRY_API_BASE_URL=http://localhost:8001/api/v1 \
AKL_INGESTION_API_BASE_URL=http://localhost:8090/api/v1 \
AKL_RAG_API_BASE_URL=http://localhost:8082/api/v1 \
AKL_GOVERNANCE_API_BASE_URL=http://localhost:8085/api/v1 \
AKL_WEB_DEV_SUBJECT=user_dev \
AKL_WEB_DEV_ROLES=admin,document_manager,reader \
pnpm dev -- --port 3002
```

## Configuration

Copy `.env.example` to `.env.local` for local overrides.

| Variable | Purpose |
| --- | --- |
| `AKL_ENV` | `development`, `test`, `staging` or `production` |
| `AKL_API_CLIENT_MODE` | `mock` or `production` |
| `AKL_AUTH_MODE` | `mock` or `oidc` |
| `AKL_REGISTRY_API_BASE_URL` | Registry API `/api/v1` base URL |
| `AKL_INGESTION_API_BASE_URL` | Ingestion Service `/api/v1` base URL |
| `AKL_RAG_API_BASE_URL` | RAG Retrieval Service `/api/v1` base URL |
| `AKL_GOVERNANCE_API_BASE_URL` | Governance Service `/api/v1` base URL |
| `AKL_DEV_ACCESS_TOKEN` | Optional local integration token |
| `AKL_WEB_DEV_SUBJECT` | Local mock-auth subject sent to APIs in development |
| `AKL_WEB_DEV_ROLES` | Comma-separated local mock-auth roles |
| `AKL_WEB_DEV_GROUPS` | Comma-separated local mock-auth groups |
| `AKL_WEB_OBJECT_STORAGE_ROOT` | Local object-storage root used by upload and signed source opening |
| `AKL_WEB_UPLOAD_BUCKET` | Allowed storage bucket for uploaded and opened source objects |
| `AKL_WEB_DOWNLOAD_SIGNING_SECRET` | Optional HMAC secret for signed source opening; falls back to upload/dev secret |
| `AKL_WEB_DOWNLOAD_TOKEN_TTL_SECONDS` | Optional signed source opening token TTL |
| `AKL_WEB_DOWNLOAD_PUBLIC_BASE_PATH` | Optional same-origin content endpoint path for signed source opening; defaults to `${NEXT_PUBLIC_AKL_BASE_PATH}/api/documents/source/content` |

Production refuses to start when `AKL_API_CLIENT_MODE=mock` or `AKL_AUTH_MODE=mock`.

## API Client Separation

Client contracts live in `src/lib/types/api.ts`.

- `src/lib/api/production/*` contains REST clients only.
- `src/lib/api/mock/*` contains local in-memory clients and seed data.
- `src/lib/api/index.ts` is the only factory that chooses mock or production clients.
- `src/lib/api/server.ts` is server-only and is used by App Router pages.

All production client calls attach:

- `Authorization: Bearer <token>` when a token is available
- `X-Request-ID`
- `X-Correlation-ID`

Integration logs include only service, operation, status, latency, request id, correlation id and error code. They do not log document bodies, prompts, tokens or full answers.

## Health Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Basic liveness |
| `GET /api/ready` | Configuration readiness |

## Scripts

```bash
pnpm typecheck
npm run test
npm run test:e2e
pnpm build
```

`npm run test:e2e` starts the Next.js app on `127.0.0.1:3217` with mock API clients and verifies the first automated Document Workbench product paths from `docs/qa/document-workbench-product-qa.md`.

## Docker

```bash
docker build -t akl-web .
docker run --rm -p 3000:3000 --env-file .env.local akl-web
```

The Docker image uses Next.js standalone output and exposes `GET /api/health` as the container healthcheck.

## Integration Contracts

The frontend calls only these services:

- Registry API: documents, document versions, authorization checks, audit events
- Ingestion Service: ingestion jobs and reports
- RAG Retrieval Service: citation-backed RAG query
- Governance Service: document compare, compliance and conflict checks through a server bridge

The controlled-document workflow is bridged through App Router API routes under
`/api/controlled-document/*` so browser components do not call internal service
URLs directly.

Document governance actions are bridged through `POST /api/documents/{documentId}/governance`.
The bridge accepts `compare_versions`, `check_compliance` and `detect_conflicts`, loads Registry
metadata server-side and returns Governance Service output plus explicit source limitations while
native extracted text is not yet available to the web bridge.

Document detail source-context is bridged through
`GET /api/documents/{documentId}/source-context?chunk_id={chunkId}`. The bridge opens the RAG
citation server-side and rejects the response unless its document and version belong to the active
document detail.

Document source opening is bridged through
`POST /api/documents/{documentId}/versions/{versionId}/source/open`, which returns a short-lived
same-origin download URL only when the source object exists in configured storage. The browser then
uses `GET /api/documents/source/content?token=...`; the content route verifies the HMAC token,
bucket, object key and optional SHA-256 before returning bytes.

The current UI assumes a list endpoint for ingestion jobs: `GET /api/v1/ingestion/jobs`. The central contract documents job creation and job lookup as minimum required endpoints, so this list endpoint should be treated as a frontend integration requirement for operational status screens.

## Limits

- Mock mode is development-only.
- The frontend treats authorization checks as UI hints only; Registry API remains authoritative.
- The chat screen does not call LLM runtimes directly.
- The app does not parse documents or create chunks locally.
- The initial OIDC integration is represented by config boundaries and auth mode checks; full login flow belongs to the identity integration phase.
