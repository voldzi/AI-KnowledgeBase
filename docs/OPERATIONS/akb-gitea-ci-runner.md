# AKB Gitea CI Runner Runbook

## Scope

This runbook applies only to the repository-scoped AKB runner on VM125:

- repository: `AKB/ai-knowledgebase`
- runner: `stratos-gitea-ci-vm125-akb`
- registration ID: `6`
- compatibility account: `stratos-ci`
- compatibility service: `stratos-gitea-ci-runner.service`
- capacity: `1`
- logical workflow label: `akb-gitea-ci`

The historically misleading account and service names belong to AKB. Do not
rename them while the runner is active. Do not change the separate STRATOS
account, service, registration, label or cache.

The target immutable mapping is:

```text
akb-gitea-ci:docker://akb/gitea-ci-tools@sha256:2be3431e52dc1cfae642ea744821980c60774485b98c5881593a95558ed518c9
```

## Trust Boundaries

The runner ID 6 has a host Docker socket and a writable AKB dependency cache.
It may run only:

- a protected `main` push; or
- a commit manually reviewed and dispatched by a trusted AKB administrator.

Manual dispatch requires the selected ref and the `approved_sha` input to be
the same full lowercase SHA. Never dispatch a commit before reviewing its
workflow and executable repository code. A fork PR receives no repository
secret or long-lived token.

Automatic untrusted PR execution is disabled in `.gitea/workflows/ci.yaml`.
The prepared template is
`infra/ci/gitea-runner/untrusted-pr-workflow.yaml.example`. Do not enable it
until the following isolated runner exists:

- exact label:
  `akb-gitea-ci-untrusted:docker://akb/gitea-ci-tools@sha256:2be3431e52dc1cfae642ea744821980c60774485b98c5881593a95558ed518c9`;
- disposable dedicated VM or equivalent one-job boundary, capacity one;
- no Docker socket, host namespace, privileged mode or host volume;
- no shared writable cache; job workspace and cache are destroyed after use;
- no Actions secrets, production environment, SSH key or long-lived token;
- ephemeral repository token restricted to read-only contents;
- no route to `docker.home.cz`, storage, databases, Keycloak, scanners,
  observability ingestion or another server-VLAN service;
- outbound network denied by default, with only DNS, time, `git.home.cz:443`
  and an infrastructure-managed read-only dependency proxy allowed;
- no direct public package upload path. The dependency proxy may serve the
  locked npm, Python and Playwright artifacts but must reject publishing.

Before enabling the template, configure the non-secret repository variables
`AKB_CI_NPM_REGISTRY`, `AKB_CI_PYPI_INDEX_URL` and
`AKB_CI_PLAYWRIGHT_DOWNLOAD_HOST` with the read-only proxy endpoints. The
workflow fetches source directly from Gitea with the ephemeral read-only job
token and does not download a third-party checkout action.

After the boundary passes a disposable test, copy the template to
`.gitea/workflows/untrusted-pr.yaml` in a separate reviewed commit. Until then,
PR validation is manual and no pending workflow targets the absent label.

The optional production workflow is manual and separate from CI. Its only
production credential is a dedicated forced-command SSH key, and it may be
configured only after the host procedure and negative tests in
`docs/OPERATIONS/gitea-production-deploy.md` pass. The key does not authorize a
shell and must not be made available to the normal CI workflow.

## Same-SHA Evidence Artifacts

The trusted workflow publishes Phase A resolver input and the final same-SHA
attestation with the Gitea-compatible artifact v4 action pinned to an immutable
source commit. The stock artifact v3 action uses the legacy pipeline protocol;
its success log does not prove that the public Gitea Actions REST API exposes
the artifact.

After each upload, `scripts/ci/verify_gitea_action_artifact.py` queries the
run-scoped public API using the ephemeral repository job token. The job passes
only when the API returns exactly one non-expired, non-empty artifact with the
uploaded ID and name. It verifies the artifact-to-run ID and SHA binding in the
artifact response, then verifies the exact run attempt, SHA, branch and event
against the authoritative run endpoint because Gitea 1.27 returns zeroed
attempt and omitted branch/event fields in the artifact's compact run object.
Zero results, duplicates, drift or an API failure stop the workflow. Never
replace this check with an upload-log assertion or a private pipeline endpoint.

