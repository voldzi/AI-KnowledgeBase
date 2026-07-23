# AKB Reranker Servers

AKB uses dedicated reranker runtimes. They are independent of Ollama because
reranking requires relevance scores for query-document pairs rather than text
generation or standalone embeddings.

## Runtime inventory

| Runtime | Target | Model | Endpoint |
| --- | --- | --- | --- |
| Qwen | MacBook VPN address | `Qwen3-Reranker-0.6B` Q8_0 | `:11435/v1/rerank` |
| GTE | MacBook VPN address | `Alibaba-NLP/gte-multilingual-reranker-base` F32 | `:11438/rerank` |
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
GTE uses the same pinned TEI image and pins the Alibaba model revision to
`8215cf04918ba6f7b6a62bb44238ce2953d8831c`.
The preferred native MPS runtime additionally pins the remote model
implementation to `40ced75c3017eb27626c9d4ea981bde21a2662f4`.

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
The production Qwen Q8 runtime therefore uses native macOS `llama-server`
with Metal on port `11436`. A pinned, read-only `alpine/socat` container from
`docker-compose.qwen-native-proxy-mac.yml` exposes the existing authenticated
port `11435`; authentication is still enforced by `llama-server`. Do not move
the BGE F32 image to Docker Desktop expecting GPU acceleration.

The native process is an operator-owned LaunchAgent named
`cz.zeleznalady.akb-qwen-reranker`. It uses the model and key under
`$HOME/.cache/akb-reranker` and `$HOME/.config/akb-reranker`, both outside Git.
Configure both `--batch-size` and `--ubatch-size` to `2048`. `llama-server`
reduces the physical batch to the smaller value; an `ubatch` of `512` rejects
ordinary AKB chunks above 512 tokens with HTTP 500.
The Docker-only Qwen service remains a rollback option but must stay stopped
while the proxy owns port `11435`.

Start or reconcile the proxy after the native `/health` endpoint is ready:

```bash
docker compose \
  -f infra/rerankers/docker-compose.qwen-native-proxy-mac.yml \
  up -d
```

`docker.home.cz` reaches the MacBook VPN addresses from its host namespace,
while containers in `akl_app_zone` deliberately have no direct VPN route.
Run the pinned host-network proxy set on `docker.home.cz`:

```bash
docker compose \
  -f infra/rerankers/docker-compose.qwen-docker-home-proxy.yml \
  up -d
```

The stable AKB-side endpoints are:

```text
http://10.246.241.1:11435  -> 192.168.200.3:11435
http://10.246.241.1:11436  -> 192.168.200.2:11435
http://10.246.241.1:11437  -> 192.168.1.176:11435
```

`10.246.241.1` is the gateway of the explicitly configured
`AKL_APP_ZONE_SUBNET` (`10.246.241.0/24` by default), not an incidental Docker
bridge address. Keep the URL order aligned with the preferred VPN address.
The three proxy URLs are alternative addresses of one MacBook, not a
load-balanced pool. AKB probes them concurrently when it has no active route,
sticks to the first healthy address, serializes inference for that single
runtime, and temporarily cools down a route after an inference failure.
Address order is only a deterministic tie-breaker when multiple paths are
healthy.

The Qwen production profile uses batches of up to 32 documents, truncates each
reranker input to 1,500 characters and admits one inference request at a time.
Do not raise the text bound without a production-sized benchmark:
`32 x 1,500` completed in approximately 3.1 seconds while `32 x 4,000`
exceeded 90 seconds and left the single-worker runtime blocked until restart.
Production retrieval-quality evaluation also runs one case at a time so it
measures this single physical runtime instead of creating artificial
intra-run contention.

Verification:

```bash
python3 scripts/reranker_smoke.py \
  --provider llama \
  --base-url http://127.0.0.1:11435 \
  --api-key "$(head -n 1 "$QWEN_RERANKER_API_KEY_FILE")"
```

## MacBook GTE deployment

GTE runs natively on Apple MPS. Docker Desktop does not expose Metal to Linux
containers. Install the pinned dependencies into an isolated environment and
keep the model cache and bearer key outside Git:

```bash
python3.11 -m venv "$HOME/.cache/akb-gte-reranker/venv"
"$HOME/.cache/akb-gte-reranker/venv/bin/pip" install \
  -r infra/rerankers/gte-native-requirements.txt
install -d -m 0700 "$HOME/.config/akb-reranker"
openssl rand -hex 32 > "$HOME/.config/akb-reranker/gte-api-key"
chmod 0600 "$HOME/.config/akb-reranker/gte-api-key"
HF_HOME="$HOME/.cache/akb-gte-reranker/huggingface" \
HF_HUB_DISABLE_XET=1 \
"$HOME/.cache/akb-gte-reranker/venv/bin/python" \
  tools/gte_reranker_server.py \
  --api-key-file "$HOME/.config/akb-reranker/gte-api-key"
```

