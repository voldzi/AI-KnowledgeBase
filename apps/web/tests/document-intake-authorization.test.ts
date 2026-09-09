import { contractVersionProfile, nativeContractSnapshot } from "./fixtures/document-profiles";
import { canonicalDocumentSnapshot } from "../src/lib/documents/document-profile";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { ProductionRegistryClient } from "../src/lib/api/production/registry-client";
import { parseInformationPolicy, policyHash } from "../src/lib/stratos/information-policy";
import type { StratosDocumentServicePrincipal } from "../src/lib/stratos/document-service-auth";
import { ApiClientError, type ApiRequestContext, type BudgetIntakeAuthorizationResponse, type Document } from "../src/lib/types";
import {
  acceptAuthorizedDocumentIntakeContent,
  authorizeControlledDocumentUpload,
  type DocumentIntakeAuthorizationDependencies,
} from "../src/lib/upload/document-intake-authorization";
import { acceptDocumentIntakeContent, type DocumentIntakeAcceptedUpload } from "../src/lib/upload/document-intake";
import { createUploadPreflightDecision, verifyUploadToken, UploadPreflightError, type UploadTokenPayload, type UploadSettings } from "../src/lib/upload/preflight";

const informationPolicy = parseInformationPolicy({
  schemaVersion: "stratos-information-policy-2",
  policyBindingId: "pb_intake_authorization_test",
  policyVersion: "information-policy-2.0.0",
  handlingClass: "INTERNAL",
  legalClassification: "NONE",
  tlp: "TLP:AMBER", pap: null, contentCategories: [], obligations: ["AUDIT_ACCESS"],
  audience: { organizationId: "org_stratos", scopeType: "organization", scopeIds: [], recipientSubjectIds: [] },
  originatorId: "actor-one", issuedAt: "2026-09-05T00:00:00Z", reviewAt: null,
});
const currentHash = policyHash(informationPolicy);
const rootSnapshot = nativeContractSnapshot("doc_intake");
const document = {
  document_profile: rootSnapshot, current_root_metadata_revision: rootSnapshot.metadataRevision,
  current_root_snapshot_hash: `sha256:${createHash("sha256").update(canonicalDocumentSnapshot(rootSnapshot)).digest("hex")}`,
  document_id: "doc_intake", policy_binding_id: informationPolicy.policyBindingId,
  policy_version: informationPolicy.policyVersion, policy_hash: currentHash,
  policy_summary: informationPolicy,
} as unknown as Document;
const context: ApiRequestContext = {
  subjectId: "actor-one", authorizationSource: "stratos_projection",
  capabilities: ["akb:upload"], accessToken: "test-person-credential",
};
const service: StratosDocumentServicePrincipal = {
  subjectId: "service-account-stratos-akb-service", clientId: "stratos-akb-service",
  accessToken: "test-service-credential", roles: ["service_ingestion"],
  allowedSourceSystems: ["STRATOS_BUDGET"],
};
const settings: UploadSettings = {
  objectStorageRoot: "/tmp/not-used-by-intake-authorization-tests", bucket: "test",
  signingSecret: "test-only-signing-key", maxFileBytes: 1024,
  publicUploadBasePath: "/api/document-intake/v1/sessions", expiresInSeconds: 900,
};

function token(overrides: Partial<UploadTokenPayload> = {}): UploadTokenPayload {
  return {
    session_id: "session-one", document_id: document.document_id,
    bucket: "test", object_key: "object", source_file_uri: "s3://test/object",
    file_name: "test.pdf", file_size: 3, file_type: "application/pdf", sha256: `sha256:${"a".repeat(64)}`,
    expires_at: "2099-01-01T00:00:00Z", policy_binding_id: informationPolicy.policyBindingId,
    policy_version: informationPolicy.policyVersion, policy_hash: currentHash,
    external_document_id: "external-one", expected_current_document_version_id: null,
    governed_document_resource_id: "gres-document", source_governed_resource_id: "gres-contract",
    source_resource_id: "contract-one", source_version: `sha256:${"a".repeat(64)}`,
    governance_scope: { type: "budget_scope", id: "budget:it" },
    governance_actor_subject_id: context.subjectId,
    governance_registered_by_subject_id: service.subjectId,
    governance_correlation_id: "correlation-one", governance_idempotency_key: "idempotency-one",
    document_profile: contractVersionProfile(),
    purpose: "controlled-document-upload", workflow_mode: "interactive",
    workflow_context: {
      original_file_name: "test.pdf", contract_status: "ACTIVE",
      contract_start_date: "2026-01-01", contract_end_date: "2027-01-01",
    },
    ...overrides,
  };
}

