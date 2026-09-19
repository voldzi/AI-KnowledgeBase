# Real Chat API diagnostic — 19 September 2026

## Scope and immutable checkpoint

Completed 200 real authenticated Chat requests: 100 approved manifest laws,
two requests per law, against RAG `f957ebe05ecd4460200ecff52c1be7d2329b482a`.
Three concurrent workers completed the run in 1,382 seconds (23 minutes).
No application deployment or intentional index change occurred during the run.
This did not freeze external authorities, ingestion or model-provider state.

The first question asks for the purpose of the named law in ordinary Czech.
The second asks what it means in practice for an employee. Where a first
answer supplied evidence, the second request carries its exact parent and
source-scope hash. Otherwise it retries an explicit source question; those
cases do not count as successful continuity. One available citation is opened
per pair. This is a diagnostic of API behaviour and source continuity, **not
a reviewed factual/completeness benchmark or pilot acceptance**. It contains
200 generated prompts using two templates, not 200 independently authored
user scenarios.

## Results

| Measure | Result |
|---|---:|
| Requests completed | 200 |
| HTTP 200 | 179 |
| HTTP 502 / 503 | 16 / 5 |
| Answer / no answer / restricted | 177 / 1 / 1 |
| Replies persisted / failed to persist | 178 / 1 |
| Pairs meeting every operational criterion | 83 / 100 |
| Explicit source continuity attempted / preserved | 88 / 85 |
| Pairs with successful citation open | 92 / 100 |

Passing means two answer responses, exact first-source title, unchanged source
version set, successful citation access and both turns persisted. This does
not establish that every claim or practical recommendation is correct.
Deterministic shadow claim checking flags many paraphrases; its status is
neither a factual gold label nor permission to call all responses correct.

## Triage

- Eight laws returned 502 in both turns: 90/1995, 218/2000, 243/2000,
  250/2000, 262/2006, 89/2012, 222/2016 and 23/2017. A separate exact probe
  established stale official evidence for 90/1995; the same root cause must
  not be asserted for every other law without checking.
- Five single-turn 503s: 131/2000, 219/2000, 90/2012, 430/2024, 431/2024.
  Two pairs attempted a bound follow-up but received an error, rather than
  switching to a different law.
- 227/2009: the bound follow-up declined for insufficient context. This is
  a coverage problem to review, not proof of unauthorized evidence access.
- 250/2017: both answers and citation passed, but the second turn reported
  failed conversation persistence. A subsequent authorized conversation read
  returned all four messages, including that answer. This is an unconfirmed
  write receipt/transient read failure, not demonstrated data loss. Recovery
  must match the exact turn ID and fresh user authorization; never blindly
  repeat an append or use the last message of a concurrent conversation.
- 82/2018: first response restricted, explicit retry used historical evidence.
  The revoked/replaced-law presentation needs review; no access bypass is
  established by these results.
- 190/2023: the exact-title metric failed because citations were to 412/2025
  and 264/2025. Manual inspection showed the response explicitly disclosed
  repeal and lack of the complete original text. This is not the same as an
  undisclosed topic switch; factual equivalence still needs source review.

No bound successful answer in this run cited a version outside its parent's
source set. Of three attempted continuity cases without a preserved set,
two returned 503 and one returned no answer. This narrow result does not
cover concurrent turns, revoked grants or arbitrary free-form conversation.

## Follow-up and acceptance

1. Repair freshness and immutable temporal-closure handling with STRATOS;
   preserve historical document/version identifiers and policy snapshots.
   Separate frequent metadata discovery from expensive ingestion, and avoid
   a failed historical item starving the remaining collection.
2. Resolve the persistence failure and individually classify/retest the
   upstream 502/503 cases using correlation IDs. Do not blindly repeat all 200.
3. Improve coverage and employee-role clarification; qualify cross-encoder,
   adjacent-page context and independent claim checking on real evidence.
4. Build the reviewed diverse 240-scenario plus 60-held-out evaluation from
   the roadmap: factual support, completeness, temporal validity, comparisons,
   multi-turn corrections, topic return and authorization boundaries.

After this run, RAG `3666380` was selectively deployed. Its focused live
procurement → statistics-law switch, procurement-principles answer, exact
citation, anonymous rejection and forged-binding rejection passed. The
200-request result above belongs to `f957ebe`, not this subsequent revision.

The approved discovery endpoint then confirmed collection revision 2 and the
new 90/1995 version effective 2026-09-15. One targeted standard source sync
completed (HTTP 200, ingestion `completed`), creating
`ver_d3ec84a98cb24220b947abdf45f4cb63` on existing document
`doc_52388544a7024522983d0ac68dc27eab`. No old interval correction or bulk
reindex was requested. A fresh Chat query returned an answer from that exact
new version, persisted it and opened its citation (all HTTP 200). This repairs
the current-source case; it does not establish that earlier citations whose
open-ended evidence changed now pass admission. STRATOS's append-only temporal
closure contract remains a local proposal pending joint implementation/tests.

Metadata-only results are retained in the task artifact
`2026-09-19-chat-200-api-results.json`; raw authenticated response bodies remain
in private temporary files outside the repository. No credentials were
included in the report.
