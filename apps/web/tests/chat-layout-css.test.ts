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

  it("keeps the new-answer control visible without moving the composer", () => {
    assert.match(
      css,
      /\.akb-chat-scroll-latest\s*\{[^}]*bottom:\s*4px;[^}]*position:\s*sticky;/s,
    );
  });

  it("bounds standalone chat to the dynamic viewport", () => {
    assert.match(
      css,
      /\.akb-employee-portal-shell\s*\{[^}]*height:\s*100dvh;[^}]*overflow:\s*hidden;/s,
    );
  });

  it("uses mobile action tracks matching the fixed icon button width", () => {
    assert.match(
      css,
      /\.akb-chat-header__actions\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*44px\);/s,
    );
    assert.match(
      css,
      /\.akb-chat-header__actions\s*>\s*:last-child\s*\{[^}]*grid-column:\s*span 2;[^}]*width:\s*100%;/s,
    );
  });
});
