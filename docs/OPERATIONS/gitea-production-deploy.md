# Gitea Production Deployment

AKB production promotion from Gitea is a separate manually dispatched workflow
in `.gitea/workflows/deploy-production.yaml`. It does not replace the immutable
release implementation on `docker.home.cz`; it supplies a narrow, audited
trigger for that implementation.

## Security Boundary

The workflow deploys only when all of these conditions hold:

- the event is a manual `workflow_dispatch` from `refs/heads/main`;
- `approved_sha` is the full lowercase SHA selected by the workflow and is the
  current Gitea `main` head;
- the operator enters the exact confirmation `deploy-production`;
- a successful `push` run of `.gitea/workflows/ci.yaml` exists for the same
  SHA;
- Gitea serializes the job through the `akb-production-deploy` concurrency
  group;
- the dedicated SSH identity is accepted only by the forced-command gateway
  on `docker.home.cz`.

The deployment key cannot open a shell, forward ports, allocate a terminal or
run an arbitrary command. The gateway accepts only:

```text
deploy <full-sha>
status <operation-id>
verify <full-sha>
```

The gateway starts the existing immutable release entry point in a detached
session, writes an owner-only operator log and atomic status record below
`/srv/akl/ci-deployments`, and returns only a non-secret operation identifier.
The Gitea job polls that identifier until completion and then independently
checks the active release SHA plus public health and readiness.

The workflow necessarily exposes the restricted private key to repository code
during the manually approved deploy job. Therefore only reviewed protected
`main` commits may be dispatched. The key's forced command and SSH `restrict`
options limit the impact to this AKB release interface; they do not make an
unreviewed commit trustworthy.

## Repository Secrets

Configure exactly these repository-scoped Gitea Actions secrets:

- `AKB_PRODUCTION_DEPLOY_SSH_KEY`: dedicated private Ed25519 trigger key;
- `AKB_PRODUCTION_DEPLOY_KNOWN_HOSTS`: pinned trusted SSH host-key line for
  `docker.home.cz`;
- `AKB_GITEA_RELEASE_GATE_TOKEN`: repository-read-only Gitea API token used
  only to verify the successful trusted `main` CI run for the approved SHA.

The release-gate token must have repository `Read` permission and no other API
scope. The checkout step continues to use the ephemeral job token; the
release-gate token is used only for the Gitea Actions API query. Do not reuse
an operator key, Gitea deploy key, STRATOS key or CI runner registration token.
Do not configure production environment files as Actions secrets. Secret
values must never be printed in workflow logs.

The release-gate API client uses the CI image's system `curl` and system CA
store so the internal `home-CA` trust installed by infrastructure is honored.
The token is supplied through an owner-only temporary curl configuration file,
not through process arguments, and the file is removed when the check exits.

## Host Installation

Install the reviewed gateway from the exact merged commit as:

```text
/usr/local/sbin/akb-gitea-deploy-gateway
```

It must be root-owned, non-writable by the deployment account and executable.
Create `/srv/akl/ci-deployments` owned only by the existing AKB deployment
operator with mode `0700`. Add the dedicated public key to that operator's
`authorized_keys` using this prefix:

```text
restrict,command="/usr/local/sbin/akb-gitea-deploy-gateway"
```

Append the single public key on the same line. Preserve every unrelated key.
The infrastructure administrator must validate the final line with `sshd -T`
and a negative SSH test: shell, port forwarding, an unknown command and an
invalid SHA must all fail.

The production host also needs a separate read-only Gitea deploy key for the
bare release mirror. Store that key and the trusted `git.home.cz` host key
outside Git. Configure the deployment operator's SSH client to use it only for
`git.home.cz:2222`. Set the production release source to:

```dotenv
AKL_RELEASE_GIT_URL=ssh://git@git.home.cz:2222/AKB/ai-knowledgebase.git
AKL_RELEASE_TRUSTED_REF=refs/remotes/origin/main
```

Before changing the URL, verify the new read-only identity can fetch Gitea.
Then update the existing bare mirror's `origin` to the same exact URL. The
immutable release preflight rejects any mismatch.

## First Acceptance Run

1. Merge the reviewed implementation into protected `main`.
2. Wait for the automatic `AKB CI` push run for that exact SHA to succeed.
3. Confirm runner ID 6 is online, idle, capacity one and pinned to the approved
   immutable CI image digest.
4. Confirm no STRATOS or AKB deployment is active on `docker.home.cz`.
5. In Gitea Actions, manually run `AKB production deploy` from `main`, enter the
   exact main SHA and `deploy-production`.
6. Require the workflow to report the CI run ID, operation ID, verified release
   SHA, health and readiness success.
7. On `docker.home.cz`, independently inspect `/srv/akl/current`, the immutable
   deployment record and affected container revisions without printing env or
   credentials.

If the host release burns the target SHA and fails, do not retry it. Follow the
documented descendant forward-fix procedure. Cancelling the Gitea job does not
cancel a detached host deployment; use its operation ID and host evidence to
determine the actual state.

## Rollback Of This Integration

Disable the `AKB production deploy` workflow, remove the three repository secrets
and remove only the dedicated forced-command public key. Keep the immutable
host release machinery and Gitea read-only mirror intact. Do not delete release
records, burned-SHA markers, backups or operator logs.
