import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

describe("chat viewport layout", () => {
  it("bounds the embedded chat to the shared shell viewport", () => {
    assert.match(
      css,
      /\.stratos-akb-shell--chat \.akb-chat-app\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;/s,
    );
  });

  it("keeps the transcript as the vertical mouse-wheel scroll target", () => {
    assert.match(
      css,
      /\.akb-chat-transcript\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;/s,
    );
  });

  it("bounds standalone chat to the dynamic viewport", () => {
    assert.match(
      css,
      /\.akb-employee-portal-shell\s*\{[^}]*height:\s*100dvh;[^}]*overflow:\s*hidden;/s,
    );
  });
});
