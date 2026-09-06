import { contractVersionProfile } from "./fixtures/document-profiles";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { NextRequest } from "next/server";

import { POST } from "../src/app/api/stratos/budget-upload/sessions/[sessionId]/confirm/route";
import { ingestionJobIdForIdempotencyKey, resetIngestionServiceTokenCacheForTests } from "../src/lib/ingestion/service-identity";
import { getStratosBudgetUploadSettings, STRATOS_BUDGET_UPLOAD_TOKEN_PURPOSE } from "../src/lib/stratos/document-ai";
import { parseInformationPolicy, policyHash } from "../src/lib/stratos/information-policy";
import type { DocumentVersion } from "../src/lib/types";
import {
  createUploadPreflightDecision,
  createUploadReceipt,
  persistUploadedObject,
  verifyUploadToken,
} from "../src/lib/upload/preflight";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const documentId = "doc_budget_recovery";
const externalDocumentId = "ext_budget_recovery";
const versionId = "ver_budget_original";
const fileId = "file_budget_original";
const actorSubjectId = "subject-budget-owner";
const correlationId = "corr-budget-recovery";
const externalRef = "contract:contract-123:document:signed";
const idempotencyKey = `confirm:${externalDocumentId}:${versionId}`;
const jobId = ingestionJobIdForIdempotencyKey(idempotencyKey);
const content = Buffer.from("%PDF-1.7\nBudget recovery fixture\n%%EOF\n");
const fileHash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
const policy = parseInformationPolicy({
  schemaVersion: "stratos-information-policy-2",
  policyBindingId: "pb_budget_contract_12345678",
  policyVersion: "information-policy-2.0.0",
  handlingClass: "INTERNAL",
  legalClassification: "NONE",
  tlp: "TLP:GREEN",
  pap: null,
  contentCategories: ["CONTRACTUAL", "FINANCIAL"],
  audience: {
    organizationId: "org_stratos",
    scopeType: "budget_scope",
    scopeIds: ["budget:section-it"],
    recipientSubjectIds: [],
  },
  obligations: ["AUDIT_ACCESS"],
  originatorId: actorSubjectId,
  issuedAt: "2026-07-20T10:00:00Z",
  reviewAt: null,
});
const envelope = {
  schemaVersion: "stratos-integration-envelope-1",
  organizationId: "org_stratos",
  sourceSystem: "STRATOS_BUDGET",
  externalRef,
  actor: { type: "person", subjectId: actorSubjectId },
  correlationId,
  idempotencyKey: "budget-contract-upload:contract-123",
  policyBindingId: policy.policyBindingId,
  policyVersion: policy.policyVersion,
  policyHash: policyHash(policy),
  classification: { handlingClass: policy.handlingClass, legalClassification: "NONE", tlp: policy.tlp, pap: null },
  payload: { contractId: "contract-123", financialScopeKey: "budget:section-it", fileHash },
};

let storageRoot: string;
let canonicalVersion: DocumentVersion;
let incoming: Awaited<ReturnType<typeof uploadSession>>;
let original: Awaited<ReturnType<typeof uploadSession>>;
let registryWrites: number;
let ingestionRequests: Record<string, unknown>[];
let fetchedUrls: string[];

async function uploadSession(documentProfile = contractVersionProfile()) {
  const settings = getStratosBudgetUploadSettings();
  const decision = createUploadPreflightDecision({
    document_id: documentId,
    file_name: "smlouva.pdf",
    file_size: content.length,
    file_type: "application/pdf",
    sha256: fileHash,
    policy_binding_id: policy.policyBindingId,
    policy_version: policy.policyVersion,
    policy_hash: policyHash(policy),
    external_document_id: externalDocumentId,
    governed_document_resource_id: "gres_budget_document",
    source_governed_resource_id: "gres_budget_contract_123",
    source_resource_id: "contract-123",
    source_version: fileHash,
    governance_scope: { type: "budget_scope", id: "budget:section-it" },
    governance_actor_subject_id: actorSubjectId,
    governance_registered_by_subject_id: "service-subject-valid-budget-token",
    governance_correlation_id: correlationId,
    governance_idempotency_key: envelope.idempotencyKey,
    document_profile: documentProfile,
    purpose: STRATOS_BUDGET_UPLOAD_TOKEN_PURPOSE,
    workflow_mode: "historical_batch",
    workflow_context: {
      original_file_name: "smlouva.pdf",
      contract_status: "EXPIRED",
      contract_start_date: "2023-01-01",
      contract_end_date: "2025-12-31",
      batch_manifest_id: "historical-contracts-test",
      batch_entries_sha256: `sha256:${"c".repeat(64)}`,
      release_revision: "d".repeat(40),
    },
  }, settings);
  const token = decision.required_headers["X-AKL-Upload-Token"];
  const payload = verifyUploadToken(token, settings);
  const persisted = await persistUploadedObject(payload, content, settings);
  const receipt = createUploadReceipt(token, payload, persisted, settings, {
    status: "clean", engine: "clamav", engine_version: "1.4.3", signature_version: "27632",
    scanned_at: new Date().toISOString(), duration_ms: 42,
  });
  return { decision, token, payload, persisted, receipt };
}

