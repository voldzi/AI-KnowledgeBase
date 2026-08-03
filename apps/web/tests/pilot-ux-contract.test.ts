import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const assistantApp = readFileSync(
  new URL("../src/features/assistant/akb-assistant-app.tsx", import.meta.url),
  "utf8",
);
const helpPage = readFileSync(
  new URL("../src/app/help/page.tsx", import.meta.url),
  "utf8",
);
const documentRegistry = readFileSync(
  new URL("../src/features/documents/document-registry.tsx", import.meta.url),
  "utf8",
);
const documentsBridge = readFileSync(
  new URL("../src/app/api/documents/route.ts", import.meta.url),
  "utf8",
);

describe("pilot user experience contracts", () => {
  it("renders help with runtime production configuration", () => {
    assert.match(helpPage, /export const dynamic = "force-dynamic"/);
  });

  it("does not present a persisted thread as a new empty thread while loading", () => {
    const transcript = assistantApp.slice(assistantApp.indexOf('className="akb-chat-transcript"'));
    const loadingBranch = transcript.indexOf("copy.historyLoading");
    const emptyBranch = transcript.indexOf("copy.emptyThreadTitle");
    assert.ok(loadingBranch >= 0);
    assert.ok(emptyBranch > loadingBranch);
    assert.match(assistantApp, /aria-busy=\{Boolean\([\s\S]*!activeThread\.historyLoaded/);
  });

  it("shows live STRATOS sources and gives empty markdown links a usable name", () => {
    assert.match(assistantApp, /assistantLiveSources\(lastAssistantResponse\?\.current_context\)/);
    assert.match(assistantApp, /assistant-live-source-list/);
    assert.match(assistantApp, /hasLabel \? children : openLinkLabel/);
  });

  it("pages and filters the document registry on the authorized server bridge", () => {
    assert.match(documentRegistry, /REGISTRY_PAGE_SIZE = 50/);
    assert.match(documentRegistry, /\/api\/documents\?\$\{params\.toString\(\)\}/);
    assert.match(documentRegistry, /page\.summary\.total_documents/);
    assert.match(documentRegistry, /aria-busy=\{loading\}/);
    assert.doesNotMatch(documentRegistry, /<strong>\{document\.document_id\}<\/strong>/);
    assert.match(documentsBridge, /requireApiAccess\(context, "knowledge_workspace"\)/);
    assert.match(documentsBridge, /Cache-Control": "private, no-store"/);
  });
});
