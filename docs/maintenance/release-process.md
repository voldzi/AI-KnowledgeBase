# Release Process

This process keeps `main` stable and reproducible.

## Branch Rules

The `main` branch is protected:

- changes must go through a pull request,
- required CI checks must pass before merge,
- required checks must be up to date with `main`,
- force pushes and branch deletion are disabled,
- unresolved PR conversations block merge,
- the rule applies to administrators too.

Required checks:

- `Web`
- `Python / registry-api`
- `Python / ingestion-service`
- `Python / rag-retrieval-service`
- `Python / llm-gateway-service`
- `Python / evaluation-service`
- `Python / governance-service`
- `Docker Compose Config`
- `Immutable docker.home.cz release`

## Pull Request Flow

1. Create a branch from current `main`.
2. Keep the PR scoped to one coherent change.
3. Run relevant local validation before pushing.
4. Push the branch and open a PR.
5. Wait for GitHub CI to pass.
6. Review the diff for runtime contracts, generated files, secrets, and documentation drift.
7. Squash merge into `main` after checks are green.
8. Delete the feature branch.

Do not push directly to `main`.

## Release Tag

Create a release tag only from a known-good `main` commit:

```bash
git switch main
git pull --ff-only origin main
git status -sb
git tag -a vX.Y.Z-name -m "vX.Y.Z-name"
git push origin vX.Y.Z-name
```

Create the GitHub Release from the pushed tag:

```bash
gh release create vX.Y.Z-name \
  --title "vX.Y.Z-name" \
  --notes "Release notes."
```

## Current Stable Release

Current stable local platform baseline:

- tag: `v0.1.0-local-platform`
- commit: `6e1713b91fbbd4643788584c4385c119c1c044d6`
- release: `https://github.com/voldzi/AI-KnowledgeBase/releases/tag/v0.1.0-local-platform`

## Rollback

For code rollback, create a revert PR instead of rewriting history:

```bash
git switch main
git pull --ff-only origin main
git switch -c revert/<short-description>
git revert <commit-or-range>
```

For local runtime rollback, check out the stable tag and rebuild:

```bash
git fetch --tags origin
git switch --detach v0.1.0-local-platform
docker compose --env-file .env -f infra/docker-compose/docker-compose.dev.yml --profile ai up -d --build
```

Use detached tag checkout only for verification or emergency local recovery. Normal development continues from `main`.

## Immutable `docker.home.cz` Release

Production is released by an approved full Git SHA, not by refreshing the
mutable `/srv/akl/repo` checkout. Do not run `git pull`, `git checkout`, or
`git switch` there as part of deployment. The release workflow fetches a bare
mirror, verifies that the exact SHA is reachable from protected `origin/main`,
and extracts it read-only under `/srv/akl/releases/<full-sha>`.

After the first immutable release, deploy through the last verified release:

```bash
RELEASE_SHA=0123456789abcdef0123456789abcdef01234567
/srv/akl/current/scripts/deploy_docker_home_release.sh --sha "$RELEASE_SHA"
```

The persistent production environment remains
`/srv/akl/env/akl.prod.env`. Every Compose operation receives that file, the
Compose project, and the target release compose file explicitly. A Registry
change first quiesces the Registry writer and is then backed up and verified
before Alembic runs. Before migration or runtime start, the workflow records
the target in `/srv/akl/state/applied-runtime.env`; readiness, exact image
ID/tag and Compose/release labels, and smoke must pass before
`/srv/akl/current` advances.

Production rollback is forward-fix only. If an image or migration may have
been applied, ordinary deployment is blocked; prepare a reviewed descendant
of the exact applied-runtime SHA and use:

```bash
/srv/akl/current/scripts/rollback_docker_home_release.sh \
  --failed-sha 0123456789abcdef0123456789abcdef01234567 \
  --forward-fix-sha 89abcdef0123456789abcdef0123456789abcdef
```

The full host preparation, backup artifact, failure, and recovery procedure is
in `docs/OPERATIONS/immutable-docker-home-release.md`.
