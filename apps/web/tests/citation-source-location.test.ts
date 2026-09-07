import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const labels = { page: "Page", sheet: "Sheet", row: "Row", slide: "Slide", noSection: "No section",
  chunk: "Chunk", version: "Version", openCitation: "Open link", openDocument: "Open document",
  copyChunk: "Copy", sourceUnavailable: "Unavailable" };

function render(location: Record<string, unknown>, viewerMode: string) {
  const context = { chunk_id: "chunk_coordinate", document_id: "doc_coordinate", document_version_id: "ver_coordinate",
    document_title: "Exact original", viewer_mode: viewerMode, location, chunk_text: "Evidence", warnings: [] };
  const code = `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
    import {SourceContextCard,CitationList} from './src/features/citations/citation-viewer.tsx';
    const context=${JSON.stringify(context)}; const labels=${JSON.stringify(labels)};
    process.stdout.write(renderToStaticMarkup(React.createElement(React.Fragment,null,
      React.createElement(SourceContextCard,{sourceContext:context,labels,showStatus:false}),
      React.createElement(CitationList,{citations:[{chunk_id:context.chunk_id,document_title:context.document_title,version_label:'1',page_number:context.location.page_number,section_path:context.location.section_path}],labels,emptyLabel:'Empty',onOpenCitation:()=>{}}))));`;
  return execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { encoding: "utf8" });
}

test("worksheet citation shows exact sheet and sparse row coordinates without a PDF page", () => {
  const html = render({ page_number: null, sheet_name: "Rozpočet", row_number: 5, column_name: "A",
    section_path: ["Rozpočet", "A:D · Řádky 5, 60, 115"] }, "table");
  assert.match(html, /Sheet Rozpočet · A:D · Řádky 5, 60, 115/);
  assert.doesNotMatch(html, /Page|n\/a|#page=/);
});

test("presentation citation distinguishes slide coordinates from PDF pages", () => {
  const html = render({ page_number: null, slide_number: 7, section_path: ["Snímek 7", "Sizing", "Tabulka 3 · Řádky 1–4"] }, "presentation");
  assert.match(html, /Slide 7 · Sizing \/ Tabulka 3 · Řádky 1–4/);
  assert.doesNotMatch(html, /Page|n\/a|#page=/);
});

test("physical PDF page citations retain their page label", () => {
  const html = render({ page_number: 12, section_path: ["Postup"] }, "pdf");
  assert.match(html, /Page 12 · Postup/);
  assert.doesNotMatch(html, /n\/a/);
});