Operate the command as a user LaunchAgent named
`cz.zeleznalady.akb-gte-reranker`. The native service binds localhost port
`11441`, requires a bearer token for `/rerank`, exposes only content-free
`/health`, bounds payload and text sizes, serializes MPS inference and never
logs queries or documents. Docker Desktop publishes private port `11438`:

```bash
docker compose \
  -f infra/rerankers/docker-compose.gte-native-proxy-mac.yml \
  up -d
```

This mirrors the verified Qwen pattern and avoids opening a native Python
listener through the macOS firewall.
After the first pinned model download, set `HF_HUB_OFFLINE=1` and
`TRANSFORMERS_OFFLINE=1` in the LaunchAgent so startup cannot resolve moving
remote artifacts.

Run the host-network proxy set on `docker.home.cz`:

```bash
docker compose \
  -f infra/rerankers/docker-compose.gte-docker-home-proxy.yml \
  up -d
```

The stable AKB-side endpoints are:

```text
http://10.246.241.1:11438  -> 192.168.200.3:11438
http://10.246.241.1:11439  -> 192.168.200.2:11438
http://10.246.241.1:11440  -> 192.168.1.176:11438
```

Use the same active-route and cooldown semantics as Qwen. The three endpoints
are alternate network paths to one physical MPS runtime, not a load-balanced
pool. Production keeps `AKL_RAG_RERANKER_MAX_CONCURRENCY=1`.

`/health` reports the pinned model, model revision, code revision and
`device=mps`, without probing document content. Successful `/rerank` responses
also expose content-free timing headers for MPS queue, inference, server total
and text count. AKB propagates their aggregate into
`retrieval_diagnostics.reranker_diagnostics`; operators can therefore separate
network, queue and inference latency from `docker.home.cz` without access to
queries, document text or private endpoint URLs.

The production-sized benchmark of 32 Czech query-document pairs completed in
approximately 0.98 seconds on an M4 Max after warm-up. The corresponding
docker.home.cz CPU runtime needed approximately 60 seconds and must not be
selected for the production latency path.

## docker.home.cz GTE CPU rollback

The service joins the existing `akl_app_zone` and publishes no host port. Only
AKB application containers on that Docker network can reach it. This profile
is retained for compatibility and disaster recovery; it is not a performant
production target. Qwen and BGE also remain rollback options until the
production evaluation gate approves native GTE.

```bash
docker compose -f infra/rerankers/docker-compose.gte-docker-home.yml up -d
```

Verification runs inside the application network without exposing GTE to the
host network:

```bash
docker run --rm --network akl_app_zone \
  -v "$PWD:/work:ro" -w /work python:3.11-alpine \
  python3 scripts/reranker_smoke.py \
  --provider tei --base-url http://gte-reranker:3000
```

The first CPU start can spend approximately one minute warming the F32 model.
Readiness is reached only after the log reports `Ready`; a running container
before that point is not sufficient deployment evidence.

The BGE runtime remains available through
`docker-compose.bge-docker-home.yml`. Do not run GTE and BGE under the same
service alias.

## Security and operations

- Neither runtime logs query or document bodies in AKB. Runtime access logs are
  kept at the minimum supported verbosity and must not be exported as content
  telemetry.
- Qwen and native GTE require separate bearer keys because they are reachable
  over the private LAN.
- GTE and the BGE rollback runtime are isolated on the internal application
  Docker network.
- All services have bounded CPU, memory, process count, request batch size and
  concurrency. GTE and BGE use a 2,048-token server batch on the CPU host and
  admit at most 16 queued pair requests; this changes throughput, not scores.
- The current lexical reranker remains the fail-safe path until RAG V2 quality
  gates approve either model.
- A model or runtime upgrade requires a new pinned digest/revision, Czech
  benchmark evidence and rollback verification.
- Production AKB mounts `/srv/akl/secrets/qwen-reranker-api-key` read-only as
  `/run/secrets/akl-rag-reranker-api-key`. The environment contains only the
  file path. A missing or unreadable endpoint in `shadow` uses the lexical
  fallback and must never block an answer.
- The private VPN address is runtime configuration, not a source-code
  constant. Production uses `AKL_RAG_RERANKER_BASE_URLS` with the approved
  `.3`, `.2` and `.176` addresses. Verify at least one `/health` response from
  `docker.home.cz` before every rollout.
