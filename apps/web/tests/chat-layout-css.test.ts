import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const assistantApp = readFileSync(
  new URL("../src/features/assistant/akb-assistant-app.tsx", import.meta.url),
  "utf8",
);

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

  it("uses one compact mobile conversation toolbar", () => {
    assert.match(
      css,
      /\.akb-chat-mobile-toolbar\s*\{[^}]*grid-template-columns:\s*44px minmax\(0,\s*1fr\) 44px 44px;/s,
    );
    assert.match(
      css,
      /\.akb-chat-header__actions--desktop\s*\{[^}]*display:\s*none;/s,
    );
    assert.match(
      assistantApp,
      /aria-haspopup="menu"[\s\S]*aria-controls="akb-chat-mobile-actions-popover"/,
    );
  });

  it("keeps the mobile composer compact and safe-area aware", () => {
    assert.match(
      css,
      /\.akb-chat-composer\s*\{[^}]*padding-bottom:\s*calc\(8px \+ env\(safe-area-inset-bottom,\s*0px\)\);/s,
    );
    assert.match(
      css,
      /\.akb-chat-composer__box\s*\{[^}]*grid-template-columns:\s*44px minmax\(0,\s*1fr\) 44px;/s,
    );
    assert.match(assistantApp, /ref=\{composerTextareaRef\}[\s\S]*rows=\{1\}/);
  });

  it("presents report settings as a bounded mobile bottom sheet", () => {
    assert.match(
      css,
      /\.akb-chat-report-mode__panel\s*\{[^}]*max-height:\s*min\(72dvh,\s*620px\);[^}]*position:\s*fixed;[^}]*z-index:\s*80;/s,
    );
    assert.match(
      assistantApp,
      /id="akb-chat-report-settings"[\s\S]*role="region"[\s\S]*aria-label=\{copy\.reportSettings\}/,
    );
  });
});
