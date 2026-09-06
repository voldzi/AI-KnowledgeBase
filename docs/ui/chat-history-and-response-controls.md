# Chat history and response controls

Current working implementation, 2026-09-05. Production promotion is separate.

The send control becomes **Zastavit čekání / Stop waiting** while a request is
active. It cancels that browser request and its recovery polling, keeps a neutral
stopped message, and permits another question immediately. Late responses and
completion handlers from an older request cannot overwrite the new request.
Switching threads cancels waiting for the previous thread. This does not promise
that an upstream server job or already-started persistence operation is canceled.

Each sourced answer has its own **Zdroje odpovědi / Answer sources** control.
Selecting it changes the source panel and citation modal to that answer's
document citations and live-source status. Changing selection clears and cancels
the previous source preview. A newly submitted question returns source selection
to the newest response.

A failed history load offers **Načíst znovu / Try again**. Retry starts a fresh
request; navigation cancels the old load. Pending history is not shown as a new
empty thread.

Long conversations render at most 60 messages at once. **Starší zprávy / Older
messages**, **Novější zprávy / Newer messages** and **Nejnovější zprávy / Latest
messages** expose the full history with an announced visible range. Paging moves
keyboard focus into the selected section; explicit latest focuses the last
message. Sending a question reveals its pending answer. Reading older messages
stays anchored when a reply arrives, with a visible new-answer control.
Citation selection and previews follow the visible response section. Unchanged
message content is memoized, and reduced motion disables the waiting pulse.
The full authorized history remains in memory and the server's source checks
remain complete. This is a rendering limit, not API paging or a memory limit.
See the [measured profile](../qa/chat-history-performance-2026-09-05.md).

Clarification controls use the original question explicitly bound to that
response, its context and its own form values. A later question cannot change
that binding, and repeated field names in different responses remain separate.
If the original message is missing or an imported/stored response has no explicit
binding, continuing fails visibly and asks for a new question. The UI never
substitutes the most recent unrelated prompt.

History returned after source revocation or unavailable authority contains no
title, prompts, derived answers, citations or report metadata. Registry inventories
without complete source coordinates and stored federated STRATOS answers use a
neutral receipt asking for a new query. This is an intentional current limitation
until [ADR 0018](../adr/0018-federated-history-authority.md) is implemented.

Markdown images in answers and citation context appear only as their text
description; no image URL is loaded automatically. PDF/XLSX exports require a complete exact-version policy on every
row citation and current export permission. Uncited inventory exports remain
unavailable until a server-owned artifact/provenance contract exists.

Verification: `assistant-interactions.spec.ts` covers cancellation even when a
transport ignores abort, response-specific citations, and the real history effect
under a failed request followed by retry. Its history harness supplies explicit
initial data because mock API clients intentionally do not retain state across
requests. Handler/PDP tests cover read redaction and export denial separately.
