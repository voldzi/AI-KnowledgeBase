import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildStratosBudgetDocumentVersionRequest,
  canonicalStratosBudgetUploadContract,
  getStratosBudgetUploadSettings,
  parseStratosBudgetConfirmContract,
  parseStratosBudgetPreflightContract,
  STRATOS_BUDGET_UPLOAD_MAX_FILE_BYTES,
  STRATOS_BUDGET_UPLOAD_TOKEN_PURPOSE,
  stratosBudgetPreflightWorkflow,
  stratosBudgetLineageFromVersion,
  stratosBudgetVersionLineageFromUploadToken,
  stratosBudgetVersionSourceLocation,
} from "../src/lib/stratos/document-ai";
import { parseInformationPolicy, policyHash } from "../src/lib/stratos/information-policy";
import {
  createUploadPreflightDecision,
  validateUploadFileMetadata,
  verifyUploadToken,
  type UploadSettings,
} from "../src/lib/upload/preflight";

const fileHash = `sha256:${"b".repeat(64)}`;

const uploadSettings: UploadSettings = {
  objectStorageRoot: "/tmp/akb-budget-upload-test",
  bucket: "akl-documents",
  signingSecret: "budget-upload-test-secret",
  maxFileBytes: STRATOS_BUDGET_UPLOAD_MAX_FILE_BYTES,
  publicUploadBasePath: "/api/stratos/budget-upload/sessions",
  expiresInSeconds: 900,
};

function policy() {
  return parseInformationPolicy({
    schemaVersion: "stratos-information-policy-2",
    policyBindingId: "pb_budget_contract_12345678",
    policyVersion: "information-policy-2.0.0",
    handlingClass: "PROJECT_MANAGEMENT",
    legalClassification: "NONE",
    tlp: null,
    pap: null,
    contentCategories: ["CONTRACTUAL", "FINANCIAL"],
    audience: {
      organizationId: "org_stratos",
      scopeType: "budget_scope",
      scopeIds: ["budget:sekce-it"],
      recipientSubjectIds: [],
    },
    obligations: ["AUDIT_ACCESS"],
    originatorId: "subject-budget-owner",
    issuedAt: "2026-07-20T10:00:00Z",
    reviewAt: null,
  });
}

function envelope(versionFileHash = fileHash, actorSubjectId = "subject-budget-owner") {
  const informationPolicy = policy();
  return {
    schemaVersion: "stratos-integration-envelope-1",
    organizationId: "org_stratos",
    sourceSystem: "STRATOS_BUDGET",
    externalRef: "contract:contract-123:document:signed",
    actor: { type: "person", subjectId: actorSubjectId },
    correlationId: "corr-budget-contract-123",
    idempotencyKey: "budget-contract-upload:contract-123",
    policyBindingId: informationPolicy.policyBindingId,
    policyVersion: informationPolicy.policyVersion,
    policyHash: policyHash(informationPolicy),
    classification: {
      handlingClass: informationPolicy.handlingClass,
      legalClassification: "NONE",
      tlp: null,
      pap: null,
    },
    payload: {
      contractId: "contract-123",
      financialScopeKey: "budget:sekce-it",
      fileHash: versionFileHash,
    },
  };
}

function preflightBody() {
  const informationPolicy = policy();
  return {
    tenant_id: "org_stratos",
    external_system: "STRATOS_BUDGET",
    external_ref: "contract:contract-123:document:signed",
    entity_type: "Contract",
    entity_id: "contract-123",
    document_type: "contract",
    title: "S-2026-001 – smlouva.pdf",
    classification: "project_management",
    owner_actor_id: "subject-budget-owner",
    owner_display_name: "Ředitel IT",
    context_tags: ["stratos", "budget", "contract"],
    metadata: {
      contract_id: "contract-123",
      contract_number: "S-2026-001",
      contract_name: "Smlouva o podpoře",
      financial_scope_key: "budget:sekce-it",
      contract_status: "ACTIVE",
      contract_start_date: "2026-01-01",
      contract_end_date: "2028-12-31",
      lifecycle: "CURRENT",
      documentType: "CONTRACT_PDF",
      document_type: "CONTRACT_PDF",
    },
    file_name: "smlouva.pdf",
    file_type: "application/pdf",
    file_size: 1024,
    sha256: fileHash,
    information_policy: informationPolicy,
    governance_scope: { type: "budget_scope", id: "budget:sekce-it" },
    parent_governed_resource_id: "gres_budget_contract_123",
    integration_envelope: envelope(),
  };
}

