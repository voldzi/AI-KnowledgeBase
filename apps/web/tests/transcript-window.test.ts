import assert from "node:assert/strict";
import { test } from "node:test";
import { transcriptWindow, TRANSCRIPT_WINDOW_SIZE } from "../src/lib/assistant/transcript-window";

test("walking backward reaches every authorized message exactly once, including short first pages", () => {
  for (const total of [0, 1, 60, 61, 125, 2000]) {
    const seen: number[] = [];
    let end: number | null = null;
    do {
      const page = transcriptWindow(total, end);
      assert.ok(page.end - page.start <= TRANSCRIPT_WINDOW_SIZE);
      seen.unshift(...Array.from({ length: page.end - page.start }, (_, index) => page.start + index));
      end = page.start;
    } while (end > 0);
    assert.deepEqual(seen, Array.from({ length: total }, (_, index) => index));
  }
});

test("an older page stays anchored while pending messages arrive and latest includes the pending answer", () => {
  const olderPage = transcriptWindow(2000, 1940);
  assert.deepEqual(transcriptWindow(2002, 1940), olderPage);
  assert.deepEqual(transcriptWindow(2002, null), { start: 1942, end: 2002, isLatest: true });
});
