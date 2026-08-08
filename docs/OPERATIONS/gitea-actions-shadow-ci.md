# Gitea Actions CI

## Purpose

Gitea is AKB's primary internal Git server. The workflow in
`.gitea/workflows/ci.yaml` is a verification-only CI path on the dedicated
repository-scoped runner. It has no production secrets, no SSH key for
`docker.home.cz`, and no deployment step.

GitHub Actions remains the required release gate until this workflow has shown
equivalent results for at least ten representative branches and pull requests,
including immutable-release validation and the web E2E job.

## Runner Registration

Create a repository-scoped runner token in Gitea for `AKB/ai-knowledgebase`.
The token is single-use and must be entered directly on VM 125; do not place it
in a shell history, repository file, workflow, or chat transcript.

The dedicated AKB runner on VM 125 is registered as
`stratos-gitea-ci-vm125-akb`. Historical account and service names are retained
for operational compatibility:

- system account: `stratos-ci`
- systemd service: `stratos-gitea-ci-runner.service`
- capacity: one concurrent job
- only accepted workflow label:
  `akb-gitea-ci:docker://akb/gitea-ci-tools:0.2.0`

Do not publish `stratos-gitea-ci`, `stratos-gitea-ci-tools`, or another
STRATOS-owned label from this runner. Every `runs-on` value in the AKB Gitea
workflow must be `akb-gitea-ci`. Existing GitHub runners are independent and
must not be changed by an AKB Gitea runner operation.

The maintained Debian Bookworm image is defined in
`infra/ci/gitea-runner/Dockerfile`. It provides Node.js, pnpm, Python, Ruby,
ShellCheck, GNU core utilities, Docker Compose and the glibc browser runtime
required by Playwright. Persistent package and browser caches are mounted only
inside the job container. A Docker socket is mounted solely for immutable
release contract and Compose validation; the runner has no production env,
deployment credential, or permitted path to production promotion.

The workflow runs for pull requests, merges to `main`, and explicit manual
dispatch. It deliberately does not also run on every `codex/**` push because
that would duplicate the pull-request validation for the same SHA.

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

Before changing runner registration, keep an owner-readable backup of its
`.runner` file and retain the old Gitea registration until a manual workflow on
the new label succeeds. To roll back, stop the service, restore that file and
restart the same service. Delete the old registration only after the new
runner is online and the test workflow passes. This does not affect GitHub
Actions, source code, or running AKB services.
