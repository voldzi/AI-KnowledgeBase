import "./helpers/next-server-navigation";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { POST as budgetPreflight } from "../src/app/api/stratos/budget-upload/preflight/route";
import { POST as budgetConfirm } from "../src/app/api/stratos/budget-upload/sessions/[sessionId]/confirm/route";
import { canonicalDocumentSnapshot } from "../src/lib/documents/document-profile";
import { budgetContractProfile, contractVersionProfile } from "./fixtures/document-profiles";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  buildStratosBudgetDocumentVersionRequest,
  canonicalStratosBudgetUploadContract,
  getStratosBudgetUploadSettings,
  parseStratosBudgetConfirmContract,
  parseStratosBudgetPreflightContract,
  STRATOS_BUDGET_UPLOAD_MAX_FILE_BYTES,
  STRATOS_BUDGET_UPLOAD_TOKEN_PURPOSE,
  STRATOS_BUDGET_PREFLIGHT_FIELDS,
  STRATOS_BUDGET_CONFIRM_FIELDS,
  stratosBudgetPreflightWorkflow,
  stratosBudgetLineageFromVersion,
  stratosBudgetVersionLineageFromUploadToken,
  stratosBudgetVersionSourceLocation,
  type StratosBudgetUploadConfirmResult,
} from "../src/lib/stratos/document-ai";
import { parseInformationPolicy, policyHash } from "../src/lib/stratos/information-policy";
import {
  createUploadPreflightDecision,
  createUploadReceipt,
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
  publicUploadBasePath: "/api/document-intake/v1/sessions",
  expiresInSeconds: 900,
};

