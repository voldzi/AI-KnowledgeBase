# AKB Gitea Actions Runner Image

This Dockerfile builds two non-production AKB CI images for VM125:

- `akb/gitea-actions-runner:0.2.0` is the repository-scoped Gitea Actions
  runner.
- `akb/gitea-ci-tools:0.2.0` is the stateless image for isolated CI jobs.

They intentionally use Debian Bookworm rather than Alpine: the Playwright
Chromium binaries used by `apps/web` require a glibc runtime and the standard
Linux browser libraries.

Build and operate it only on VM125 through the runner's local Compose project.
The private `git.home.cz.crt` is provisioned on the VM and is not tracked in
this repository. The runner has no production environment file, deployment
credential, or SSH key for `docker.home.cz`.

The Docker socket is present only for the immutable-release contract check.
Workflows must not use it to deploy AKB or access production configuration.

The repository-scoped systemd runner must advertise exactly:

```text
akb-gitea-ci:docker://akb/gitea-ci-tools@sha256:2be3431e52dc1cfae642ea744821980c60774485b98c5881593a95558ed518c9
```

Its capacity is one. Labels beginning with `stratos-gitea-ci` are reserved for
the STRATOS runner and must not be configured on the AKB runner.

The coordinated digest migration, cache retention, monitoring installation and
untrusted pull-request boundary are defined in
`docs/OPERATIONS/akb-gitea-ci-runner.md`. Do not apply runner changes directly
from an Actions job.
