# AKL Reverse Proxy

The reverse proxy is owned by the Platform / Infrastructure thread. It routes stable path prefixes to independently deployable AKB services without importing service internals.

| Public path | Upstream env var | Default upstream |
|---|---|---|
| `/health`, `/ready`, `/platform/*` | `PLATFORM_STATUS_UPSTREAM` | `platform-status:8080` |
| `/web/*` | `WEB_UPSTREAM` | `web:3000` |
| `/registry/*` | `REGISTRY_UPSTREAM` | `registry-api:8000` |
| `/ingestion/*` | `INGESTION_UPSTREAM` | `ingestion-service:8090` |
| `/rag/*` | `RAG_UPSTREAM` | `rag-retrieval-service:8080` |
| `/llm-gateway/*` | `LLM_GATEWAY_UPSTREAM` | `llm-gateway-service:8080` |
| `/evaluation/*` | `EVALUATION_UPSTREAM` | `evaluation-service:8080` |
| `/governance/*` | `GOVERNANCE_UPSTREAM` | `governance-service:8080` |
| `/grafana/*` | `GRAFANA_UPSTREAM` | `grafana:3000` |

`handle_path` strips service prefixes before proxying. For example, `GET /registry/health` becomes `GET /health` on `registry-api`.

The proxy forwards `X-Request-ID`, `X-Correlation-ID`, `X-Forwarded-Host`, `X-Forwarded-Proto`, and `X-Service-Name`.
