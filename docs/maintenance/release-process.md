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
