import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("reader workflow boundaries", () => {
  it("uses preference identity only for presentation of the verified subject", () => {
    const shell = read("../src/components/app-shell.tsx");
    const preferences = shell.slice(shell.indexOf("const applyProfileSettings"), shell.indexOf("const persistProfileSettings"));
    assert.match(preferences, /profileSubject !== authenticatedSubject\.current/);
    assert.doesNotMatch(preferences, /setAccessInfo|setApplicationAccess|identity\.capabilities|identity\.roles/);
    assert.match(preferences, /setUserProfile\(\(current\) => \(\{\s*\.\.\.current,/);
    assert.match(shell, /if \(!identityLoaded \|\| accessibleNavigation\.length === 0\)/);
    assert.match(shell, /if \(!identityLoaded\) return;\s*let active = true;\s*profileSettingsClient/);
  });

  it("does not request global audit records for document readers", () => {
    const page = read("../src/app/documents/[documentId]/page.tsx");
    assert.match(page, /authorization\.can_read_audit\s*\? optionalSection\(clients\.registry\.listAuditEvents/);
    assert.match(page, /approvedOnly: !canReviewControlledDocumentation\(authorization\)/);
  });

  it("pins citation identity and cancels stale source loads", () => {
    const detail = read("../src/features/documents/document-detail.tsx");
    assert.match(detail, /source_context\.document_id !== document\.document_id/);
    assert.match(detail, /source_context\.document_version_id !== currentVersion\?\.document_version_id/);
    assert.match(detail, /source_context\.chunk_id !== chunkId/);
    assert.match(detail, /controller\.signal\.aborted/);
    assert.match(detail, /return \(\) => sourceContextRequest\.current\?\.abort\(\)/);
    const citation = read("../src/features/citations/citation-viewer.tsx");
    assert.match(citation, /<Dialog\s+open=\{open\}/);
    assert.match(citation, /aria-disabled=\{openingChunkId === citation\.chunk_id\}/);
    assert.doesNotMatch(citation, /\sdisabled=\{openingChunkId/);
  });
});
