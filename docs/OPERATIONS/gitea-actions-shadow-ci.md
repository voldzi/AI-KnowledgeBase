# Gitea Actions CI

## Purpose

Gitea is AKB's primary internal Git server. The workflow in
`.gitea/workflows/ci.yaml` is a verification-only CI path on the dedicated
repository-scoped runner. It has no production secrets, no SSH key for
`docker.home.cz`, and no deployment step. Production promotion, when enabled,
is a separate manually approved workflow described in
`docs/OPERATIONS/gitea-production-deploy.md`.

GitHub Actions remains the required release gate until this workflow has shown
equivalent results for at least ten representative branches and pull requests,
including immutable-release validation and the web E2E job.

## Runtime impact selection

The trusted CI workflow always runs the repository standards job. It also
computes an impact plan from the exact Git diff and runs only the web,
individual Python service, Compose, and immutable-release jobs affected by the
candidate. A change under a shared contract, OpenAPI, an unknown path, or a
candidate with no reliable comparison base selects the full runtime suite.
This is a scheduling optimisation, not an authorisation or security exception.
The runner remains single-concurrency and workflow jobs must not overlap.
Known CI-only files under `.gitea/workflows/` and `scripts/ci/` run the
repository standards and their classifier tests, but have no production
runtime owner and therefore do not trigger application tests or release-fault
simulation by themselves.
Each job has a bounded execution time. A timeout is a failed verification,
never a pass or a permission to deploy, and prevents a faulty test or upstream
dependency from consuming the runner indefinitely.

Production still builds only the affected service set selected by the
immutable release script. Building signed images once on VM125 and promoting
them without rebuilding on `docker.home.cz` is intentionally not enabled yet:
it requires a separately approved internal OCI registry or equivalent
verified artifact transport, image provenance, retention, and rollback
design. Until then, CI validates the candidate and production performs the
existing exact affected-image build.

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
- logical workflow label: `akb-gitea-ci`
- approved immutable runner mapping:
  `akb-gitea-ci:docker://akb/gitea-ci-tools@sha256:2be3431e52dc1cfae642ea744821980c60774485b98c5881593a95558ed518c9`

Do not publish `stratos-gitea-ci`, `stratos-gitea-ci-tools`, or another
STRATOS-owned label from this runner. Every `runs-on` value in the AKB Gitea
workflow must be `akb-gitea-ci`. Existing GitHub runners are independent and
must not be changed by an AKB Gitea runner operation.

The maintained Debian Bookworm image is defined in
`infra/ci/gitea-runner/Dockerfile`. It provides Node.js, pnpm, Python, Ruby,
ShellCheck, GNU core utilities, Docker Compose and the glibc browser runtime
required by Playwright. Persistent package, browser, and Next.js build caches
are mounted only inside the job container. A Docker socket is mounted solely for immutable
release contract and Compose validation; the runner has no production env,
deployment credential, or permitted path to production promotion.

The privileged workflow runs automatically only for `main`. A reviewed commit
may be run through manual dispatch only when the administrator enters the same
full SHA as the selected ref. Automatic pull requests are prohibited because a
workflow can execute repository code while the runner has the host Docker
socket. The separate untrusted template and its required network boundary are
documented in `docs/OPERATIONS/akb-gitea-ci-runner.md`.

## Promotion Criteria

1. Run Gitea and GitHub checks for ten representative changes.
2. Resolve every difference in tests, OpenAPI, secret scanning, Compose, or
   image validation.
3. Verify cache isolation and safe logs.
4. Review runner labels, container isolation, and Actions permissions.
5. Protect `main` with the Gitea workflow after the evidence is complete.
6. Enable the separate manual production workflow only after its forced-command
   host gateway, exact-main CI gate, secrets and negative SSH tests pass.

## Rollback

Before changing runner registration, keep an owner-readable backup of its
`.runner` file and retain the old Gitea registration until a manual workflow on
the new label succeeds. To roll back, stop the service, restore that file and
restart the same service. Delete the old registration only after the new
runner is online and the test workflow passes. This does not affect GitHub
Actions, source code, or running AKB services.