function harness(payload = token(), actorHeader = false) {
  const events: string[] = [];
  let bodyAccesses = 0;
  let contentPipelineCalls = 0;
  const original = new Request("https://akb.test/api/document-intake/v1/sessions/session-one/content", {
    method: "PUT", body: new Uint8Array([1, 2, 3]),
    headers: actorHeader ? { "X-STRATOS-Actor-Authorization": "Bearer test-person-credential" } : {},
  });
  const request = new Proxy(original, {
    get(target, property) {
      if (["body", "arrayBuffer", "text", "json", "blob", "formData"].includes(String(property))) bodyAccesses += 1;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const dependencies: DocumentIntakeAuthorizationDependencies = {
    registry: {
      async getDocument() { events.push("document"); return document; },
      async authorizeDocument(id, action, actor) {
        events.push(`authorize:${action}`);
        assert.equal(id, payload.document_id);
        return {
          allowed: Boolean(actor.capabilities?.includes("akb:upload")), reason: "test decision", reason_codes: [],
          constraints: { policy_binding_id: informationPolicy.policyBindingId, policy_hash: currentHash },
        };
      },
      async authorizeBudgetDocumentIntake(id, requested, transport, actorToken) {
        events.push("budget-policy");
        assert.deepEqual(requested.document_profile, payload.document_profile);
        assert.equal(transport.subjectId, service.subjectId);
        assert.equal(transport.accessToken, service.accessToken);
        assert.equal(actorToken, requested.workflow_mode === "interactive" ? context.accessToken : undefined);
        return {
          allowed: true, document_id: id, upload_session_id: requested.upload_session_id,
          confirmed_subject_id: requested.actor_subject_id, registered_by_subject_id: requested.registered_by_subject_id,
          policy_binding_id: requested.policy_binding_id, policy_version: requested.policy_version,
          policy_hash: requested.policy_hash, source_governed_resource_id: requested.source_governed_resource_id,
          source_version: requested.source_version, reason_codes: [],
        };
      },
    },
    async getUserContext() { events.push("user"); return context; },
    async getBudgetService() { events.push("service"); return service; },
    async getBudgetActor() { events.push("actor"); return context; },
    async acceptContent(input) {
      contentPipelineCalls += 1;
      events.push("body");
      await input.request.arrayBuffer();
      return { uploaded: true } as DocumentIntakeAcceptedUpload;
    },
  };
  const execute = () => acceptAuthorizedDocumentIntakeContent({
    request, payload, sessionId: "session-one", uploadToken: "verified-by-route", settings,
  }, dependencies);
  return { dependencies, execute, events, bodyAccesses: () => bodyAccesses,
    contentPipelineCalls: () => contentPipelineCalls };
}

describe("Document Intake current authorization before binary read", () => {
  it("rejects a correctly hashed but unclassified document before reading upload bytes", async () => {
    const state = harness();
    const incomplete = { ...informationPolicy, tlp: null };
    state.dependencies.registry.getDocument = async () => ({
      ...document, policy_summary: incomplete, policy_hash: policyHash(incomplete),
    });
    await assert.rejects(state.execute(), { code: "DOCUMENT_TLP_REQUIRED" });
    assert.equal(state.bodyAccesses(), 0);
  });
  it("denies a document reader at preflight and at content before reading the body", async () => {
    const run = harness();
    const reader = { ...context, capabilities: ["akb:read_document"] };
    await assert.rejects(authorizeControlledDocumentUpload({ registry: run.dependencies.registry, context: reader, documentId: document.document_id }),
      (error: unknown) => error instanceof UploadPreflightError && error.code === "UPLOAD_NOT_AUTHORIZED");
    run.dependencies.getUserContext = async () => reader;
    await assert.rejects(run.execute(), { code: "UPLOAD_NOT_AUTHORIZED" });
    assert.equal(run.bodyAccesses(), 0);
    assert.equal(run.events.includes("document"), false);
  });

  it("keeps the official-source service confined to the Czech-law collection", async () => {
    const run = harness();
    const officialService = {
      ...context,
      authorizationSource: "service" as const,
      serviceClientId: "svc-akb-official-source-sync",
    };
    await assert.rejects(
      authorizeControlledDocumentUpload({
        registry: run.dependencies.registry,
        context: officialService,
        documentId: document.document_id,
      }),
      { code: "OFFICIAL_SOURCE_SERVICE_SCOPE_FORBIDDEN" },
    );
    await assert.rejects(
      authorizeControlledDocumentUpload({
        registry: run.dependencies.registry,
        context: { ...officialService, serviceClientId: "another-service" },
        documentId: document.document_id,
      }),
      { code: "UPLOAD_ACTOR_REQUIRED" },
    );
  });

  it("checks version-create authority before accepting a controlled upload", async () => {
    const run = harness();
    await run.execute();
    assert.deepEqual(run.events, ["user", "authorize:document.version.create", "document", "body"]);
    assert.equal(run.bodyAccesses(), 1);
  });

  it("rejects actor substitution even when the replacement can upload", async () => {
    const run = harness();
    run.dependencies.getUserContext = async () => ({ ...context, subjectId: "another-actor" });
    await assert.rejects(run.execute(), { code: "UPLOAD_ACTOR_MISMATCH" });
    assert.equal(run.events.length, 0);
    assert.equal(run.bodyAccesses(), 0);
  });

  it("rechecks authority after preflight and rejects revocation before body read", async () => {
    const run = harness();
    await authorizeControlledDocumentUpload({ registry: run.dependencies.registry, context, documentId: document.document_id });
    run.dependencies.registry.authorizeDocument = async () => ({ allowed: false, reason: "revoked", reason_codes: ["CAPABILITY_MISSING"], constraints: {} });
    await assert.rejects(run.execute(), { code: "UPLOAD_NOT_AUTHORIZED" });
    assert.equal(run.bodyAccesses(), 0);
  });

  it("rejects stale policy after preflight", async () => {
    const run = harness(token({ policy_hash: `sha256:${"b".repeat(64)}` }));
    await assert.rejects(run.execute(), { code: "UPLOAD_POLICY_BINDING_STALE" });
    assert.equal(run.bodyAccesses(), 0);
  });

  it("rejects missing or changed root provenance before binary intake", async () => {
    const cases = [
      { ...document, document_profile: null },
      { ...document, current_root_metadata_revision: null },
      { ...document, current_root_snapshot_hash: null },
      { ...document, current_root_metadata_revision: "new-root-revision" },
      { ...document, document_profile: { ...rootSnapshot, accountability: { ...rootSnapshot.accountability, ownerSubjectId: "changed-owner" } } },
    ];
    for (const changed of cases) {
      const run = harness();
      run.dependencies.registry.getDocument = async () => changed as Document;
      await assert.rejects(run.execute(), (error: unknown) => error instanceof UploadPreflightError
        && ["DOCUMENT_PROFILE_UNAVAILABLE", "UPLOAD_DOCUMENT_PROFILE_STALE"].includes(error.code));
      assert.equal(run.bodyAccesses(), 0);
      assert.equal(run.contentPipelineCalls(), 0);
    }
    const stale = harness(token({ document_profile: { ...contractVersionProfile(), expected_root_metadata_revision: "old-root-revision" } }));
    await assert.rejects(stale.execute(), { code: "UPLOAD_DOCUMENT_PROFILE_STALE" });
    assert.equal(stale.bodyAccesses(), 0);
  });

  it("passes the signed Budget version profile unchanged and stops before bytes on missing or stale authority", async () => {
    const missing = harness(token({ purpose: "stratos-budget-upload", document_profile: null }), true);
    await assert.rejects(missing.execute(), { code: "DOCUMENT_PROFILE_REQUIRED" });
    assert.equal(missing.bodyAccesses(), 0);
    assert.equal(missing.events.includes("budget-policy"), false);
    const stale = harness(token({ purpose: "stratos-budget-upload" }), true);
    stale.dependencies.registry.authorizeBudgetDocumentIntake = async (_id, input) => {
      assert.deepEqual(input.document_profile, contractVersionProfile());
      throw new ApiClientError("Root revision changed", 409, "DOCUMENT_PROFILE_STALE", "test");
    };
    await assert.rejects(stale.execute(), { code: "DOCUMENT_PROFILE_STALE" });
    assert.equal(stale.bodyAccesses(), 0);
    assert.equal(stale.contentPipelineCalls(), 0);
  });

  it("fails closed when the current document authorization is unavailable", async () => {
    const run = harness();
    run.dependencies.registry.authorizeDocument = async () => { throw new ApiClientError("Unavailable", 503, "POLICY_UNAVAILABLE", "test"); };
    await assert.rejects(run.execute(), { code: "POLICY_UNAVAILABLE" });
    assert.equal(run.bodyAccesses(), 0);
  });

  it("requires separate current Budget service and actor before the Registry decision", async () => {
    const run = harness(token({ purpose: "stratos-budget-upload" }), true);
    await run.execute();
    assert.deepEqual(run.events, ["service", "actor", "budget-policy", "body"]);
    assert.equal(run.bodyAccesses(), 1);
  });

  it("rejects a Budget token without the required interactive actor", async () => {
    const run = harness(token({ purpose: "stratos-budget-upload" }));
    await assert.rejects(run.execute(), { code: "STRATOS_BUDGET_ACTOR_AUTH_REQUIRED" });
    assert.equal(run.bodyAccesses(), 0);
    assert.equal(run.events.includes("budget-policy"), false);
  });

  it("rejects a Budget service that differs from the signed registering service", async () => {
    const run = harness(token({ purpose: "stratos-budget-upload", governance_registered_by_subject_id: "foreign-service" }), true);
    await assert.rejects(run.execute(), { code: "UPLOAD_SERVICE_MISMATCH" });
    assert.equal(run.bodyAccesses(), 0);
  });

  it("rejects Budget actor substitution and identical service/person credentials", async () => {
    for (const actor of [{ ...context, subjectId: "another-actor" }, { ...context, accessToken: service.accessToken }]) {
      const run = harness(token({ purpose: "stratos-budget-upload" }), true);
      run.dependencies.getBudgetActor = async () => actor;
      await assert.rejects(run.execute());
      assert.equal(run.bodyAccesses(), 0);
      assert.equal(run.events.includes("budget-policy"), false);
    }
  });

  it("never starts binary intake or scanning after Budget revocation, upstream replay conflict or outage", async () => {
    for (const status of ["deny", "outage", "upstream-replay-conflict", "conflict"] as const) {
      const run = harness(token({ purpose: "stratos-budget-upload" }), true);
      const authorize = run.dependencies.registry.authorizeBudgetDocumentIntake;
      run.dependencies.registry.authorizeBudgetDocumentIntake = async (...args) => {
        if (status === "outage") throw new ApiClientError("Unavailable", 503, "POLICY_UNAVAILABLE", "test");
        if (status === "upstream-replay-conflict") {
          // Registry currently maps the central root-replay HTTP 409 to 503.
          throw new ApiClientError("Current STRATOS authority is unavailable", 503,
            "stratos_budget_intake_governance_unavailable", "test");
        }
        const decision = await authorize(...args);
        return status === "deny" ? { ...decision, allowed: false } : { ...decision, policy_hash: "wrong" };
      };
      await assert.rejects(run.execute());
      assert.equal(run.bodyAccesses(), 0);
      assert.equal(run.contentPipelineCalls(), 0);
    }
  });

  it("permits a complete service-only batch only after current Registry authorization", async () => {
    const batch = token({ purpose: "stratos-budget-upload", workflow_mode: "historical_batch" });
    batch.workflow_context = { ...batch.workflow_context,
      batch_manifest_id: "batch-2026", batch_entries_sha256: `sha256:${"c".repeat(64)}`, release_revision: "d".repeat(40),
    };
    const run = harness(batch);
    await run.execute();
    assert.deepEqual(run.events, ["service", "budget-policy", "body"]);
    const withActor = harness(batch, true);
    await assert.rejects(withActor.execute(), { code: "STRATOS_BUDGET_UPLOAD_MODE_CONFLICT" });
    assert.equal(withActor.bodyAccesses(), 0);
    const partial = harness(token({ ...batch, workflow_context: { ...batch.workflow_context, batch_manifest_id: "" } }));
    await assert.rejects(partial.execute());
    assert.equal(partial.bodyAccesses(), 0);
  });

  it("rejects wrong sessions and internal collector purposes before any content read", async () => {
    for (const payload of [token({ session_id: "wrong" }), token({ purpose: "official-public-source-sync" })]) {
      const run = harness(payload);
      await assert.rejects(run.execute());
      assert.equal(run.bodyAccesses(), 0);
    }
  });
});

describe("Registry Budget intake transport", () => {
  it("keeps actor authority separate from service authentication and bypasses HTTP cache", async () => {
    const payload = token({ purpose: "stratos-budget-upload" });
    const run = harness(payload, true);
    let calls = 0;
    const client = new ProductionRegistryClient("https://registry.test/api/v1", async (url, init) => {
      calls += 1;
      assert.equal(String(url), "https://registry.test/api/v1/integrations/stratos-budget-upload/documents/doc_intake/intake-authorization");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), `Bearer ${service.accessToken}`);
      assert.equal(headers.get("x-stratos-actor-authorization"), `Bearer ${context.accessToken}`);
      assert.equal(init?.cache, "no-store");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.source_version, payload.source_version);
      assert.equal(JSON.stringify(body).includes(service.accessToken), false);
      assert.equal(JSON.stringify(body).includes(context.accessToken!), false);
      const response: BudgetIntakeAuthorizationResponse = {
        allowed: true, document_id: payload.document_id, upload_session_id: body.upload_session_id,
        confirmed_subject_id: body.actor_subject_id, registered_by_subject_id: body.registered_by_subject_id,
        policy_binding_id: body.policy_binding_id, policy_version: body.policy_version, policy_hash: body.policy_hash,
        source_governed_resource_id: body.source_governed_resource_id, source_version: body.source_version, reason_codes: [],
      };
      return Response.json(response);
    });
    run.dependencies.registry.authorizeBudgetDocumentIntake = client.authorizeBudgetDocumentIntake.bind(client);
    await run.execute();
    assert.equal(calls, 1);
  });
});