describe("STRATOS Budget document bridge contract", () => {
  it("normalizes project-management handling to Registry internal classification", () => {
    const parsed = parseStratosBudgetPreflightContract(preflightBody());
    assert.equal(parsed.registryClassification, "internal");
    assert.equal(parsed.ownerSubjectId, "subject-budget-owner");
    assert.equal(parsed.metadata.financial_scope_key, "budget:sekce-it");
    assert.equal(parsed.fileHash, fileHash);
    assert.equal(parsed.metadata.lifecycle, "CURRENT");
  });

  it("accepts the real server-only historical caller metadata and rejects partial batch lineage", () => {
    const body = preflightBody();
    Object.assign(body.metadata, {
      contract_status: "EXPIRED",
      contract_start_date: "2023-01-01",
      contract_end_date: "2025-12-31",
      lifecycle: "ARCHIVED",
      documentType: "CONTRACT_ARCHIVE",
      document_type: "CONTRACT_ARCHIVE",
      batch_manifest_id: "historical-contracts-2026-07-20",
      batch_entries_sha256: `sha256:${"c".repeat(64)}`,
      release_revision: "d".repeat(40),
    });
    const parsed = parseStratosBudgetPreflightContract(body);
    assert.equal(parsed.metadata.lifecycle, "ARCHIVED");
    assert.equal(parsed.metadata.contract_status, "EXPIRED");
    assert.equal(parsed.metadata.contract_end_date, "2025-12-31");
    assert.equal(parsed.metadata.batch_manifest_id, "historical-contracts-2026-07-20");

    const partial = preflightBody();
    (partial.metadata as Record<string, unknown>).batch_manifest_id = "incomplete-batch";
    assert.throws(() => parseStratosBudgetPreflightContract(partial));
  });

  it("requires an actor for non-batch uploads and permits complete CURRENT or ARCHIVED service batches", () => {
    const current = parseStratosBudgetPreflightContract(preflightBody());
    assert.throws(
      () => stratosBudgetPreflightWorkflow(current, false),
      (error: unknown) => (error as { status?: number; code?: string }).status === 401
        && (error as { code?: string }).code === "STRATOS_BUDGET_ACTOR_AUTH_REQUIRED",
    );
    assert.deepEqual(stratosBudgetPreflightWorkflow(current, true), {
      mode: "interactive",
      context: {
        original_file_name: "smlouva.pdf",
        contract_status: "ACTIVE",
        contract_start_date: "2026-01-01",
        contract_end_date: "2028-12-31",
      },
    });

    const historicalBody = preflightBody();
    Object.assign(historicalBody.metadata, {
      contract_status: "EXPIRED",
      contract_start_date: "2023-01-01",
      contract_end_date: "2025-12-31",
      lifecycle: "ARCHIVED",
      documentType: "CONTRACT_ARCHIVE",
      document_type: "CONTRACT_ARCHIVE",
      batch_manifest_id: "historical-contracts-2026-07-20",
      batch_entries_sha256: `sha256:${"c".repeat(64)}`,
      release_revision: "d".repeat(40),
    });
    const historical = parseStratosBudgetPreflightContract(historicalBody);
    const workflow = stratosBudgetPreflightWorkflow(historical, false);
    assert.equal(workflow.mode, "historical_batch");
    assert.equal(workflow.context.contract_status, "EXPIRED");
    assert.equal(workflow.context.original_file_name, "smlouva.pdf");
    assert.equal(workflow.context.batch_manifest_id, "historical-contracts-2026-07-20");
    assert.throws(() => stratosBudgetPreflightWorkflow(historical, true));

    const currentBatchBody = preflightBody();
    Object.assign(currentBatchBody.metadata, {
      batch_manifest_id: "historical-contracts-2026-07-20",
      batch_entries_sha256: `sha256:${"c".repeat(64)}`,
      release_revision: "d".repeat(40),
    });
    const currentBatch = parseStratosBudgetPreflightContract(currentBatchBody);
    const currentBatchWorkflow = stratosBudgetPreflightWorkflow(currentBatch, false);
    assert.equal(currentBatchWorkflow.mode, "historical_batch");
    assert.equal(currentBatchWorkflow.context.contract_status, "ACTIVE");
  });

  it("accepts the canonical organization-wide Budget financial scope", () => {
    const body = preflightBody();
    body.governance_scope.id = "budget-global";
    body.metadata.financial_scope_key = "budget-global";
    body.integration_envelope.payload.financialScopeKey = "budget-global";

    const parsed = parseStratosBudgetPreflightContract(body);
    assert.equal(parsed.governanceScope.id, "budget-global");
    assert.equal(parsed.metadata.financial_scope_key, "budget-global");
  });

  it("accepts the narrower confirmation contract without preflight-only presentation fields", () => {
    const informationPolicy = policy();
    const parsed = parseStratosBudgetConfirmContract({
      tenant_id: "org_stratos",
      external_system: "STRATOS_BUDGET",
      external_ref: "contract:contract-123:document:signed",
      entity_type: "Contract",
      entity_id: "contract-123",
      document_id: "doc_budget_123",
      external_document_id: "extdoc_budget_123",
      upload_session_id: "upl_budget_123",
      upload_token: "signed-token",
      source_file_uri: "s3://akl-documents/doc_budget_123/smlouva.pdf",
      file_hash: fileHash,
      file_name: "smlouva.pdf",
      file_type: "application/pdf",
      file_size: 1024,
      version_label: "upload-bbbbbbbbbbbbbbbb",
      change_summary: "Smlouva nahraná z Budget & Contract.",
      information_policy: informationPolicy,
      governance_scope: { type: "budget_scope", id: "budget:sekce-it" },
      parent_governed_resource_id: "gres_budget_contract_123",
      integration_envelope: envelope(),
    });
    assert.equal(parsed.entityId, "contract-123");
    assert.equal(parsed.ownerSubjectId, "subject-budget-owner");
    assert.equal(parsed.fileName, "smlouva.pdf");
  });

  it("binds mode, immutable contract history and batch provenance into the signed token", () => {
    const decision = createUploadPreflightDecision({
      document_id: "doc_budget_123",
      file_name: "smlouva.pdf",
      file_type: "application/pdf",
      file_size: 1024,
      sha256: fileHash,
      purpose: STRATOS_BUDGET_UPLOAD_TOKEN_PURPOSE,
      workflow_mode: "historical_batch",
      workflow_context: {
        original_file_name: "Smlouva historická.pdf",
        contract_status: "EXPIRED",
        contract_start_date: "2023-01-01",
        contract_end_date: "2025-12-31",
        batch_manifest_id: "historical-contracts-2026-07-20",
        batch_entries_sha256: `sha256:${"c".repeat(64)}`,
        release_revision: "d".repeat(40),
      },
    }, uploadSettings);
    const payload = verifyUploadToken(
      decision.required_headers["X-AKL-Upload-Token"],
      uploadSettings,
    );
    const lineage = stratosBudgetVersionLineageFromUploadToken(payload);
    assert.deepEqual(lineage, {
      upload_mode: "historical_batch",
      original_file_name: "Smlouva historická.pdf",
      contract_status: "EXPIRED",
      contract_start_date: "2023-01-01",
      contract_end_date: "2025-12-31",
      batch_lineage: {
        batch_manifest_id: "historical-contracts-2026-07-20",
        batch_entries_sha256: `sha256:${"c".repeat(64)}`,
        release_revision: "d".repeat(40),
      },
    });

    const conflictingMode = { ...payload, workflow_mode: "interactive" } as typeof payload;
    assert.throws(() => stratosBudgetVersionLineageFromUploadToken(conflictingMode));
  });

  it("uses the canonical MIME type signed at preflight in Registry version lineage", () => {
    for (const [fileName, canonicalMime] of [
      ["smlouva.pdf", "application/pdf"],
      ["smlouva.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ] as const) {
      const decision = createUploadPreflightDecision({
        document_id: "doc_budget_123",
        file_name: fileName,
        file_type: "application/octet-stream",
        file_size: 1024,
        sha256: fileHash,
        purpose: STRATOS_BUDGET_UPLOAD_TOKEN_PURPOSE,
        workflow_mode: "interactive",
        workflow_context: {
          original_file_name: fileName === "smlouva.pdf" ? "Smlouva číslo 1.pdf" : "Smlouva číslo 1.docx",
          contract_status: "ACTIVE",
          contract_start_date: "2026-01-01",
          contract_end_date: "2028-12-31",
        },
      }, uploadSettings);
      const payload = verifyUploadToken(
        decision.required_headers["X-AKL-Upload-Token"],
        uploadSettings,
      );
      const original = parseStratosBudgetConfirmContract({
        tenant_id: "org_stratos",
        external_system: "STRATOS_BUDGET",
        external_ref: "contract:contract-123:document:signed",
        entity_type: "Contract",
        entity_id: "contract-123",
        document_id: "doc_budget_123",
        external_document_id: "extdoc_budget_123",
        upload_session_id: payload.session_id,
        upload_token: "signed-token",
        source_file_uri: payload.source_file_uri,
        file_hash: fileHash,
        file_name: fileName,
        file_type: "application/octet-stream",
        file_size: 1024,
        version_label: "upload-bbbbbbbbbbbbbbbb",
        information_policy: policy(),
        governance_scope: { type: "budget_scope", id: "budget:sekce-it" },
        parent_governed_resource_id: "gres_budget_contract_123",
        integration_envelope: envelope(),
      });
      const canonical = canonicalStratosBudgetUploadContract(original, payload);
      const sourceLocation = stratosBudgetVersionSourceLocation({
        contract: canonical,
        sourceFileUri: payload.source_file_uri,
        objectKey: payload.object_key,
      });
      const request = buildStratosBudgetDocumentVersionRequest({
        contract: canonical,
        body: {
          version_label: "upload-bbbbbbbbbbbbbbbb",
          source_file_uri: payload.source_file_uri,
        },
        sourceLocation,
        versionLineage: stratosBudgetVersionLineageFromUploadToken(payload),
      });
      assert.equal(canonical.fileType, canonicalMime);
      assert.equal(sourceLocation.content_type, canonicalMime);
      assert.equal((request.file as { mime_type: string }).mime_type, canonicalMime);
    }
  });

  it("uses a dedicated 128 MiB Budget limit without widening general uploads", () => {
    const budgetSettings = getStratosBudgetUploadSettings({
      AKL_WEB_UPLOAD_MAX_FILE_BYTES: String(50 * 1024 * 1024),
    });
    assert.equal(budgetSettings.maxFileBytes, STRATOS_BUDGET_UPLOAD_MAX_FILE_BYTES);
    assert.equal(validateUploadFileMetadata({
      file_name: "archive.pdf",
      file_type: "application/pdf",
      file_size: STRATOS_BUDGET_UPLOAD_MAX_FILE_BYTES,
      sha256: fileHash,
    }, budgetSettings).file_size, STRATOS_BUDGET_UPLOAD_MAX_FILE_BYTES);
    assert.throws(() => validateUploadFileMetadata({
      file_name: "too-large.pdf",
      file_type: "application/pdf",
      file_size: STRATOS_BUDGET_UPLOAD_MAX_FILE_BYTES + 1,
      sha256: fileHash,
    }, budgetSettings));
  });

  it("reconstructs retry lineage from the exact immutable document version", () => {
    const informationPolicy = policy();
    const secondHash = `sha256:${"c".repeat(64)}`;
    const versionActor = "subject-budget-manager";
    const parsed = stratosBudgetLineageFromVersion({
      document_id: "doc_budget_123",
      owner_id: "subject-budget-owner",
      governed_parent_resource_id: "gres_budget_contract_123",
      policy_summary: informationPolicy,
      metadata: {
        stratos_budget_upload: {
          integration_envelope: envelope(fileHash),
        },
      },
    } as never, {
      document_id: "doc_budget_123",
      document_version_id: "ver_budget_v2",
      file_hash: secondHash,
      policy_summary: informationPolicy,
      governance_scope_type: "budget_scope",
      governance_scope_id: "budget:sekce-it",
      source_location: {
        stratos_budget_upload: {
          integration_envelope: envelope(secondHash, versionActor),
          upload_mode: "historical_batch",
        },
      },
    } as never);
    assert.equal(parsed.parentGovernedResourceId, "gres_budget_contract_123");
    assert.deepEqual(parsed.governanceScope, { type: "budget_scope", id: "budget:sekce-it" });
    assert.equal(parsed.integrationEnvelope.payload.fileHash, secondHash);
    assert.equal(parsed.integrationEnvelope.actor.subjectId, versionActor);
    assert.equal(parsed.integrationEnvelope.policyHash, policyHash(informationPolicy));
    assert.equal(parsed.uploadMode, "historical_batch");
  });

  it("rejects drift in the external reference and unknown fields", () => {
    assert.throws(() => parseStratosBudgetPreflightContract({
      ...preflightBody(),
      external_ref: "contract:another-contract",
    }));
    assert.throws(() => parseStratosBudgetPreflightContract({
      ...preflightBody(),
      legacy_tenant: "must-not-be-accepted",
    }));
  });
});
