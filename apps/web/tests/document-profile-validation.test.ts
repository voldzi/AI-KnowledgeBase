import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parseDocumentProfileInput, parseDocumentVersionProfileInput, parseDocumentVersionProfileDraft } from "../src/lib/documents/document-profile-validation";
import { budgetContractProfile, contractVersionProfile } from "./fixtures/document-profiles";
import { createUploadPreflightDecision, verifyUploadToken, type UploadSettings } from "../src/lib/upload/preflight";

const settings: UploadSettings = { objectStorageRoot: "/tmp/akb-profile-no-io", bucket: "test", signingSecret: "profile-fixture-key", maxFileBytes: 100,
  publicUploadBasePath: "/api/document-intake/v1/sessions", expiresInSeconds: 900 };

describe("Strict document profile boundary", () => {
  it("uses the exact canonical Registry input schema inside the web build context", () => {
    const canonical = JSON.parse(readFileSync(new URL("../../../contracts/akb/document-profiles/v1/inputs.schema.json", import.meta.url), "utf8"));
    const bundled = JSON.parse(readFileSync(new URL("../src/lib/documents/document-profile-inputs.schema.json", import.meta.url), "utf8"));
    assert.deepEqual(bundled, canonical);
  });

  it("accepts each catalog family with explicit complete domain evidence", () => {
    const cases = [
      ["akb.knowledge-note", "knowledge_base_article", { family: "knowledge_note", subject: "Knowledge", createdOn: "2026-01-01" }],
      ["akb.controlled-document", "directive", { family: "controlled_document", issuerReference: "issuer", applicability: "org", effectiveDateEvidenceReference: "approval" }],
      ["akb.meeting-project-record", "meeting_record", { family: "meeting_project_record", eventDate: "2026-01-01", recordReference: "minutes", projectReference: null }],
      ["akb.contract", "contract", contractVersionProfile().domain_evidence],
      ["akb.official-public-reference", "regulation", { family: "official_public_reference", authorityReference: "authority", canonicalSourceUrl: "https://official.test/law", collectionId: "official", sourceKind: "regulation", effectiveDateEvidenceReference: "gazette" }],
    ] as const;
    for (const [id, documentType, evidence] of cases) {
      const root = budgetContractProfile();
      root.profile.id = id;
      if (id === "akb.official-public-reference") root.provenance.sourceSystem = "AKB_OFFICIAL_SOURCE";
      const version = contractVersionProfile();
      version.domain_evidence = { ...evidence };
      if (id === "akb.knowledge-note" || id === "akb.meeting-project-record") {
        Object.assign(version.lifecycle, { mode: "record", effectiveFrom: null, effectiveTo: null, recordedOn: "2026-01-01" });
      }
      const parsedRoot = parseDocumentProfileInput(root, { documentType });
      assert.deepEqual(parseDocumentVersionProfileInput(version, parsedRoot), version);
      assert.deepEqual(parseDocumentVersionProfileInput(version), version);
    }
  });

  it("rejects missing profiles, invented authority, extra fields and incomplete explicit accountability", () => {
    assert.throws(() => parseDocumentProfileInput(undefined), { status: 422, code: "DOCUMENT_PROFILE_REQUIRED" });
    for (const mutate of [
      (r: ReturnType<typeof budgetContractProfile>) => { r.profile.revision = "999"; },
      (r: ReturnType<typeof budgetContractProfile>) => { r.authorship = []; },
      (r: ReturnType<typeof budgetContractProfile>) => { r.authorship.push({ ...r.authorship[0] }); },
      (r: ReturnType<typeof budgetContractProfile>) => { r.accountability.ownerSubjectId = " "; },
      (r: ReturnType<typeof budgetContractProfile>) => { r.provenance.sourceRecordId = null; },
    ]) {
      const root = budgetContractProfile(); mutate(root);
      assert.throws(() => parseDocumentProfileInput(root), { code: "DOCUMENT_PROFILE_INVALID" });
    }
    assert.throws(() => parseDocumentProfileInput({ ...budgetContractProfile(), admission: { decision: "ALLOW" } }), { code: "DOCUMENT_PROFILE_INVALID" });
    assert.throws(() => parseDocumentProfileInput(budgetContractProfile(), { documentType: "directive" }), { code: "DOCUMENT_PROFILE_INVALID" });
  });

  it("requires all nullable keys and rejects invalid lifecycle and domain evidence", () => {
    for (const mutate of [
      (v: ReturnType<typeof contractVersionProfile>) => { delete v.domain_evidence.executionEvidenceReference; },
      (v: ReturnType<typeof contractVersionProfile>) => { v.domain_evidence.executionEvidenceReference = null; },
      (v: ReturnType<typeof contractVersionProfile>) => { v.domain_evidence.partyReferences = ["same", "same"]; },
      (v: ReturnType<typeof contractVersionProfile>) => { v.domain_evidence.decision = "ALLOW"; },
      (v: ReturnType<typeof contractVersionProfile>) => { v.lifecycle.effectiveFrom = "2026-02-30"; },
      (v: ReturnType<typeof contractVersionProfile>) => { v.lifecycle.effectiveFrom = "2029-01-01"; },
      (v: ReturnType<typeof contractVersionProfile>) => { v.lifecycle.reviewAt = null; },
      (v: ReturnType<typeof contractVersionProfile>) => { v.lifecycle.retentionRuleId = "guessed-rule"; },
    ]) {
      const version = contractVersionProfile(); mutate(version);
      assert.throws(() => parseDocumentVersionProfileInput(version, budgetContractProfile()), { code: "DOCUMENT_PROFILE_INVALID" });
    }
    assert.throws(() => parseDocumentVersionProfileDraft(contractVersionProfile(), budgetContractProfile()), { code: "DOCUMENT_PROFILE_INVALID" });
    const { expected_root_metadata_revision: _, ...draft } = contractVersionProfile();
    assert.deepEqual(parseDocumentVersionProfileDraft(draft, budgetContractProfile()), draft);
  });

  it("keeps draft and terminated contracts as records and binds Budget evidence to the source", () => {
    for (const executionStatus of ["draft", "terminated"]) {
      const version = contractVersionProfile();
      version.domain_evidence.executionStatus = executionStatus;
      if (executionStatus === "draft") version.domain_evidence.executionEvidenceReference = null;
      assert.throws(() => parseDocumentVersionProfileInput(version), { code: "DOCUMENT_PROFILE_INVALID" });
      Object.assign(version.lifecycle, { mode: "record", effectiveFrom: null, effectiveTo: null, recordedOn: "2026-09-05" });
      assert.deepEqual(parseDocumentVersionProfileInput(version, budgetContractProfile()), version);
      if (executionStatus === "terminated") {
        version.domain_evidence.executionEvidenceReference = null;
        assert.throws(() => parseDocumentVersionProfileInput(version), { code: "DOCUMENT_PROFILE_INVALID" });
      }
    }
    const other = contractVersionProfile(); other.domain_evidence.contractReference = "other-contract";
    assert.throws(() => parseDocumentVersionProfileInput(other, budgetContractProfile()), { code: "DOCUMENT_PROFILE_INVALID" });
  });

  it("requires and signs complete version profiles for every production upload purpose", () => {
    for (const purpose of ["controlled-document-upload", "stratos-budget-upload", "official-public-source-sync"]) {
      const body = { document_id: "doc-profile", file_name: "test.pdf", file_size: 3, file_type: "application/pdf", sha256: `sha256:${"a".repeat(64)}`, purpose };
      assert.throws(() => createUploadPreflightDecision(body, settings), { code: "DOCUMENT_PROFILE_REQUIRED" });
      const decision = createUploadPreflightDecision({ ...body, document_profile: contractVersionProfile() }, settings);
      const payload = verifyUploadToken(decision.required_headers["X-AKL-Upload-Token"], settings);
      assert.deepEqual(payload.document_profile, contractVersionProfile());
      assert.deepEqual(decision.document_profile, payload.document_profile);
      const incomplete = Buffer.from(JSON.stringify({ ...payload, document_profile: undefined })).toString("base64url");
      const signature = createHmac("sha256", settings.signingSecret).update(incomplete).digest("base64url");
      assert.throws(() => verifyUploadToken(`${incomplete}.${signature}`, settings), { code: "UPLOAD_TOKEN_PROFILE_REQUIRED" });
    }
  });
});