describe("Canonical Document Intake response contract", () => {
  it("validates an actual persisted intake response against the binding OpenAPI schema", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "akb-intake-contract-"));
    const previousMode = process.env.STRATOS_CONTENT_SECURITY_MODE;
    const previousRequired = process.env.STRATOS_CONTENT_SECURITY_REQUIRED;
    // This isolated fixture exercises the documented optional development mode.
    // Required scanning and clean verdicts have their own scanner protocol tests.
    process.env.STRATOS_CONTENT_SECURITY_MODE = "disabled";
    process.env.STRATOS_CONTENT_SECURITY_REQUIRED = "false";
    try {
      const uploadSettings = { ...settings, storageMode: "local" as const, objectStorageRoot: root };
      const content = new TextEncoder().encode("%PDF-1.7\ncontract fixture\n");
      const sha256 = `sha256:${createHash("sha256").update(content).digest("hex")}`;
      const preflight = createUploadPreflightDecision({
        document_id: "doc_contract_fixture", file_name: "fixture.pdf",
        file_size: content.byteLength, file_type: "application/pdf", sha256,
        document_profile: contractVersionProfile(),
        purpose: "controlled-document-upload",
      }, uploadSettings);
      const uploadToken = preflight.required_headers["X-AKL-Upload-Token"];
      const accepted = await acceptDocumentIntakeContent({
        request: new Request(`https://akb.test${preflight.upload_url}`, {
          method: "PUT", headers: preflight.required_headers, body: content,
        }),
        payload: verifyUploadToken(uploadToken, uploadSettings),
        uploadToken, sessionId: preflight.upload_session_id, settings: uploadSettings,
      });
      const contract = JSON.parse(await readFile(new URL("../../../openapi/openapi.json", import.meta.url), "utf8"));
      const schema = contract.paths["/api/document-intake/v1/sessions/{sessionId}/content"]
        .put.responses["201"].content["application/json"].schema;
      const ajv = new Ajv2020({ allErrors: true, strict: false });
      addFormats(ajv);
      const validate = ajv.compile(schema);
      assert.equal(validate(accepted), true, JSON.stringify(validate.errors));
      assert.equal(accepted.file.sha256, sha256);
      assert.equal(accepted.intake_status, "accepted_without_external_scan");
      assert.equal(validate({ ...accepted, file: { ...accepted.file, sha256: sha256.slice(7) } }), false);
      const incompleteSecurity: Partial<typeof accepted.content_security> = { ...accepted.content_security };
      delete incompleteSecurity.engine;
      assert.equal(validate({ ...accepted, content_security: incompleteSecurity }), false);
    } finally {
      if (previousMode === undefined) delete process.env.STRATOS_CONTENT_SECURITY_MODE;
      else process.env.STRATOS_CONTENT_SECURITY_MODE = previousMode;
      if (previousRequired === undefined) delete process.env.STRATOS_CONTENT_SECURITY_REQUIRED;
      else process.env.STRATOS_CONTENT_SECURITY_REQUIRED = previousRequired;
      await rm(root, { recursive: true, force: true });
    }
  });
});
