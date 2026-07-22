# AKB Reranker Servers

AKB uses dedicated reranker runtimes. They are independent of Ollama because
reranking requires relevance scores for query-document pairs rather than text
generation or standalone embeddings.

## Runtime inventory

| Runtime | Target | Model | Endpoint |
| --- | --- | --- | --- |
| Qwen | MacBook `192.168.200.3` | `Qwen3-Reranker-0.6B` Q8_0 | `:11435/v1/rerank` |
| BGE | `docker.home.cz` | `BAAI/bge-reranker-v2-m3` F32 | Docker-only `bge-reranker:3000/rerank` |

The Qwen llama.cpp image is pinned to OCI index digest
`sha256:6c9257ee7187fd01bb479a9a3142e59c3d4f37bb6c3fc4c12326bcffcbfcf2ba`.
The GGUF download URL pins repository revision
`a02f48bb4f057028298c21fa033da2b30d7742d5`; the source file has SHA-256
`22c9979ce4fbcdc5acdc310c6641c32797eff1aa980b8f7a2db8a8ea23429a48`.

The BGE TEI image is pinned to OCI index digest
`sha256:ad950d30878eceb72aaf32024d26fa2b1d04a75304fa0b4776b49aa1941fea07`
and the BAAI model revision is pinned to
`953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e`.

## MacBook Qwen deployment

Create a random API key file outside Git with mode `0600`, then start the
runtime from a checkout containing this repository:

```bash
install -d -m 0700 "$HOME/.config/akb-reranker"
openssl rand -hex 32 > "$HOME/.config/akb-reranker/qwen-api-key"
chmod 0600 "$HOME/.config/akb-reranker/qwen-api-key"
export QWEN_RERANKER_API_KEY_FILE="$HOME/.config/akb-reranker/qwen-api-key"
docker compose -f infra/rerankers/docker-compose.qwen-mac.yml up -d
```

The first start downloads the 639 MB Q8_0 GGUF into the named Docker volume.
Do not add the key file to an env file or Git.

The deployed MacBook key is stored at
`$HOME/.config/akb-reranker/qwen-api-key` with mode `0600`. Its client copy on
`docker.home.cz` is `/srv/akl/secrets/qwen-reranker-api-key`, also mode `0600`.
Mount the client copy read-only when AKB retrieval is connected to this
runtime; do not pass its value through Compose environment variables.

Docker Desktop does not expose Apple Metal acceleration to Linux containers.
The current Qwen Q8 runtime nevertheless meets the shadow latency target on
the MacBook CPU; if future candidate sizes exceed that target, move this same
contract to a native macOS `llama-server` before considering a longer timeout.
Do not move the BGE F32 image to Docker Desktop expecting GPU acceleration.

Verification:

```bash
python3 scripts/reranker_smoke.py \
  --provider llama \
  --base-url http://127.0.0.1:11435 \
  --api-key "$(head -n 1 "$QWEN_RERANKER_API_KEY_FILE")"
```

## docker.home.cz BGE deployment

The service joins the existing `akl_app_zone` and publishes no host port. Only
AKB application containers on that Docker network can reach it.

```bash
docker compose -f infra/rerankers/docker-compose.bge-docker-home.yml up -d
```

Verification runs inside the application network without exposing BGE to the
host network:

```bash
docker run --rm --network akl_app_zone \
  -v "$PWD:/work:ro" -w /work python:3.11-alpine \
  python3 scripts/reranker_smoke.py \
  --provider tei --base-url http://bge-reranker:3000
```

The first CPU start can spend approximately one minute warming the F32 model.
Readiness is reached only after the log reports `Ready`; a running container
before that point is not sufficient deployment evidence.

## Security and operations

- Neither runtime logs query or document bodies in AKB. Runtime access logs are
  kept at the minimum supported verbosity and must not be exported as content
  telemetry.
- Qwen requires a bearer key because it is reachable over the private LAN.
- BGE is isolated on the internal application Docker network.
- Both services have bounded CPU, memory, process count, request batch size and
  concurrency. BGE deliberately uses a 2,048-token server batch on the CPU
  host and admits at most 16 queued pair requests; this changes throughput,
  not scores.
- The current lexical reranker remains the fail-safe path until RAG V2 quality
  gates approve either model.
- A model or runtime upgrade requires a new pinned digest/revision, Czech
  benchmark evidence and rollback verification.
- Production AKB mounts `/srv/akl/secrets/qwen-reranker-api-key` read-only as
  `/run/secrets/akl-rag-reranker-api-key`. The environment contains only the
  file path. A missing or unreadable endpoint in `shadow` uses the lexical
  fallback and must never block an answer.
- The private VPN address is runtime configuration, not a source-code
  constant. Verify `/health` from `docker.home.cz` before every rollout.
