import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DOCUMENT_FORMAT_CATALOG, DOCUMENT_UPLOAD_ACCEPT, documentFormatError, documentFormatHint } from "../src/lib/documents/document-formats";
import { getUploadSettings, validateUploadFileMetadata, UploadPreflightError } from "../src/lib/upload/preflight";

test("UI and binary preflight consume the same binding format catalog", () => {
  assert.deepEqual(DOCUMENT_FORMAT_CATALOG, JSON.parse(readFileSync("../../contracts/document-formats/v1/catalog.json", "utf8")));
  const settings = getUploadSettings({ AKL_ENV: "test" });
  for (const format of DOCUMENT_FORMAT_CATALOG.formats) {
    for (const extension of format.extensions) {
      const file = { file_name: `source${extension}`, file_size: 20, file_type: format.mime_type, sha256: `sha256:${"a".repeat(64)}` };
      if (format.admission === "enabled") {
        assert.ok(DOCUMENT_UPLOAD_ACCEPT.split(",").includes(extension));
        assert.equal(documentFormatError(file.file_name, "cs"), null);
        assert.equal(validateUploadFileMetadata(file, settings).file_name, file.file_name);
      } else {
        assert.ok(!DOCUMENT_UPLOAD_ACCEPT.split(",").includes(extension));
        assert.ok(documentFormatError(file.file_name, "cs"));
        assert.throws(() => validateUploadFileMetadata(file, settings), (error: unknown) => error instanceof UploadPreflightError && error.code === "FILE_FORMAT_UNAVAILABLE");
      }
      assert.ok(documentFormatHint(file.file_name, "cs"));
      assert.ok(documentFormatHint(file.file_name, "en"));
    }
  }
});

test("macro workbook MIME matching is case-insensitive and retains the signed header", () => {
  const file = validateUploadFileMetadata({ file_name: "source.xlsm", file_type: "application/vnd.ms-excel.sheet.macroEnabled.12", file_size: 20, sha256: `sha256:${"b".repeat(64)}` }, getUploadSettings({ AKL_ENV: "test" }));
  assert.equal(file.file_type, "application/vnd.ms-excel.sheet.macroenabled.12");
});
