# Budget Cursor Pagination Handoff

## Purpose

AKB has implemented safe cursor traversal for a Director Copilot V2 count. It
loads each authorized page and returns a count only when the final cursor is
empty and the unique loaded item count equals the source-owned
`candidate_count`.

## Production Finding

Against Budget release `f6e581b6d143ddc3d5bacc9d137eab85937ad90c`, the first
page of the authorized 2025 procurement-action count succeeds. The second
request, using the returned cursor, is rejected with HTTP 400 and
`DIRECTOR_COPILOT_CONTRACT_INVALID`.

The relevant AKB correlation identifiers are:

- first page: `405547d3-c407-424d-97a2-33ca4b95d1ad`;
- rejected second page: `48c94fb5-3d53-465e-a9a0-92bd0f44ac69`.

No token, secret, prompt, response payload, or document content is included in
this handoff.

## Root Cause

Budget calculates the cursor query fingerprint from all request parameters,
including `cursor`. The first cursor is encoded from a request with
`cursor: null`; the page-two request has the cursor value itself, therefore
calculates a different fingerprint and cannot validate the previously issued
cursor.

The cursor itself is transport state, not a semantic query parameter. It must
not affect the query fingerprint.

## Required Budget Change

1. Normalize pagination parameters before both cursor encoding and decoding:
   preserve every semantic parameter but use `cursor: null` for the query
   fingerprint.
2. Keep the normal protections unchanged: a cursor must still fail for a
   changed scope, year or interval, scenario, metric, granularity, grouping,
   filter, order, or an altered cursor value.
3. Preserve the source contract: Budget must honor requested page limits and
   must not report a single page as a complete count.
4. Treat every cursor page as an independent tool call. AKB deliberately sends
   a new `tool_call_id` and matching `Idempotency-Key` for each page; Budget
   must validate that header against the current request, not require the first
   page identifier to be reused.

## Required Tests

- Request page one with `limit: 1`; receive a non-empty cursor.
- Use that exact cursor on page two with a new valid `tool_call_id`; expect a
  successful response.
- Traverse the complete 74-item fixture and verify the final cursor is empty.
- Reject a tampered cursor and a cursor replayed with any changed semantic
  parameter or access scope.
- Verify the route remains fail-closed for Information Policy and scope
  denials.

## AKB Acceptance After Budget Deployment

For `Kolik akcí má plán na rok 2025?`, AKB must load all pages, observe
`items.length === candidate_count`, pass the evidence gate, and return the
complete count. If traversal stops early or any page fails, AKB must not show a
count.
