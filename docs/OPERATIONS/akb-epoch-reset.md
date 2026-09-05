# AKB Empty-Epoch Operations

## Supported Scope

An empty STRATOS database is not an empty AKB installation. AKB independently
owns Registry metadata and versions, document blobs, ingestion/job state,
search/vector indexes, citations/source-open references, RAG/chat history,
evaluation business data, audit, and cache/session authorization bindings.

The repository provides isolated technical rehearsals through
`tools/clean_pilot_stack_rehearsal.py`. They are disposable-only and do not
authorize a production reset. Keep their isolation guards intact.

There is currently no approved production reset command in this runbook.
`tools/reset_akb_epoch.py` is unconditionally blocked by
`retire_legacy_mutation` before reading or changing stores, including in
dry-run mode. Do not remove that guard or copy its destructive routines into
an operator shell. It is not a supported inventory or production tool.

## Production Change Prerequisites

Prepare a separate, reviewed owner change before touching production data:

1. Record the exact deployed release, store identities and owners, writers,
   service dependencies, and the intended empty-epoch boundary. Do not infer
   targets from default environment values or a compose project name.
2. Explicitly authorize the data scope. Preserve identity infrastructure and
   STRATOS data. Archive required audit evidence with restricted access.
3. Create a complete backup and independently verify its digest and isolated
   restore. A JSON assertion of successful backup is not proof of recovery.
4. Rehearse the exact topology twice on new isolated stores. Prove bootstrap,
   a second no-op bootstrap, all-store zero counts, stale-ID denial and
   cleanup limited to those disposable resources.
5. Define the coordinated cutover, maintenance window, writer pause,
   rollback and post-cutover checks. Prefer a new isolated empty store set
   with a reversible cutover over deletion of the only working copy.
6. Obtain the production change approval after these prerequisites pass.
   Resetting STRATOS or passing a source-only rehearsal is not this approval.

Missing or contradictory target, backup, restore, rehearsal or approval
evidence means STOP. Never fabricate evidence to make a gate pass.

## Acceptance Evidence

Before enabling the first customer import, record aggregate counts for:

- Registry documents, immutable versions, assignments/publication bindings;
- document blobs and attachments, including their byte count;
- ingestion jobs and durable worker state;
- OpenSearch chunks and Qdrant vectors in every active collection;
- citations, source-open references and stale version IDs;
- chat/RAG conversations, messages and sharing bindings;
- evaluation business datasets and reports;
- old authorization/session/cache bindings and derived workflow tasks;
- the new audit boundary and the separately verified prior audit archive.

Zero must be demonstrated across the stores and through authorized read
surfaces, not inferred from an empty UI list. After enabling maintenance and
integration writers, repeat the counts and stale-ID checks. No bootstrap,
fixture, connector or escalation cycle may recreate old business data.

Record health/readiness and a separately authorized new-epoch
upload/index/search/chat/citation smoke. Keep production evidence outside
Git when it identifies the environment; never include tokens, credentials,
document bodies, prompts, answers or personally identifying data.
