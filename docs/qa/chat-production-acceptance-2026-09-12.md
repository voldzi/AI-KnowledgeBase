# Production Chat acceptance — 2026-09-12

## Repeatable plan

Run the acceptance through `tools/akb_chat_mcp.py` and the public AKB web
bridge. A grounded-answer case passes only when the response is `answer`, has
at least one citation, and every returned citation can be opened after a fresh
authorization decision. HTTP 200 alone is not a pass.

The minimum release set covers:

1. public health and readiness;
2. common employee questions across contracts, employment, procurement,
   information access, accounting, administrative procedure, and budgets;
3. exact controlling legal facts and human-readable wording;
4. fresh citation reauthorization;
5. an ambiguous question and an invented internal rule;
6. anonymous denial;
7. latency, with target time to first visible response below 2 seconds,
   median complete response below 8 seconds, and p95 below 15 seconds.

Before pilot promotion, add a second user with narrower grants and verify TLP,
group and explicit revocation behavior against a non-public document. Keep the
current public-law suite as a regression baseline and expand it with feedback
from real employee questions.

## Production result

The eight grounded legal areas passed across the deployed acceptance runs.
The final remediation replay passed 3/3 previously failing questions and
freshly reauthorized 22/22 citations. The anonymous chat request returned 401.
An ambiguous question and an invented internal-policy question both returned
safe `no_answer` responses without citations.

Correctness and authorization passed. Performance did not meet the target:
observed complete responses ranged from 20.1 to 42.1 seconds. The ambiguous
question was safe but should ask a clarifying question instead of returning a
generic no-answer message.
