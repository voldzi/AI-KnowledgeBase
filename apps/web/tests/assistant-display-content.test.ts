import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sanitizeAssistantDisplayContent } from "../src/lib/assistant/assistant-display-content";

describe("assistant display content", () => {
  it("removes complete and truncated internal citation markers from persisted history", () => {
    assert.equal(
      sanitizeAssistantDisplayContent("Odpověď [chunk_abc, chunk_def]."),
      "Odpověď.",
    );
    assert.equal(
      sanitizeAssistantDisplayContent("Historická odpověď končí [chunk_"),
      "Historická odpověď končí",
    );
    assert.equal(
      sanitizeAssistantDisplayContent("Historická odpověď končí [chunk_abc123"),
      "Historická odpověď končí",
    );
  });

  it("keeps ordinary bracketed text intact", () => {
    assert.equal(
      sanitizeAssistantDisplayContent("Příloha [A] zůstává součástí odpovědi."),
      "Příloha [A] zůstává součástí odpovědi.",
    );
  });
});