function policy() {
  return parseInformationPolicy({
    schemaVersion: "stratos-information-policy-2",
    policyBindingId: "pb_budget_contract_12345678",
    policyVersion: "information-policy-2.0.0",
    handlingClass: "PROJECT_MANAGEMENT",
    legalClassification: "NONE",
    tlp: "TLP:AMBER",
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
      tlp: "TLP:AMBER",
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
    document_profile: budgetContractProfile(),
    document_version_profile: (({ expected_root_metadata_revision: _, ...draft }) => draft)(contractVersionProfile()),
    title: "S-2026-001 – smlouva.pdf",
    classification: "project_management",
    actor_subject_id: "subject-budget-owner",
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

describe("Budget upload OpenAPI contract", () => {
  const specification = JSON.parse(readFileSync(new URL("../../../openapi/openapi.json", import.meta.url), "utf8"));
  const validator = new Ajv2020({ strict: false, allErrors: true });
  addFormats(validator);
  validator.addSchema({ $id: "akb", components: specification.components });
  const schema = (name: string) => validator.compile({ $ref: `akb#/components/schemas/${name}` });

  it("matches the closed parser fields and accepts the actual interactive and batch request fixtures", () => {
    const preflight = schema("WebBudgetUploadPreflightRequest");
    const confirm = schema("WebBudgetUploadConfirmRequest");
    assert.deepEqual(Object.keys(specification.components.schemas.WebBudgetUploadPreflightRequest.properties).sort(), [...STRATOS_BUDGET_PREFLIGHT_FIELDS].sort());
    assert.deepEqual(Object.keys(specification.components.schemas.WebBudgetUploadConfirmRequest.properties).sort(), [...STRATOS_BUDGET_CONFIRM_FIELDS].sort());
    const body = preflightBody();
    assert.ok(parseStratosBudgetPreflightContract(body));
    assert.equal(preflight(body), true, JSON.stringify(preflight.errors));
    const historical = structuredClone(body);
    Object.assign(historical.metadata, {
      batch_manifest_id: "budget-history-2026", batch_entries_sha256: fileHash, release_revision: "a".repeat(40),
    });
    assert.equal(stratosBudgetPreflightWorkflow(parseStratosBudgetPreflightContract(historical), false).mode, "historical_batch");
    assert.equal(preflight(historical), true, JSON.stringify(preflight.errors));
    assert.equal(preflight({ ...body, metadata: { ...body.metadata, batch_manifest_id: "partial" } }), false);
    assert.equal(preflight({ ...body, metadata: { ...body.metadata, lifecycle: "ARCHIVED" } }), false);
    assert.equal(preflight({ ...body, source_system: "other" }), false);
    const confirmation = {
      ...Object.fromEntries(Object.entries(body).filter(([key]) => (STRATOS_BUDGET_CONFIRM_FIELDS as readonly string[]).includes(key))),
      document_profile: contractVersionProfile(),
      document_id: "doc_budget_123", external_document_id: "extdoc_budget_123",
      upload_session_id: "upl-budget-test", upload_token: "signed-upload-token",
      upload_receipt: "signed-intake-receipt", source_file_uri: "s3://akl-documents/budget/smlouva.pdf",
      file_hash: fileHash, version_label: "upload-bbbbbbbbbbbbbbbb",
    };
    assert.ok(parseStratosBudgetConfirmContract(confirmation));
    assert.equal(confirm(confirmation), true, JSON.stringify(confirm.errors));
    const missingReceipt: Record<string, unknown> = { ...confirmation };
    delete missingReceipt.upload_receipt;
    assert.equal(confirm(missingReceipt), false);
    assert.equal(confirm({ ...confirmation, parser_profile: "unapproved-profile" }), false);
  });

  it("accepts the real preflight decision fields and describes both current authentication modes", () => {
    const body = preflightBody();
    const decision = createUploadPreflightDecision({
      document_id: "doc_budget_123", file_name: body.file_name, file_type: body.file_type,
      file_size: body.file_size, sha256: body.sha256,
    }, uploadSettings);
    const response = {
      ...Object.fromEntries(Object.entries(decision).filter(([key]) => [
        "upload_session_id", "upload_url", "upload_method", "source_file_uri", "expires_at", "required_headers", "file",
      ].includes(key))),
      document_profile: contractVersionProfile(),
      required_authentication: { transport: "server_to_server", service_bearer: true, actor_bearer: true },
      document_id: "doc_budget_123", external_document_id: "extdoc_budget_123", external_ref: body.external_ref,
      policy_binding_id: body.information_policy.policyBindingId, policy_version: body.information_policy.policyVersion,
      policy_hash: body.integration_envelope.policyHash, canonical_open_url: "/akb/documents/doc_budget_123",
    };
    const validate = schema("WebBudgetUploadPreflightResponse");
    assert.equal(validate(response), true, JSON.stringify(validate.errors));
    response.required_authentication.actor_bearer = false;
    assert.equal(validate(response), true, JSON.stringify(validate.errors));
    for (const path of ["/api/stratos/budget-upload/preflight", "/api/stratos/budget-upload/sessions/{sessionId}/confirm"]) {
      const operation = specification.paths[path].post;
      assert.deepEqual(operation.security, [{ bearerAuth: [] }, { bearerAuth: [], stratosActorBearer: [] }]);
      assert.ok(operation.requestBody.required);
      assert.match(operation.description, /historical_batch forbids that header/);
      assert.ok(operation.responses["200"].content["application/json"].schema.$ref);
      assert.ok(operation.responses["201"].content["application/json"].schema.$ref);
    }
  });

  it("requires the complete typed confirmation result including governance and the activated job", () => {
    const body = preflightBody();
    const result: StratosBudgetUploadConfirmResult = {
      document_id: "doc_budget_123", document_version_id: "ver_budget_123",
      external_document_id: "extdoc_budget_123", file_id: "file_budget_123",
      ingestion_job_id: "job_budget_123", ingestion_status: "INGESTING", idempotent_replay: false,
      canonical_open_url: "/akb/documents/doc_budget_123?version=ver_budget_123",
      policy_binding_id: body.information_policy.policyBindingId,
      policy_version: body.information_policy.policyVersion, policy_hash: body.integration_envelope.policyHash,
      file_name: body.file_name, file_type: body.file_type, file_size: body.file_size,
      document_version_status: "valid", governance_confirmation: { document: {}, version: {} },
    };
    const validate = schema("WebBudgetUploadConfirmResponse");
    assert.equal(validate(result), true, JSON.stringify(validate.errors));
    const incomplete: Record<string, unknown> = { ...result };
    delete incomplete.governance_confirmation;
    assert.equal(validate(incomplete), false);
    assert.equal(validate({ ...result, ingestion_job_id: null }), false);
    assert.equal(validate({ ...result, document_version_status: "draft" }), true);
    assert.equal(validate({ ...result, document_version_status: "invented" }), false);
  });
});

describe("STRATOS Budget document bridge contract", () => {
  it("normalizes project-management handling to Registry internal classification", () => {
    const parsed = parseStratosBudgetPreflightContract(preflightBody());
    assert.equal(parsed.registryClassification, "internal");
    assert.equal(parsed.actorSubjectId, "subject-budget-owner");
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

  for (const audience of ["organization", "recipient_set"] as const) {
    it(`preserves the signed ${audience} audience and separate financial source scope`, () => {
      const body = preflightBody();
      body.information_policy.audience.scopeType = audience;
      body.information_policy.audience.scopeIds = [];
      body.information_policy.audience.recipientSubjectIds = audience === "recipient_set" ? ["subject-budget-owner"] : [];
      if (audience === "recipient_set") body.information_policy.tlp = "TLP:RED";
      body.integration_envelope.classification.tlp = body.information_policy.tlp!;
      body.integration_envelope.policyHash = policyHash(body.information_policy);
      const parsed = parseStratosBudgetPreflightContract(body);
      assert.equal(parsed.informationPolicy.audience.scopeType, audience);
      assert.equal(parsed.governanceScope.id, "budget:sekce-it");
      body.governance_scope.id = "budget:other";
      assert.throws(() => parseStratosBudgetPreflightContract(body));
    });
  }

  it("accepts the narrower confirmation contract without preflight-only presentation fields", () => {
    const informationPolicy = policy();
    const parsed = parseStratosBudgetConfirmContract({
      document_profile: contractVersionProfile(),
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
    assert.equal(parsed.actorSubjectId, "subject-budget-owner");
    assert.equal(parsed.fileName, "smlouva.pdf");
  });

  it("binds mode, immutable contract history and batch provenance into the signed token", () => {
    const decision = createUploadPreflightDecision({
      document_id: "doc_budget_123",
      file_name: "smlouva.pdf",
      file_type: "application/pdf",
      file_size: 1024,
      sha256: fileHash,
      document_profile: contractVersionProfile(),
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
        document_profile: contractVersionProfile(),
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
      document_profile: contractVersionProfile(),
        tenant_id: "org_stratos",
        external_system: "STRATOS_BUDGET",
        external_ref: "contract:contract-123:document:signed",
        entity_type: "Contract",
        entity_id: "contract-123",
        document_id: "doc_budget_123",
        external_document_id: "extdoc_budget_123",
        upload_session_id: payload.session_id,
        upload_token: "signed-token",
        upload_receipt: "signed-document-intake-receipt-for-canonical-lineage",
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
          document_profile: contractVersionProfile(),
          version_label: "upload-bbbbbbbbbbbbbbbb",
          source_file_uri: payload.source_file_uri,
          intake_receipt: "signed-document-intake-receipt-for-canonical-lineage",
        },
        sourceLocation,
        versionLineage: stratosBudgetVersionLineageFromUploadToken(payload),
      });
      assert.equal(canonical.fileType, canonicalMime);
      assert.equal(sourceLocation.content_type, canonicalMime);
      assert.equal((request.file as { mime_type: string }).mime_type, canonicalMime);
    }
  });

  it("uses a dedicated 100 MiB Budget limit without widening general uploads", () => {
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


describe("Budget profile actual route boundary", () => {
  it("binds the Registry root revision, separates actor/owner, and rejects missing or stale profiles before file access", async (t) => {
    const previous = { ...process.env }; const previousFetch = globalThis.fetch;
    Object.assign(process.env, {
      AKL_ENV: "development", AKL_AUTH_MODE: "oidc", AKL_IDENTITY_MODE: "external_oidc", AKL_API_CLIENT_MODE: "production",
      AKL_WEB_OIDC_ISSUER: "https://identity.test", AKL_WEB_OIDC_CLIENT_ID: "test-web", AKL_WEB_OIDC_CLIENT_SECRET: "test-secret",
      AKL_WEB_PUBLIC_BASE_URL: "https://akb.test", AKL_WEB_SESSION_SECRET: "test-session-secret",
      AKL_WEB_STRATOS_AUTH_ME_URL: "https://stratos.test/api/v1/auth/me", AKL_WEB_UPLOAD_SIGNING_SECRET: uploadSettings.signingSecret,
      AKL_WEB_OBJECT_STORAGE_ROOT: "/tmp/akb-budget-profile-no-file", STRATOS_CONTENT_SECURITY_REQUIRED: "false",
      ...Object.fromEntries(["REGISTRY", "INGESTION", "RAG", "GOVERNANCE", "EVALUATION"].map(name => [`AKL_${name}_API_BASE_URL`, `https://${name.toLowerCase()}.test/api/v1`])),
    });
    t.after(() => { for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous); globalThis.fetch = previousFetch; });
    const body = preflightBody();
    Object.assign(body.metadata, { batch_manifest_id: "batch-profile", batch_entries_sha256: fileHash, release_revision: "a".repeat(40) });
    const profile = { ...budgetContractProfile(), schemaVersion: "stratos-document-root-1", organizationId: "org_stratos",
      documentId: "doc_budget_123", metadataRevision: "registry-current-revision-7", documentType: "contract" };
    let registrationMode = "valid"; let registrations = 0; let authorizations = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url === "https://identity.test/protocol/openid-connect/token/introspect") return Response.json({ active: true,
        sub: "service-budget-test", preferred_username: "service-account-stratos-akb-service", azp: "stratos-akb-service",
        aud: "akl-api", realm_access: { roles: ["service_ingestion"] } });
      if (url.endsWith("/integrations/stratos-budget-upload/external-documents/upsert")) {
        registrations++;
        const actual = JSON.parse(String(init?.body));
        assert.equal(actual.owner.user_id, body.document_profile.accountability.ownerSubjectId);
        assert.notEqual(actual.owner.user_id, actual.integration_envelope.actor.subjectId);
        assert.deepEqual(actual.document_profile, body.document_profile);
        return Response.json({ created: false,
          external_document: { external_document_id: "extdoc_budget_123", tenant_id: body.tenant_id, external_system: body.external_system,
            external_ref: body.external_ref, entity_type: body.entity_type, entity_id: body.entity_id, document_id: "doc_budget_123",
            current_document_version_id: null, current_ingestion_job_id: null },
          document: { document_id: "doc_budget_123", policy_binding_id: body.information_policy.policyBindingId,
            policy_version: body.information_policy.policyVersion, policy_hash: body.integration_envelope.policyHash,
            governed_parent_resource_id: body.parent_governed_resource_id, governance_scope_type: body.governance_scope.type,
            governance_scope_id: body.governance_scope.id, governed_resource_id: "gres_document_test", governance_registration_status: "REGISTERED",
            document_profile: registrationMode === "missing" ? null : profile,
            current_root_metadata_revision: registrationMode === "stale" ? "old-revision" : profile.metadataRevision,
            current_root_snapshot_hash: `sha256:${createHash("sha256").update(canonicalDocumentSnapshot(profile)).digest("hex")}` },
        });
      }
      if (url.endsWith("/intake-authorization")) {
        authorizations++;
        const actual = JSON.parse(String(init?.body));
        assert.equal(actual.document_profile.expected_root_metadata_revision, profile.metadataRevision);
        return Response.json({ error: { code: "DOCUMENT_PROFILE_STALE", message: "Source root changed", details: {}, trace_id: "test" } }, { status: 409 });
      }
      throw new Error(`Unexpected network dependency ${url}`);
    };
    const call = (value: unknown) => budgetPreflight(new NextRequest("https://akb.test/api/stratos/budget-upload/preflight", {
      method: "POST", headers: { Authorization: "Bearer test-service-token" }, body: JSON.stringify(value),
    }));
    for (const field of ["document_profile", "document_version_profile"]) {
      const missing: Record<string, unknown> = { ...body }; delete missing[field];
      const response = await call(missing);
      assert.equal(response.status, 422, await response.clone().text());
      assert.equal((await response.json()).error.code, "DOCUMENT_PROFILE_REQUIRED");
    }
    assert.equal(registrations, 0);
    for (const mode of ["missing", "stale"]) {
      registrationMode = mode;
      const response = await call(body);
      assert.equal(response.status, 502, await response.clone().text());
    }
    registrationMode = "valid";
    const response = await call(body);
    assert.equal(response.status, 200, await response.clone().text());
    const prepared = await response.json();
    const payload = verifyUploadToken(prepared.required_headers["X-AKL-Upload-Token"], getStratosBudgetUploadSettings());
    assert.equal(payload.document_profile?.expected_root_metadata_revision, profile.metadataRevision);
    assert.deepEqual(payload.document_profile, prepared.document_profile);
    const confirmation = {
      ...Object.fromEntries(Object.entries(body).filter(([key]) => (STRATOS_BUDGET_CONFIRM_FIELDS as readonly string[]).includes(key))),
      document_profile: prepared.document_profile,
      document_id: payload.document_id, external_document_id: "extdoc_budget_123", upload_session_id: payload.session_id,
      upload_token: prepared.required_headers["X-AKL-Upload-Token"], source_file_uri: payload.source_file_uri,
      file_hash: payload.sha256, version_label: "upload-bbbbbbbbbbbbbbbb", upload_receipt: "placeholder",
    };
    confirmation.upload_receipt = createUploadReceipt(confirmation.upload_token, payload, { path: "/tmp/not-created", size_bytes: payload.file_size, sha256: payload.sha256 }, getStratosBudgetUploadSettings());
    const confirm = (value: unknown) => budgetConfirm(new NextRequest(`https://akb.test/api/stratos/budget-upload/sessions/${payload.session_id}/confirm`, {
      method: "POST", headers: { Authorization: "Bearer test-service-token" }, body: JSON.stringify(value),
    }), { params: Promise.resolve({ sessionId: payload.session_id }) });
    const changed = structuredClone(confirmation); changed.document_profile.lifecycle.reviewAt = "2028-01-01";
    const conflict = await confirm(changed);
    assert.equal(conflict.status, 409, await conflict.clone().text());
    assert.equal((await conflict.json()).error.code, "STRATOS_BUDGET_UPLOAD_PROFILE_CONFLICT");
    assert.equal(authorizations, 0);
    const stale = await confirm(confirmation);
    assert.equal(stale.status, 409, await stale.clone().text());
    assert.equal((await stale.json()).error.code, "DOCUMENT_PROFILE_STALE");
    assert.equal(authorizations, 1); // Nonexistent stored object was never opened.
  });
});
