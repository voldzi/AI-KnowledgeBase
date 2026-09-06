# Chat history rendering profile — 2026-09-05

The working candidate bounds the transcript to 60 messages and memoizes unchanged
message content. In the local controlled profile with 1,000 question/answer
pairs, transcript DOM fell from 58,001 to 1,741 elements, median history rendering
from 472.5 to 36.3 ms, and the input-to-two-animation-frames p95 from 229.1 to
16.3 ms. This is a local client rendering measurement, not production INP or an
end-to-end service latency claim.

## Method and evidence

`apps/web/scripts/profile-chat-history.mjs` bundles the actual `AkbAssistantApp`
with production React. The harness bundles all shared STRATOS CSS imports and AKB
styles, applies the chat shell's bounded viewport, and serves synthetic history
through the real component's history fetch path. External requests are blocked.
Each pair contains a user message, a Markdown answer with a heading/list, and a
synthetic citation. No live source, stored user conversation or provider data is
used.

The comparison uses the same candidate, fixtures and styles. The reference
variant disables only the render window and content memo in an in-memory build;
it never changes a repository file or enables a runtime bypass. This isolates
the previously unbounded rendering behavior while keeping security changes and
the test layout identical. It is not a comparison of two deployed releases.

Conditions: local macOS, Node v26.4.0, installed Playwright Chromium headless,
1440×900 viewport, CPU throttle 1×, reduced motion, three independent browser
contexts per size and ten typed characters per context. `historyReadyMs` runs
from the synthetic history response until two animation frames after message
DOM appears. Typing samples run from the native input event to two subsequent
animation frames. History numbers are medians of three runs; typing p95 uses
nearest rank across 30 samples. Network/PDP cost, Next hydration, mobile hardware,
large report tables and memory use are outside this profile.

| Pairs / messages | Variant | Rendered messages | Transcript elements | History median | Typing p95 |
| --- | --- | ---: | ---: | ---: | ---: |
| 500 / 1,000 | Unbounded reference | 1,000 | 29,001 | 261.7 ms | 157.9 ms |
| 500 / 1,000 | Bounded candidate | 60 | 1,741 | 34.9 ms | 16.3 ms |
| 1,000 / 2,000 | Unbounded reference | 2,000 | 58,001 | 472.5 ms | 229.1 ms |
| 1,000 / 2,000 | Bounded candidate | 60 | 1,741 | 36.3 ms | 16.3 ms |

Raw samples: [reference](chat-history-performance-2026-09-05/reference.json) and
[candidate](chat-history-performance-2026-09-05/bounded.json). Reproduce from
`apps/web` with the installed browser cache:

```sh
PLAYWRIGHT_BROWSERS_PATH=/private/tmp/akb-intake-playwright node scripts/profile-chat-history.mjs --unbounded-reference --output /private/tmp/chat-reference.json
PLAYWRIGHT_BROWSERS_PATH=/private/tmp/akb-intake-playwright node scripts/profile-chat-history.mjs --output /private/tmp/chat-bounded.json
```

The first exploratory harness did not expand shared CSS imports or apply shell
height; its samples are excluded from the table and the retained evidence.

## Behavior and verification

- The complete authorized history stays in application memory. Server responses,
  current source authorization and whole-conversation redaction are unchanged;
  this is a rendering bound, not API paging or a memory bound.
- Older/newer controls reach every message, including a short first page, without
  duplication between adjacent pages. A live range names the displayed messages.
  Paging focuses the first message; explicit latest focuses the last. Older
  pages do not announce an entire transcript as live additions.
- Sending a question reveals the latest page and its pending answer. Reading an
  older page stays anchored when a response completes; an in-viewport new-answer
  control leads back to the latest page. Citation selection follows visible
  answers and obsolete preview requests/context are cleared on page changes.
- Existing smooth following honors reduced motion. The pending-answer pulse now
  also becomes static with that preference. Navigation uses shared STRATOS buttons
  and the existing design tokens.

Focused verification: 24 unit tests passed across transcript coverage,
clarification binding, recovery, Markdown security, layout and existing UX
contracts. Seven browser tests passed (two history-window cases, two clarification
cases, Stop, answer sources and retry). The history-window cases use the complete
styled viewport and assert 2,000-message
history, a maximum of 60 rendered messages, keyboard focus, citation reset,
pending completion, visible new-answer control and reduced motion. TypeScript
checking passed after the E2E fixture types were corrected. The clarification
tests inspect the actual submitted browser payload after a later unrelated
question, verify separate form values and context, and reject unbound stored
history without making a clarify request. Unit cases also reject a deleted,
blank, wrong-role or out-of-order original prompt.

The reviewed [desktop](chat-history-performance-2026-09-05/desktop.png) and
[mobile](chat-history-performance-2026-09-05/mobile.png) screenshots show the actual
component in the synthetic harness. They verify bounded transcript/composer layout
and wrapped controls at 390 px; they do not represent the full authenticated shell.

Follow-up profiling should measure authorized history response size and current
PDP latency, large server-owned report artifacts and lower-end devices. Any future
server paging design must retain complete dependency authorization before a
source-derived title or prompt is disclosed. Timing thresholds are not hardcoded
into CI from these machine-specific samples; deterministic rendering and behavior
bounds are tested instead.
