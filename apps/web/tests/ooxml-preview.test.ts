import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { describe, it } from "node:test";

import { buildNativeSourcePreview } from "../src/lib/upload/ooxml-preview";

describe("OOXML source preview", () => {
  it("extracts DOCX paragraphs", () => {
    const bytes = makeZip({
      "word/document.xml":
        '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Document title</w:t></w:r></w:p><w:p><w:r><w:t>Controlled paragraph.</w:t></w:r></w:p></w:body></w:document>'
    });
    const preview = buildNativeSourcePreview({
      bytes,
      filename: "source.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });

    assert.equal(preview.kind, "docx");
    assert.equal(preview.paragraphs[0]?.text, "Document title");
    assert.equal(preview.paragraphs[1]?.text, "Controlled paragraph.");
  });

  it("extracts XLSX sheet rows with shared strings", () => {
    const bytes = makeZip({
      "xl/workbook.xml": '<workbook xmlns:r="r"><sheets><sheet name="Plan" r:id="rId1"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      "xl/sharedStrings.xml": "<sst><si><t>Owner</t></si><si><t>Security</t></si></sst>",
      "xl/worksheets/sheet1.xml":
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c></row></sheetData></worksheet>'
    });
    const preview = buildNativeSourcePreview({
      bytes,
      filename: "source.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });

    assert.equal(preview.kind, "xlsx");
    assert.equal(preview.sheets[0]?.name, "Plan");
    assert.deepEqual(preview.sheets[0]?.rows, [["Owner"], ["Security"]]);
  });

  it("extracts PPTX slide text", () => {
    const bytes = makeZip({
      "ppt/slides/slide1.xml": "<p:sld><a:t>Intro</a:t><a:t>Evidence based viewer.</a:t></p:sld>"
    });
    const preview = buildNativeSourcePreview({
      bytes,
      filename: "deck.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    });

    assert.equal(preview.kind, "presentation");
    assert.equal(preview.slides[0]?.title, "Intro");
    assert.deepEqual(preview.slides[0]?.text, ["Intro", "Evidence based viewer."]);
  });
});

function makeZip(files: Record<string, string>): Uint8Array {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const [filename, content] of Object.entries(files)) {
    const name = Buffer.from(filename);
    const source = Buffer.from(content);
    const compressed = deflateRawSync(source);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(source.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(source.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const localFiles = Buffer.concat(localParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localFiles.length, 16);

  return Buffer.concat([localFiles, centralDirectory, end]);
}
