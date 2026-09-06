import assert from "node:assert/strict";
import test from "node:test";
import { documentVersionPublicationLabel, documentVersionTimeline, effectiveDocumentVersion, selectedDocumentVersion } from "../src/lib/documents/review-version";
import type { DocumentVersion } from "../src/lib/types";

const old = { document_version_id: "ver_old", status: "valid", valid_from: "2026-01-01", valid_to: null, created_at: "2026-01-01T00:00:00Z", published_at: "2026-01-01T00:00:00Z" } as DocumentVersion;
const future = { ...old, document_version_id: "ver_future", valid_from: "2026-10-01", created_at: "2026-08-01T00:00:00Z", published_at: "2026-08-01T00:00:00Z" };

test("document view uses the effective timeline rather than response order or upload recency", () => {
  const lateHistory = { ...old, document_version_id: "ver_ancient", valid_from: "2025-01-01", created_at: "2026-09-01T00:00:00Z", published_at: "2026-09-01T00:00:00Z" };
  assert.equal(effectiveDocumentVersion([lateHistory, future, old], "2026-09-30")?.document_version_id, "ver_old");
  assert.equal(effectiveDocumentVersion([old, future, lateHistory], "2026-10-01")?.document_version_id, "ver_future");
});

test("expired and withdrawn successors cannot silently revive older displayed authority", () => {
  assert.equal(effectiveDocumentVersion([old, { ...future, valid_to: "2026-10-31" }], "2026-11-01"), undefined);
  assert.equal(effectiveDocumentVersion([old, { ...future, status: "archived" }], "2026-11-01"), undefined);
  assert.equal(effectiveDocumentVersion([old, { ...future, status: "archived" }], "2026-09-30"), old);
});

test("explicit historical selection stays exact and a missing requested version has no fallback", () => {
  assert.equal(selectedDocumentVersion([future, old], "ver_old"), old);
  assert.equal(selectedDocumentVersion([future, old], "not_present"), undefined);
});

test("records use their existence date without displaying it as normative effectivity", () => {
  const record = { ...old, valid_from: null, document_profile_snapshot: { lifecycle: { mode: "record", recordedOn: "2026-09-05" } } };
  assert.equal(effectiveDocumentVersion([record], "2026-09-04"), undefined);
  assert.equal(effectiveDocumentVersion([record], "2026-09-05"), record);
  assert.match(documentVersionTimeline(record, "cs"), /^Záznam ze dne/);
  assert.equal(documentVersionPublicationLabel(record, "cs"), "Zveřejněný záznam");
  assert.equal(record.valid_from, null);
  assert.equal(effectiveDocumentVersion([{ ...record, document_profile_snapshot: { lifecycle: { mode: "record" } } }], "2026-09-06"), undefined);
});
