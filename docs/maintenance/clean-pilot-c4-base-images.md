# Clean Pilot C4 Base Images

The C4 registry freeze keeps `--pull` enabled. Reproducibility is provided by
digest-pinned application base images, not by relying on mutable registry tags.

| Runtime | Immutable base image |
| --- | --- |
| Python services | `python:3.12.14-slim@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea` |
| Web service | `node:26.8.1-alpine@sha256:2d984a15c9b54fd0aeb608b8e0d0d83529eb34d2966db27a1fb4f1edc3d298a3` |

Changing either digest is a runtime-input change. It requires a reviewed C4
bundle, a repeated fixed-point C4 verification, and fresh disposable C6
rehearsals before it can be accepted as Clean Pilot evidence.

## Deterministic application builds

C4 application images are published with Docker Buildx for `linux/amd64`.
`SOURCE_DATE_EPOCH` is the exact source commit timestamp and the image exporter
uses `rewrite-timestamp=true`. BuildKit provenance and SBOM attestations are
disabled for this byte-stable image manifest; the closed same-SHA CI artifact
remains the separate source and review attestation.
The exporter uses `unpack=false`, because loading a rewritten image into the
runner's local Docker image store is incompatible with timestamp rewriting.

PostgreSQL, MinIO, OpenSearch, and Qdrant are copied only from immutable
SHA-256 references. The preflight rejects mutable upstream tags.

All Python build dependencies come from committed `requirements.c4.lock` files
with exact versions and SHA-256 hashes. Ingestion system packages come from the
fixed Debian snapshot `20260824T000000Z` and direct packages are version-pinned.
The web build downloads the exact pnpm 11.19.0 tarball with a Dockerfile SHA-256
checksum, uses `pnpm-lock.yaml` in frozen mode, and does not install Alpine
packages at build time. `scripts/ci/check_clean_pilot_c4_inputs.py` rejects a
missing hash, mutable base image, unapproved package download, or build-policy
drift before registry authentication or image publication.
