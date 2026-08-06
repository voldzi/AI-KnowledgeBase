# AKB Gitea Actions Runner Image

This image is the non-production executor for the AKB repository-scoped
Gitea Actions runner on VM125. It intentionally uses Debian Bookworm rather
than Alpine: the Playwright Chromium binaries used by `apps/web` require a
glibc runtime.

Build and operate it only on VM125 through the runner's local Compose project.
The private `git.home.cz.crt` is provisioned on the VM and is not tracked in
this repository. The runner has no production environment file, deployment
credential, or SSH key for `docker.home.cz`.

The Docker socket is present only for the immutable-release contract check.
Workflows must not use it to deploy AKB or access production configuration.