function confirmBody(session = incoming) {
  return {
    tenant_id: "org_stratos", external_system: "STRATOS_BUDGET", external_ref: externalRef,
    entity_type: "Contract", entity_id: "contract-123", document_id: documentId,
    external_document_id: externalDocumentId, upload_session_id: session.payload.session_id,
    document_profile: session.payload.document_profile,
    upload_token: session.token, upload_receipt: session.receipt,
    source_file_uri: session.payload.source_file_uri, file_hash: fileHash,
    file_name: "smlouva.pdf", file_type: "application/pdf", file_size: content.length,
    version_label: "signed-v1", information_policy: policy, integration_envelope: envelope,
    governance_scope: { type: "budget_scope", id: "budget:section-it" },
    parent_governed_resource_id: "gres_budget_contract_123",
  };
}

async function confirm(body = confirmBody()) {
  const response = await POST(new NextRequest(
    `https://stratos.example/akb/api/stratos/budget-upload/sessions/${body.upload_session_id}/confirm`,
    {
      method: "POST",
      headers: { Authorization: "Bearer valid-budget-token", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  ), { params: Promise.resolve({ sessionId: body.upload_session_id }) });
  return { status: response.status, body: await response.json() };
}

beforeEach(async () => {
  storageRoot = await mkdtemp(path.join(os.tmpdir(), "akb-budget-recovery-"));
  Object.assign(process.env, {
    AKL_ENV: "test", AKL_API_CLIENT_MODE: "production", AKL_AUTH_MODE: "oidc",
    AKL_REGISTRY_API_BASE_URL: "http://registry.test/api/v1",
    AKL_INGESTION_API_BASE_URL: "http://ingestion.test/api/v1",
    AKL_RAG_API_BASE_URL: "http://rag.test/api/v1",
    AKL_GOVERNANCE_API_BASE_URL: "http://governance.test/api/v1",
    AKL_EVALUATION_API_BASE_URL: "http://evaluation.test/api/v1",
    AKL_WEB_PUBLIC_BASE_URL: "https://stratos.example/akb",
    AKL_WEB_OIDC_ISSUER: "https://login.example/realms/stratos",
    AKL_WEB_OIDC_CLIENT_ID: "akl-web", AKL_WEB_OIDC_CLIENT_SECRET: "test-only-secret",
    AKL_WEB_SESSION_SECRET: "test-only-session-secret-that-is-long-enough",
    AKL_WEB_STRATOS_AUTH_ME_URL: "http://stratos.test/api/v1/auth/me",
    AKL_WEB_INGESTION_TOKEN_URL: "https://login.example/ingestion-token",
    AKL_WEB_INGESTION_CLIENT_ID: "svc-akb-web-ingestion",
    AKL_WEB_INGESTION_CLIENT_SECRET: "test-only-ingestion-secret",
    AKL_OBJECT_STORAGE_MODE: "local", AKL_WEB_OBJECT_STORAGE_ROOT: storageRoot,
    AKL_S3_BUCKET: "akl-documents", AKL_WEB_UPLOAD_SIGNING_SECRET: "test-only-upload-secret",
    STRATOS_CONTENT_SECURITY_REQUIRED: "true", STRATOS_CONTENT_SECURITY_MODE: "clamd",
  });
  resetIngestionServiceTokenCacheForTests();
  original = await uploadSession();
  incoming = await uploadSession();
  canonicalVersion = {
    document_version_id: versionId, document_id: documentId, version_label: "signed-v1", status: "valid",
    valid_from: null, valid_to: null, source_file_uri: original.payload.source_file_uri,
    file_hash: fileHash, file_id: fileId, change_summary: null,
    created_at: new Date().toISOString(), published_at: new Date().toISOString(),
    policy_binding_id: policy.policyBindingId, policy_version: policy.policyVersion, policy_hash: policyHash(policy),
    content_security_status: "clean", content_security_engine: "clamav",
    content_security_scanned_at: new Date().toISOString(),
  };
  registryWrites = 0;
  ingestionRequests = [];
  fetchedUrls = [];
  const reference = { external_document_id: externalDocumentId, external_ref: externalRef };
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    fetchedUrls.push(url);
    if (url.endsWith("/protocol/openid-connect/token/introspect")) {
      return Response.json({
        active: true, client_id: "stratos-akb-service", azp: "stratos-akb-service",
        sub: "service-subject-valid-budget-token", preferred_username: "service-account-stratos-akb-service",
        aud: ["akl-api"], realm_access: { roles: ["service_ingestion"] },
      });
    }
    if (url.endsWith(`/documents/${documentId}/intake-authorization`)) {
      const requested = JSON.parse(String(init?.body));
      assert.deepEqual(requested.document_profile, incoming.payload.document_profile);
      return Response.json({ allowed: true, document_id: documentId, upload_session_id: requested.upload_session_id,
        confirmed_subject_id: requested.actor_subject_id, registered_by_subject_id: requested.registered_by_subject_id,
        policy_binding_id: requested.policy_binding_id, policy_version: requested.policy_version, policy_hash: requested.policy_hash,
        source_governed_resource_id: requested.source_governed_resource_id, source_version: requested.source_version, reason_codes: [] });
    }
    if (url.endsWith(`/documents/${documentId}/versions`)) {
      registryWrites += 1;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.file.source_file_uri ?? body.source_file_uri, incoming.payload.source_file_uri);
      assert.equal(body.file.intake_receipt, incoming.receipt);
      return Response.json({
        version: canonicalVersion, created: false,
        external_document: { external_document: reference, document: {}, created: false },
        governance_confirmation: { document: {}, version: {} },
      });
    }
    if (url.endsWith(`/versions/${versionId}/ingestion-authorization`)) {
      return Response.json({
        document_id: documentId, document_version_id: versionId, confirmed_subject_id: actorSubjectId,
        correlation_id: correlationId, idempotency_key: idempotencyKey,
        authorization_token: "test-only-registry-proof-for-budget-ingestion",
      });
    }
    if (url.endsWith(`/documents/${documentId}/status`)) {
      return Response.json({ document_id: documentId, updated: 0, items: [reference], ingestion_attempt: null });
    }
    if (url.endsWith(`/external-documents/${externalDocumentId}/current`)) {
      return Response.json({
        updated: true,
        external_document: {
          external_document: {
            ...reference, current_document_version_id: versionId, current_file_id: fileId,
            current_ingestion_job_id: jobId, current_ingestion_status: "INGESTING",
          },
          document: {}, created: false,
        },
      });
    }
    if (url === "https://login.example/ingestion-token") {
      return Response.json({ access_token: "test-only-transport-token", expires_in: 60 });
    }
    if (url === "http://ingestion.test/api/v1/ingestion/jobs") {
      ingestionRequests.push(JSON.parse(String(init?.body)));
      return Response.json({ job_id: jobId, document_id: documentId, document_version_id: versionId, status: "completed" });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  resetIngestionServiceTokenCacheForTests();
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  await rm(storageRoot, { recursive: true, force: true });
});

describe("Budget confirmation recovery across upload sessions", () => {
  it("recovers a new clean session using the original immutable object and stable ingestion identity", async () => {
    assert.notEqual(incoming.payload.source_file_uri, original.payload.source_file_uri);
    const result = await confirm();
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.idempotent_replay, true);
    assert.equal(result.body.document_version_id, versionId);
    assert.equal(result.body.file_id, fileId);
    assert.equal(result.body.ingestion_job_id, jobId);
    assert.equal(ingestionRequests.length, 1);
    assert.equal(ingestionRequests[0].source_file_uri, original.payload.source_file_uri);
    assert.equal(ingestionRequests[0].idempotency_key, idempotencyKey);
    assert.deepEqual(await readFile(original.persisted.path), content);
    // Retain the new blob during the session TTL so concurrent/repeated confirms
    // can still validate its receipt before resolving the same original version.
    assert.deepEqual(await readFile(incoming.persisted.path), content);
    const retried = await confirm();
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.equal(retried.body.ingestion_job_id, jobId);
  });

  it("ingests an explicit draft record for review and returns its real draft status", async () => {
    const draft = contractVersionProfile();
    draft.domain_evidence.executionStatus = "draft";
    draft.domain_evidence.executionEvidenceReference = null;
    Object.assign(draft.lifecycle, { mode: "record", recordedOn: "2026-09-05", effectiveFrom: null, effectiveTo: null });
    original = await uploadSession(draft);
    incoming = await uploadSession(draft);
    canonicalVersion.status = "draft";
    canonicalVersion.source_file_uri = original.payload.source_file_uri;
    const result = await confirm();
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.document_version_status, "draft");
    assert.equal(ingestionRequests.length, 1);
    assert.equal(ingestionRequests[0].source_file_uri, original.payload.source_file_uri);
  });

  it("rejects a receipt from the original session before attempting a Registry write", async () => {
    const result = await confirm({ ...confirmBody(), upload_receipt: original.receipt });
    assert.equal(result.status, 409);
    assert.equal(registryWrites, 0);
    assert.equal(ingestionRequests.length, 0);
  });

  it("rejects a tampered incoming object before attempting a Registry write", async () => {
    await writeFile(incoming.persisted.path, Buffer.alloc(content.length, 1));
    const result = await confirm();
    assert.equal(result.status, 409);
    assert.equal(registryWrites, 0);
    assert.equal(ingestionRequests.length, 0);
  });

  for (const failure of ["missing", "tampered"] as const) {
    it(`does not ingest when the original canonical object is ${failure}`, async () => {
      if (failure === "missing") await rm(original.persisted.path);
      else await writeFile(original.persisted.path, Buffer.alloc(content.length, 1));
      const result = await confirm();
      assert.equal(result.status, 409, JSON.stringify(result.body));
      assert.equal(registryWrites, 1);
      assert.equal(ingestionRequests.length, 0);
      assert.ok(!fetchedUrls.some((url) => url.endsWith("/ingestion-authorization")));
    });
  }

  for (const sourceUri of [
    "https://internal.example/private-document",
    "s3://another-bucket/doc_budget_recovery/draft/2026-09-05/upl_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/smlouva.pdf",
    "s3://akl-documents/other-document/draft/2026-09-05/upl_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/smlouva.pdf",
    "s3://akl-documents/doc_budget_recovery/draft/2026-09-05/upl_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/%2e%2e",
  ]) {
    it(`rejects canonical recovery outside the signed object namespace: ${sourceUri}`, async () => {
      canonicalVersion.source_file_uri = sourceUri;
      const result = await confirm();
      assert.equal(result.status, 502, JSON.stringify(result.body));
      assert.equal(result.body.error.code, "STRATOS_BUDGET_SOURCE_CONFLICT");
      assert.equal(ingestionRequests.length, 0);
      assert.ok(!fetchedUrls.includes(sourceUri));
    });
  }

  it("rejects a conflicting original hash or policy before ingestion", async () => {
    for (const field of ["file_hash", "policy_hash"] as const) {
      const saved = canonicalVersion[field];
      canonicalVersion[field] = `sha256:${"f".repeat(64)}`;
      const result = await confirm();
      assert.equal(result.status, 502);
      assert.equal(result.body.error.code, "STRATOS_BUDGET_VERSION_CONFLICT");
      canonicalVersion[field] = saved as string;
    }
    assert.equal(ingestionRequests.length, 0);
  });

  it("does not use a new clean receipt to repair an unscanned canonical original", async () => {
    canonicalVersion.content_security_status = "not_performed";
    const result = await confirm();
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, "DOCUMENT_INTAKE_SCAN_REQUIRED");
    assert.equal(ingestionRequests.length, 0);
  });
});
