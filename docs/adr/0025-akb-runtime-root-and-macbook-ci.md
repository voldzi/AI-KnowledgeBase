# ADR 0025: AKB runtime root and high-throughput MacBook CI

Status: Accepted; implementation is staged after the currently verified release candidate.
Date: 2026-09-07

AKB is the product and runtime identity. The inherited `/srv/akl` release root,
`AKL_*` configuration keys, image coordinates and Compose labels are technical
compatibility names. They must not remain the permanent production interface.

The next clean production cutover creates `/srv/akb` as a separate immutable
release root. It has its own `releases`, `current`, `state`, `env`, `git`,
`prebuilt`, `backups` and `ci-deployments` directories, all with the existing
ownership and fail-closed permissions. The deployment gateway, release scripts,
tests, records and runbooks are parameterised with an explicit canonical
`AKB_RELEASE_ROOT=/srv/akb`; an `AKL_RELEASE_ROOT` value is accepted only during
the transition and fails if it disagrees with the canonical value.

The predecessor root is retained read-only as a rollback source until the new
root has passed immutable deployment, health, readiness, source-intake and Chat
citation acceptance. No document, object, database, Qdrant collection or secret
is copied by a path migration. Their existing governed migration procedures are
run explicitly and recorded. Only after the cutover evidence and rollback window
are complete may `/srv/akl` be retired.

The local MacBook is the fast preflight environment. Docker Desktop must expose
all 16 available CPUs and at least 32 GiB memory before the high-throughput
profile is enabled. It uses native `linux/arm64`, persistent BuildKit dependency
caches and six isolated test workers. The immutable `linux/amd64` production
image rehearsal remains a separately selected check: emulation and archive
transfer are not a useful feedback-loop target. Trusted Gitea CI remains the
single authority for final same-SHA evidence and production promotion.

The target warm preflight is at most 15 minutes: standards and impact analysis,
web checks, six independent Python service checks, Compose validation and the
release-contract shards run in isolated parallel workers. The full destructive
release-contract suite remains mandatory, but its independent fixtures are
sharded and its successful same-SHA evidence is never discarded merely to repeat
it. A failure in any shard blocks release and records the exact shard.