## Coordinated Digest Pin

Perform this only while runner ID 6 is online and idle. Keep an owner-readable
backup outside Git. Never print the registration token.

Before changing the digest, build the reviewed `ci-tools` target with the
public home CA supplied from the VM outside Git. Require successful
`docker buildx version`, `docker compose version`, TLS access to Gitea, and a
content digest for the resulting image. A tag is not an acceptable runner
mapping. Stop and roll back if the image lacks Buildx; immutable release
Dockerfiles may require BuildKit cache mounts.

1. Verify the service is active and enabled, capacity is one, `.runner` is
   owned by `stratos-ci:stratos-ci` with mode `0600`, and the current label is
   still the expected `0.2.0` tag.
2. Verify the approved local image resolves to digest
   `sha256:2be3431e52dc1cfae642ea744821980c60774485b98c5881593a95558ed518c9`.
3. Stop only `stratos-gitea-ci-runner.service`.
4. Update both the `labels` entry in `.runner` and `runner.labels` in
   `config.yaml` to the immutable mapping above. Preserve ownership and mode.
5. Start the same service. Do not restart or edit the STRATOS runner.
6. Confirm runner ID 6 is online, idle, capacity one and publishes only the
   logical label `akb-gitea-ci`.
7. Manually dispatch the reviewed AKB commit and enter the exact full SHA.
   Every job must run on runner ID 6 and finish successfully.
8. If validation fails, restore both backed-up files and restart only the AKB
   service.

## Cache Retention

The maintained tool is `scripts/maintain_gitea_ci_cache.py`. Install the
reviewed file as root-owned code under `/usr/local/libexec/akb-gitea-ci/`.
It touches only `/home/stratos-ci/.cache/akb-ci`, refuses unknown root entries,
uses a non-blocking lock and verifies through the repository-scoped Gitea API
that runner ID 6 is online and idle before `--apply`.

Create a repository-read monitoring token outside Git at
`/etc/akb-gitea-ci/monitor.token`, owner `root:root`, mode `0600`. Do not reuse a
deployment or administrator token. First run the tool without `--apply` and
review its JSON inventory. Then install and enable the supplied service/timer:

- `infra/ci/gitea-runner/systemd/akb-gitea-ci-cache-maintenance.service`
- `infra/ci/gitea-runner/systemd/akb-gitea-ci-cache-maintenance.timer`

The policy is 14 days and at most 10 GB. The tool does not invoke Docker prune
and does not touch STRATOS caches or the shared Docker data root.

## Central Monitoring

Install `scripts/export_gitea_ci_metrics.py` as root-owned code under
`/usr/local/libexec/akb-gitea-ci/`. Use the same read-only token through the
systemd credential mechanism. Install the supplied metrics service and timer:

- `infra/ci/gitea-runner/systemd/akb-gitea-ci-metrics.service`
- `infra/ci/gitea-runner/systemd/akb-gitea-ci-metrics.timer`

The default output is
`/var/lib/node_exporter/textfile_collector/akb_gitea_ci.prom`. Adjust that path
only if the active VM125 node-exporter uses a different textfile collector
directory. The exporter records only service state, runner status, cache size,
free bytes, last successful main SHA/run and whether it matches current main.
It never exports tokens, workflow logs or repository contents.

Load `infra/monitoring/central/akb-gitea-ci-alerts.yml` into the central
Prometheus rules and verify it with the server's `promtool` before reload. The
rules warn below 20 GB free and become critical below 10 GB. They also detect a
stopped/disabled/offline runner, missing metrics, cache above 10 GB and a main
SHA without a successful CI run.

## Acceptance Evidence

Return the following without tokens or configuration secrets:

1. runner ID, repository scope, logical label, immutable image digest and
   capacity;
2. service active/enabled state and `.runner` owner/mode;
3. manually dispatched run ID, exact tested SHA and all job conclusions;
4. cache dry-run/apply summary, resulting size and filesystem free space;
5. node-exporter scrape evidence and loaded central alert rule names;
6. confirmation that no AKB operation changed the STRATOS runner.
