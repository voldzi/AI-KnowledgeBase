# AKB production root cutover

The production target is `/srv/akb`. It is a new immutable release root with
its own `releases`, `current`, `state`, `env`, `git`, `models`, `prebuilt`, `backups`,
`ci-deployments`, and `deployments` directories. `/srv/akl` remains untouched
as a rollback source until the recorded acceptance window is complete.

Before the first promotion, an operator runs the reviewed root preparation as
root. It creates only private directories and a bare source mirror; it does not
copy documents, databases, Qdrant collections, object storage, or secrets.

```bash
sudo /path/to/scripts/provision_akb_release_root.sh voldzi ssh://git@git.home.cz:2222/AKB/ai-knowledgebase.git
```

The operator then provisions `/srv/akb/env/akb.prod.env` and every referenced
mode-`0600` secret file from the governed secret source. During the one-time
cutover, the reviewed `scripts/migrate_akb_runtime_configuration.sh` may create
that private configuration and copy only its referenced private files. It
refuses links and does not copy documents, databases, vector collections,
object storage, releases, Docker volumes, or model artifacts. The Docling
bundle is provisioned separately from the exact release manifest. The new env sets `AKL_RELEASE_COMPOSE_PROJECT=akb`; inherited `AKL_*`
application variables are technical compatibility keys and retain their
documented semantics.

Before the first promotion, build and load the repository's
`services/platform-infrastructure/Dockerfile` for the production architecture
as `akb/platform-status:docker-home`. The first immutable deployment verifies
that this base image exists before burning its target SHA or stopping a writer.
An explicit `PLATFORM_STATUS_IMAGE` in the protected production environment may
select another pre-provisioned immutable reference. The release never builds
this unmanaged infrastructure image after the mutation boundary.

Install the reviewed forced-command gateway from the merged release before
adding its deployment key. It defaults to `/srv/akb` and rejects conflicting
`AKB_RELEASE_ROOT` and legacy `AKL_RELEASE_ROOT` values. On its first deploy it
materializes the exact target from the private bare mirror only after proving it
is reachable from `refs/remotes/origin/main`, then invokes the immutable
bootstrap entry point. Every later release starts from `/srv/akb/current`.

The first activation starts the complete AKB Compose topology, including the
new reverse proxy and platform-status service. This is required because the
gateway has stopped the legacy `akl` project that previously owned the AKB
public port. Later releases retain the narrow affected-service restart path.

After promotion, verify the target SHA, image identities, `/akb/api/health`,
`/akb/api/ready`, the governed source intake and Chat citation path. Do not
retire `/srv/akl` until the separate rollback and data-migration acceptance is
recorded.
