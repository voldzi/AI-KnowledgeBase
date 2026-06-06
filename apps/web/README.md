# AKL Web Frontend

Next.js frontend for AKL Platform, focused on controlled documentation, ingestion visibility, citation-backed RAG answers, audit review and administration skeletons.

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
npm install
npm run dev
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
AKL_WEB_DEV_SUBJECT=user_dev \
AKL_WEB_DEV_ROLES=admin,document_manager,reader \
npm run dev -- --port 3002
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
| `AKL_DEV_ACCESS_TOKEN` | Optional local integration token |
| `AKL_WEB_DEV_SUBJECT` | Local mock-auth subject sent to APIs in development |
| `AKL_WEB_DEV_ROLES` | Comma-separated local mock-auth roles |
| `AKL_WEB_DEV_GROUPS` | Comma-separated local mock-auth groups |

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
npm run typecheck
npm run test
npm run build
```

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

The controlled-document workflow is bridged through App Router API routes under
`/api/controlled-document/*` so browser components do not call internal service
URLs directly.

The current UI assumes a list endpoint for ingestion jobs: `GET /api/v1/ingestion/jobs`. The central contract documents job creation and job lookup as minimum required endpoints, so this list endpoint should be treated as a frontend integration requirement for operational status screens.

## Limits

- Mock mode is development-only.
- The frontend treats authorization checks as UI hints only; Registry API remains authoritative.
- The chat screen does not call LLM runtimes directly.
- The app does not parse documents or create chunks locally.
- The initial OIDC integration is represented by config boundaries and auth mode checks; full login flow belongs to the identity integration phase.
