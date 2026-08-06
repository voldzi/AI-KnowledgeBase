# Gitea Primary Repository and GitHub Mirror

## Current State

AKB development uses the private internal Gitea repository as its primary Git
source:

```text
ssh://git@git.home.cz:2222/AKB/ai-knowledgebase.git
```

The former GitHub repository remains an external mirror and recovery copy:

```text
https://github.com/voldzi/AI-KnowledgeBase.git
```

Every developer checkout must use the following remotes:

```text
origin  ssh://git@git.home.cz:2222/AKB/ai-knowledgebase.git
github  https://github.com/voldzi/AI-KnowledgeBase.git
```

The Gitea organisation and repository are private. Credentials, deploy keys,
tokens, secrets, uploaded documents and database backups do not belong in Git.

## Development and Mirror Flow

1. Fetch, branch and push normal work through `origin`.
2. Run focused local validation before requesting review.
3. Mirror the reviewed candidate to `github` without rewriting published
   history.
4. Until Gitea Actions are adopted, GitHub Actions remains the required CI
   gate.
5. Deploy only an exact reviewed SHA after the existing immutable release
   workflow accepts it.

Do not force-push `main`, do not rewrite Git history to remove a secret without
an explicitly approved incident procedure, and do not change production Git
configuration as part of ordinary development work.

## Release Source Status

The immutable production release still reads its configured GitHub URL and
protected `origin/main` ref inside its isolated release checkout. This is
intentional during the transition. It must not be changed merely because a
developer checkout now has Gitea as `origin`.

The future production-source transition requires a dedicated release candidate
and must prove:

- Gitea and GitHub resolve the same protected `main` SHA;
- a Gitea bare mirror can fetch the full required history and tags;
- the exact release SHA is reachable from the protected Gitea `main` ref;
- an immutable release preflight succeeds with the Gitea URL;
- rollback remains possible from the last verified GitHub-backed release;
- no credentials are embedded in environment examples, Compose files or Git
  remotes.

## Future Gitea Actions Proposal

Gitea Actions should be introduced only after the current GitHub CI remains
stable during a parallel observation period. The Gitea workflow should:

1. use the isolated `stratos-ci-runner-01` runners with no production secrets;
2. retain separate light and exclusive labels so Docker and PostgreSQL tests do
   not collide with ordinary checks;
3. use Gitea Actions secrets only for non-production integration credentials;
4. run the same required checks as current CI: web, service tests, Compose,
   Registry/PostgreSQL and immutable release preflight;
5. publish an immutable result manifest and retain job logs for audit;
6. run in shadow beside GitHub Actions for at least ten successful protected
   `main` or pull-request candidates;
7. become a merge gate only after the output, timings and security controls
   have been compared and accepted.

Do not place production SSH keys, production environment files, S3 secrets,
OIDC client secrets or document content in Gitea Actions secrets. Production
deployment remains a separate, operator-controlled immutable workflow.

## Verification Checklist

After a mirror or migration operation, verify:

- `origin` is the Gitea SSH URL and `github` is the GitHub URL;
- the repository is private;
- branch and tag counts match the approved source;
- `main` resolves to the same full SHA in both repositories;
- a clean isolated clone from Gitea succeeds;
- a temporary branch and tag can be pushed and removed again;
- tracked-file and history scans do not report real environment files, keys,
  token files, database dumps or uploaded document storage.

