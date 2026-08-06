# Gitea Actions Shadow CI

## Purpose

Gitea is AKB's primary internal Git server. The workflow in
`.gitea/workflows/ci.yaml` is a verification-only CI path on the internal
runner. It has no production secrets, no SSH key for `docker.home.cz`, and no
deployment step.

GitHub Actions remains the required release gate until this workflow has shown
equivalent results for at least ten representative branches and pull requests,
including immutable-release validation and the web E2E job.

## Runner Registration

Create a repository-scoped runner token in Gitea for `AKB/ai-knowledgebase`.
The token is single-use and must be entered directly on VM 125; do not place it
in a shell history, repository file, workflow, or chat transcript.

The `github-runner` account on VM 125 runs the Gitea runner in addition to the
existing GitHub runners. The runner has a single execution slot and registers
two host-executor labels:

- `akb-gitea-light`: standards, web, Python, and Compose checks.
- `akb-gitea-exclusive`: immutable-release contract checks, serialized with
  every other AKB Gitea job by the single execution slot.

Its maintained image provides Node.js, pnpm, Python, Ruby, ShellCheck and the
Docker Compose plugin. Persistent package and browser caches are mounted only
inside the runner. A Docker socket is mounted solely to validate Compose files;
the runner has no production env file, deployment credential, or permitted
path to production promotion. Treat the runner host as CI-administration
infrastructure and keep it separate from application production hosts.

## Promotion Criteria

1. Run Gitea and GitHub checks for ten representative changes.
2. Resolve every difference in tests, OpenAPI, secret scanning, Compose, or
   image validation.
3. Verify cache isolation and safe logs.
4. Review runner labels, container isolation, and Actions permissions.
5. Protect `main` with the Gitea workflow after the evidence is complete.
6. Keep production promotion manual and immutable until a separate reviewed
   change introduces a production deployment mechanism.

## Rollback

Disable the Gitea workflow or stop the Gitea runner service. This does not
affect GitHub Actions, source code, or running AKB services.
