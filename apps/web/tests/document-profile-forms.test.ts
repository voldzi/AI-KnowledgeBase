import assert from "node:assert/strict";
import { test } from "node:test";
import { DOCUMENT_PROFILES, profileWithAssignments, readDocumentVersionProfile, readNativeDocumentProfile } from "../src/lib/documents/document-profile";
import { parseDocumentProfileInput, parseDocumentVersionProfileInput } from "../src/lib/documents/document-profile-validation";
import { nativeContractSnapshot } from "./fixtures/document-profiles";

test("native form keeps the author, current owner and gestor explicit and distinct", () => {
  const form = new FormData();
  form.set("profile.owner", "owner-person");
  form.set("profile.author.kind", "external_authority");
  form.set("profile.author.id", "issuing-institution");
  form.set("profile.author.evidence", "publication:source");
  const profile = DOCUMENT_PROFILES.find((item) => item.id === "akb.contract")!;
  const input = readNativeDocumentProfile(form, profile, [{ role: "gestor", subject_type: "unit", subject_id: "legal-unit" }]);
  assert.equal(input.accountability.ownerSubjectId, "owner-person");
  assert.deepEqual(input.authorship, [{ kind: "external_authority", id: "issuing-institution", evidenceReference: "publication:source" }]);
  assert.deepEqual(input.provenance, { sourceSystem: "AKB", sourceRecordId: null, sourceGovernedResourceId: null });
  assert.deepEqual(parseDocumentProfileInput(input, { documentType: "contract", sourceSystem: "AKB" }), input);
  form.delete("profile.author.id");
  assert.throws(() => readNativeDocumentProfile(form, profile, [{ role: "gestor", subject_id: "legal-person" }]));
});

test("a meeting can be recorded after it occurred without inventing normative effectivity", () => {
  const profile = DOCUMENT_PROFILES.find((item) => item.family === "meeting_project_record")!;
  const form = new FormData();
  for (const [key, value] of Object.entries({ mode: "record", recordedOn: "2026-09-05", reviewAt: "2027-09-05",
    reviewRuleId: profile.lifecycle.reviewRuleIds[0], retentionRuleId: profile.lifecycle.retentionRuleIds[0] })) form.set(`profile.lifecycle.${key}`, value);
  for (const field of profile.domainFields) form.set(`profile.domain.${field.name}`, field.type === "date" ? "2026-09-04" : "test-reference");
  const result = readDocumentVersionProfile(form, profile, "revision-1");
  assert.equal(result.lifecycle.effectiveFrom, null);
  assert.equal(result.lifecycle.effectiveTo, null);
  assert.equal(result.lifecycle.recordedOn, "2026-09-05");
  assert.equal(result.domain_evidence.eventDate, "2026-09-04");
  assert.deepEqual(parseDocumentVersionProfileInput(result), result);
  form.delete("profile.lifecycle.recordedOn");
  assert.throws(() => readDocumentVersionProfile(form, profile, "revision-1"));
});

test("a responsibility transfer preserves authorship and source identity while requiring accountable primaries", () => {
  const snapshot = nativeContractSnapshot("doc-test");
  const previous = structuredClone(snapshot);
  const assignments = [
    { role: "owner" as const, subject_type: "user" as const, subject_id: "new-owner", is_primary: true },
    { role: "gestor" as const, subject_type: "unit" as const, subject_id: "new-unit", is_primary: true },
  ];
  const input = profileWithAssignments(snapshot, assignments);
  assert.deepEqual(input.authorship, snapshot.authorship);
  assert.equal(input.provenance.sourceRecordId, null);
  assert.equal(input.accountability.ownerSubjectId, "new-owner");
  assert.deepEqual(snapshot, previous);
  assert.throws(() => profileWithAssignments(snapshot, assignments.slice(1)));
  assert.throws(() => profileWithAssignments(snapshot, [...assignments, { ...assignments[0], subject_id: "other-owner" }]));
});
