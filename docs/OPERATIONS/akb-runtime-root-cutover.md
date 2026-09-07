# AKB production root cutover

The production target is `/srv/akb`. It is a new immutable release root with
its own `releases`, `current`, `state`, `env`, `git`, `prebuilt`, `backups`,
`ci-deployments`, and `deployments` directories. `/srv/akl` remains untouched
as a rollback source until the recorded acceptance window is complete.

Before the first promotion, an operator runs the reviewed root preparation as
root. It creates only private directories and a bare source mirror; it does not
copy documents, databases, Qdrant collections, object storage, or secrets.

```bash
sudo /path/to/scripts/provision_akb_release_root.sh voldzi https://git.home.cz/AKB/ai-knowledgebase.git
```

The operator then provisions `/srv/akb/env/akb.prod.env` and every referenced
mode-`0600` secret file from the governed secret source. The new env must set
`AKL_RELEASE_COMPOSE_PROJECT=akb`; inherited `AKL_*` application variables are
technical compatibility keys and retain their documented semantics.

Install the reviewed forced-command gateway from the merged release before
adding its deployment key. It defaults to `/srv/akb` and rejects conflicting
`AKB_RELEASE_ROOT` and legacy `AKL_RELEASE_ROOT` values. On its first deploy it
materializes the exact target from the private bare mirror only after proving it
is reachable from `refs/remotes/origin/main`, then invokes the immutable
bootstrap entry point. Every later release starts from `/srv/akb/current`.

After promotion, verify the target SHA, image identities, `/akb/api/health`,
`/akb/api/ready`, the governed source intake and Chat citation path. Do not
retire `/srv/akl` until the separate rollback and data-migration acceptance is
recorded.
