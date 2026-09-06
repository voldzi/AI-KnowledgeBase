# Dependency quality and environment parity

AKB uses the newest dependency set that has passed the complete release checks. A
new package release is never pulled into a running production container
automatically. The reviewed versions are committed in hash-locked files, built
into immutable images, accepted locally, and then promoted as one exact Git SHA.

## Bound versions

- Web runtime: Node `26.8.1` and pnpm `11.19.0`.
- Python runtime: Python `3.12.14` and uv `0.12.9` for lock generation.
- Vulnerability scanner: pip-audit `2.10.0`.
- STRATOS UI: the immutable `0.5.1` tarball from the latest completed STRATOS
  handoff. Replace it only with a newer tarball, checksum, manifest, and handoff.
- Infrastructure and model images: the reviewed versions and multi-platform
  digests in `infra/dependency-images.json`. Development, local production,
  Docker Home, acceptance and CI definitions must use those same references.
- Production object storage: SeaweedFS through the S3 gateway at
  `storage.home.cz:8333`. MinIO is only the local compatibility fixture.

`.node-version`, `apps/web/package.json`, CI, the local dependency images, and
the production Dockerfiles carry the same runtime versions. Python production
and test jobs install the same committed, hash-locked package sets. The local
fast check and release build therefore test the dependency graph that will run
in production.

pnpm `12` is intentionally not selected yet. Its current npm package delegates
to a platform-specific executable download at first use, which does not fit the
single checked archive used by the AKB deterministic container build. pnpm
`11.19.0` is the newest reviewed self-contained release for this build model.

## Refresh procedure

1. Update direct web packages and regenerate `apps/web/pnpm-lock.yaml` with the
   bound pnpm version.
2. Run `scripts/ci/update_python_locks.sh` with the bound uv version. Update and
   run `scripts/ci/compile_docling_locks.sh` when Docling changes.
3. Update `infra/dependency-images.json`, verify every image in its source
   registry, and propagate the exact `tag@sha256` reference to all runtime
   profiles. Record any upstream packaging exception in the manifest.
4. Run `scripts/ci/quality_dependencies.py --verify-image-registry`. It fails on a vulnerable or stale
   direct Node package, stale Python lock, version mismatch between CI/local
   Docker/production Docker, mutable infrastructure image, or a stale Docling
   release. It writes the audit result and CycloneDX SBOM under
   `.artifacts/quality`.
5. Run focused tests and build each affected production image from the
   repository root with its production Dockerfile.
6. Run the common Docker Desktop acceptance suite. Promote the exact candidate
   SHA only after all release and security gates pass.

The dependency-quality workflow runs on every pull request and main update as
part of CI. A separate daily workflow also resolves every image digest in its
source registry and detects newly published package versions or newly disclosed
vulnerabilities even when no source code changes.

## Upgrade decision rules

- Security fixes have priority and block release while an applicable production
  advisory remains unresolved.
- Major runtime, database, vector-store, object-store, or identity upgrades need
  their own compatibility and data migration acceptance. A newer tag alone is
  insufficient evidence.
- Floating upstream tags are forbidden, including development defaults. Every
  external container reference carries a human-readable release tag and an
  immutable multi-platform digest.
- The local MinIO fixture is pinned to the final official container release.
  Upstream's newer source-only security release is not represented as an
  official container. It is not a production dependency because AKB production
  uses SeaweedFS; the real SeaweedFS version and S3 lifecycle smoke remain a
  production readiness check.
- Local and production profiles cannot carry different application dependency
  locks. Platform-specific Docling locks are allowed only because macOS Apple
  Silicon and Linux production resolve different binary artifacts from the same
  reviewed Docling input.
- The evidence names the commit and records a dirty working tree, so output from
  an uncommitted experiment cannot be mistaken for release evidence.
