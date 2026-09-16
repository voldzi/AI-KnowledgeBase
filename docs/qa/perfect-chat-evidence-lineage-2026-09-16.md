# Perfect chat: evidence lineage acceptance

Date: 2026-09-16. Candidate branch:
`codex/perfect-chat-evidence-lineage`.

## Defect and resulting behavior

Suggested follow-up questions were rendered as natural language only. A click
therefore started another unrestricted retrieval and the phrase "this law"
could resolve to a semantically similar but different statute. The UI had no
durable identifier for the assistant message that proposed the follow-up, and
RAG did not bind the next answer to the exact document and version pairs used
by that message.

The candidate introduces an explicit message-parent edge and an evidence-frame
hash. A source-bound continuation is accepted only when the referenced
assistant message remains available, its reauthorized citations produce the
same hash, and every new citation belongs to one of the exact original
`(document_id, document_version_id)` pairs. A missing or changed lineage returns
a clarification response. A candidate answer that cites another pair is
discarded.

Ordinary human questions are now planned into one of two explicit scopes:

- `governed_sources` keeps document, legal, contract, financial, project and
  organizational questions on authorized retrieval with citation gates;
- `general_knowledge` may call the configured LLM without AKB chunks or STRATOS
  records and is visibly labelled as a general answer without internal
  evidence.

The general path cannot be selected by a direct RAG call without the explicit
web query plan. It may reuse only an exact parent answer that was source-free,
available, and already marked `general_knowledge_llm`.

## Persistence and compatibility

Migration `0030_assistant_message_lineage` adds the nullable indexed
`assistant_messages.parent_message_id` self-reference. Existing rows remain
valid and no document, document version, TLP, policy binding, chunk, vector or
source object is rewritten. New request and response fields are additive.

Older clients can continue sending independent typed turns. New web and chat
clients attach the latest persisted assistant message where available. A
source-bound UI action is disabled when the durable parent or evidence hash is
missing.

## Local verification

The isolated Docker project `akb-stratos-test` retained its existing volumes
and synthetic identities. Only its ignored runtime configuration was aligned
with the preserved containers. Migration 0030 was applied and the four changed
services were rebuilt. All AKB application containers became healthy and both
public readiness endpoints returned HTTP 200:

- `http://127.0.0.1:3220/akb/api/ready`;
- `http://127.0.0.1:3221/api/ready`.

A black-box API smoke over the built RAG image passed:

- governed answer with citations;
- exact document/version continuity for a suggested follow-up;
- rejection of a changed evidence-frame hash;
- source-free general answer with explicit warning and usage metadata.

No prompt, answer, source text, token or credential was written to the smoke
result.

Regression results:

- web: 1,043 passed;
- RAG Retrieval Service: 357 passed;
- Registry assistant conversation suite: 50 passed;
- skeleton validation: passed;
- repository OpenAPI generation check: passed;
- exact Linux/amd64 production Docker builds for Registry, RAG, web and chat:
  passed;
- isolated local Docker builds for the same four services: passed.

The host Node runtime reports a version warning because it is Node 24 while the
repository pins Node 26.8.1. The exact production web images compiled and ran
their TypeScript/build checks on the pinned Node 26.8.1 base.

## Quality evaluation gate

`scripts/evaluate_assistant_source_continuity.py` runs two human-style Czech
questions against each of the 100 immutable `czech-law` revision-2 roots. It
checks 200 API turns without retaining prompts, answers, tokens or cookies. The
report contains only case ids, statuses, citation counts, expected-law matches,
lineage results, warning codes and latency aggregates.

The full evaluator requires an environment containing the governed law corpus.
The preserved local acceptance indexes are empty, so local black-box coverage
uses deterministic dependencies while the 200-turn corpus evaluation is a
post-deployment acceptance gate over the populated pre-pilot environment.

## Feature state and rollback

The candidate does not enable reranking, adaptive retrieval, parent retrieval,
ColBERT or a new index collection. Those modes remain subject to measured
quality comparison after the lineage baseline. Citation and authorization
gates remain mandatory.

Rollback deploys the previous four service images. The nullable lineage column
may remain unused during application rollback. If a schema rollback is later
required, first verify that no new message references it and then run the
Alembic downgrade during a maintenance window. Do not delete conversations or
document/index data as part of rollback.
