import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createApiClients } from "../src/lib/api";
import { createMockContext } from "../src/lib/api/correlation";
import { ApiClientError } from "../src/lib/types";

const env = {
  AKL_ENV: "test",
  AKL_API_CLIENT_MODE: "mock",
  AKL_AUTH_MODE: "mock"
};

describe("mock API clients", () => {
  it("supports the main document and ingestion flow without network calls", async () => {
    const clients = createApiClients({ env });
    const context = createMockContext();

    const documents = await clients.registry.listDocuments(context);
    const summary = await clients.registry.getDocumentMetadataSummary(context, {
      topics: ["řízená dokumentace"]
    });
    const createdVersion = await clients.registry.createDocumentVersion(
      documents[0].document_id,
      {
        version_label: "2.1",
        valid_from: "2026-07-01",
        valid_to: null,
        source_file_uri: "s3://akl-documents/doc_101/ver_101_3/file.pdf",
        change_summary: "Mock test version."
      },
      context
    );
    const idempotencyKey = `test:${createdVersion.document_version_id}`;
    const ingestionAuthorization = await clients.registry.createIngestionAuthorization(
      documents[0].document_id,
      createdVersion.document_version_id,
      {
        action: "document.ingest",
        correlation_id: context.correlationId ?? context.requestId ?? "mock-correlation",
        idempotency_key: idempotencyKey,
      },
      context,
    );
    const job = await clients.ingestion.createJob(
      {
        idempotency_key: idempotencyKey,
        document_id: documents[0].document_id,
        document_version_id: createdVersion.document_version_id,
        source_file_uri: createdVersion.source_file_uri,
        parser_profile: "controlled_document",
        ocr_enabled: true,
        chunking_strategy: "legal_structured",
        embedding_profile: "default"
      },
      context,
      {
        delegatedActorSubjectId: ingestionAuthorization.confirmed_subject_id,
        authorizationToken: ingestionAuthorization.authorization_token,
      },
    );

    assert.ok(documents.length > 0);
    assert.equal(summary.warnings[0], "REGISTRY_METADATA_SUMMARY");
    assert.ok(summary.topics[0].document_count >= 1);
    assert.equal(createdVersion.document_id, documents[0].document_id);
    assert.equal(job.status, "queued");
  });

  it("returns document readiness reports in mock mode", async () => {
    const clients = createApiClients({ env });
    const context = createMockContext();

    const report = await clients.registry.getDocumentReadinessReport(context, {
      maxIssues: 3
    });

    assert.ok(report.total_visible_documents > 0);
    assert.ok(report.readiness_score >= 0);
    assert.ok(report.readiness_score <= 1);
    assert.ok(report.issue_counts.length > 0);
    assert.ok(report.issues.length <= 3);
    assert.equal(report.warnings[0], "REGISTRY_DOCUMENT_READINESS_REPORT");
  });

  it("derives admin authorization hints from the effective mock role", async () => {
    const clients = createApiClients({ env });
    const context = createMockContext();

    const readerHints = await clients.registry.getAuthorizationHints({ ...context, roles: ["reader"] });
    const adminHints = await clients.registry.getAuthorizationHints({ ...context, roles: ["admin"] });

    assert.equal(readerHints.can_manage_admin, false);
    assert.equal(adminHints.can_manage_admin, true);
    assert.equal(adminHints.can_publish, true);
  });

  it("keeps admin role mappings stateful in mock mode", async () => {
    const clients = createApiClients({ env });
    const context = { ...createMockContext(), roles: ["admin"] };

    const created = await clients.registry.upsertRoleMapping(
      { subject_type: "user", subject_id: "mock-user-1", role: "analyst", status: "active" },
      context,
    );
    const active = await clients.registry.listRoleMappings(context);
    const removed = await clients.registry.updateRoleMappingStatus(created.role_mapping_id, "removed", context);

    assert.equal(created.display_name, "Jan Novák");
    assert.equal(active.length, 1);
    assert.equal(removed.subject_id, "mock-user-1");
    assert.equal((await clients.registry.listRoleMappings(context)).length, 0);
    assert.equal((await clients.registry.listRoleMappings(context, true)).length, 1);
  });

  it("returns ingestion entity facets in mock mode", async () => {
    const clients = createApiClients({ env });
    const context = createMockContext();

    const report = await clients.ingestion.getEntityFacets(context, mockIntelligenceScope());

    assert.equal(report.status, "ready");
    assert.ok(report.chunks_with_entities > 0);
    assert.equal(report.entity_types[0]?.key, "document_number");
    assert.equal(report.entity_groups[0]?.values[0]?.key, "RMO12/2024");
  });

  it("runs analyst search in mock mode", async () => {
    const clients = createApiClients({ env });
    const context = createMockContext();

    const report = await clients.ingestion.analystSearch(
      {
        query: "title:RMO AND entity:RMO12/2024",
        query_mode: "fielded",
        search_fields: ["title", "entity"],
        allowed_document_ids: ["doc_109"],
        limit: 3
      },
      context,
      mockIntelligenceScope(),
    );

    assert.equal(report.status, "ready");
    assert.equal(report.query_mode, "fielded");
    assert.equal(report.returned_hits, 1);
    assert.equal(report.hits[0]?.document_id, "doc_109");
  });

  it("keeps analyst cases stateful in mock mode", async () => {
    const clients = createApiClients({ env });
    const context = createMockContext({ subjectId: "analyst_1", roles: ["reader"] });

    const analystCase = await clients.registry.createAnalystCase(
      {
        title: "RMO evidence",
        tags: ["rmo", "ai", "rmo"],
        metadata: { source: "test" }
      },
      context
    );
    const savedQuery = await clients.registry.createAnalystSavedQuery(
      analystCase.case_id,
      {
        title: "RMO fielded",
        query_text: "title:RMO AND entity:RMO12/2024",
        query_mode: "fielded",
        search_fields: ["title", "entity"],
        filters: { classification: "internal" }
      },
      context
    );
    const evidence = await clients.registry.createAnalystEvidence(
      analystCase.case_id,
      {
        title: "RMO chunk",
        document_id: "doc_109",
        document_version_id: "ver_109_1",
        document_title: "Směrnice RMO 12/2024 pro řízení AI",
        chunk_id: "chunk_mock_rmo_1",
        page_number: 3,
        snippet: "RMO 12/2024",
        entity_types: ["document_number"],
        entity_values: ["RMO12/2024"]
      },
      context
    );

    const cases = await clients.registry.listAnalystCases(context);
    const detail = await clients.registry.getAnalystCase(analystCase.case_id, context);

    assert.equal(cases.length, 1);
    assert.equal(savedQuery.query_mode, "fielded");
    assert.equal(evidence.chunk_id, "chunk_mock_rmo_1");
    assert.equal(detail.saved_queries.length, 1);
    assert.equal(detail.evidence_items.length, 1);
  });

  it("keeps profile settings stateful in mock mode", async () => {
    const clients = createApiClients({ env });
    const context = createMockContext({ subjectId: "user_settings", roles: ["reader"], groups: ["staff"] });

    const initial = await clients.registry.getProfileSettings(context);
    assert.deepEqual(initial.settings, { core: {}, apps: { akb: {} } });

    await clients.registry.putProfileSettings(
      {
        settings: {
          core: { language: "en", theme: "dark" },
          apps: { akb: { settingsMode: "sidebar" } }
        }
      },
      context
    );

    const fetched = await clients.registry.getProfileSettings(context);
    assert.equal(fetched.settings.core.language, "en");
    assert.equal(fetched.settings.apps.akb.settingsMode, "sidebar");
    assert.deepEqual(fetched.roles, ["reader"]);
    assert.deepEqual(fetched.groups, ["staff"]);
  });

  it("filters metadata summaries by STRATOS context in mock mode", async () => {
    const clients = createApiClients({ env });
    const context = createMockContext();

    await clients.registry.createDocument(
      {
        title: "Smlouva Budget Contract 1",
        document_type: "contract",
        owner_id: "budget_owner",
        gestor_unit: "Budget",
        classification: "internal",
        tags: ["budget-contract:contract-1"],
        metadata: {
          stratos: {
            tenant_id: "tenant-a",
            external_system: "STRATOS_BUDGET",
            external_ref: "contract:1",
            entity_type: "contract",
            entity_id: "contract-1"
          }
        }
      },
      context
    );

    const summary = await clients.registry.getDocumentMetadataSummary(context, {
      topics: ["smlouva"],
      tenantId: "tenant-a",
      externalSystem: "STRATOS_BUDGET",
      entityType: "contract",
      entityId: "contract-1",
      externalRef: "contract:1",
      contextTags: ["budget-contract:contract-1"]
    });

    assert.equal(summary.total_visible_documents, 1);
    assert.equal(summary.total_matched_documents, 1);
    assert.equal(summary.topics[0]?.document_count, 1);
    assert.equal(summary.by_document_type[0]?.key, "contract");
  });

  it("filters document lists by STRATOS context in mock mode", async () => {
    const clients = createApiClients({ env });
    const context = createMockContext();

    await clients.registry.createDocument(
      {
        title: "Smlouva Budget Contract 2",
        document_type: "contract",
        owner_id: "budget_owner",
        gestor_unit: "Budget",
        classification: "internal",
        tags: ["budget-contract:contract-2"],
        metadata: {
          external: {
            tenant_id: "tenant-a",
            external_system: "STRATOS_BUDGET",
            external_ref: "contract:2",
            entity_type: "contract",
            entity_id: "contract-2"
          }
        }
      },
      context
    );

    const documents = await clients.registry.listDocuments(context, {
      topics: ["smlouva"],
      tenantId: "tenant-a",
      externalSystem: "STRATOS_BUDGET",
      entityType: "contract",
      entityId: "contract-2",
      contextTags: ["budget-contract:contract-2"]
    });

    assert.equal(documents.length, 1);
    assert.equal(documents[0]?.document_type, "contract");
    assert.equal(documents[0]?.title, "Smlouva Budget Contract 2");
  });

  it("returns citation-backed RAG answers and no-answer states", async () => {
    const clients = createApiClients({ env });
    const context = createMockContext();

    const answer = await clients.rag.query(
      {
        subject_id: context.subjectId,
        query: "Jak se schvaluje vyjimka?",
        filters: {
          document_types: ["directive"],
          only_valid: true,
          classification_max: "internal",
          tags: []
        },
        answer_mode: "normative_with_citations",
        max_chunks: 4
      },
      context
    );

    const noAnswer = await clients.rag.query(
      {
        subject_id: context.subjectId,
        query: "Neznamy specialni postup",
        filters: {
          document_types: ["directive"],
          only_valid: true,
          classification_max: "internal",
          tags: []
        },
        answer_mode: "normative_with_citations",
        max_chunks: 4
      },
      context
    );

    assert.ok(answer.citations.length > 0);
    assert.equal(noAnswer.confidence, "insufficient_source");
    assert.equal(noAnswer.citations.length, 0);
  });

  it("supports employee assistant clarification and sourced answers", async () => {
    const clients = createApiClients({ env });
    const context = createMockContext();

    const clarification = await clients.rag.assistantChat(
      {
        user_id: context.subjectId,
        message: "Potřebuji přístup.",
        context: {}
      },
      context
    );
    const answer = await clients.rag.assistantClarify(
      {
        user_id: context.subjectId,
        conversation_id: clarification.conversation_id,
        message: "Kdo schvaluje výjimku ze směrnice?",
        context: { system: "AKL", request_type: "nový přístup" }
      },
      context
    );
    const suggestions = await clients.rag.assistantSuggestions(context);
    const reportAnswer = await clients.rag.assistantChat(
      {
        user_id: context.subjectId,
        message: "Vytvoř tabulkovou sestavu do Excelu k výjimce ze směrnice.",
        context: { approval_subject: "výjimka ze směrnice" }
      },
      context
    );

    assert.equal(clarification.response_type, "clarification_needed");
    assert.ok(clarification.questions.some((question) => question.id === "system"));
    assert.equal(answer.response_type, "answer");
    assert.ok(answer.citations.length > 0);
    assert.deepEqual(reportAnswer.report_artifacts[0]?.export_formats, ["xlsx", "pdf"]);
    assert.ok(suggestions.suggestions.length > 0);
  });

  it("keeps workflow task actions stateful in mock mode", async () => {
    const clients = createApiClients({ env });
    const context = createMockContext({ subjectId: "admin_1" });
    const tasks = await clients.registry.listWorkflowTasks(context);
    const task = tasks[0];

    assert.ok(task);

    const resolved = await clients.registry.applyWorkflowTaskAction(
      task.task_id,
      {
        action: "resolve",
        comment: "Checked in mock test.",
        metadata: { source: "mock-test" }
      },
      context
    );
    const activeTasks = await clients.registry.listWorkflowTasks(context);
    const historyTasks = await clients.registry.listWorkflowTasks(context, { includeResolved: true });
    const historicalTask = historyTasks.find((candidate) => candidate.task_id === task.task_id);

    assert.equal(resolved.status, "resolved");
    assert.equal(activeTasks.some((candidate) => candidate.task_id === task.task_id), false);
    assert.ok(historicalTask);
    assert.equal(historicalTask.metadata.last_action, "resolve");
  });

  it("keeps document assignments stateful in mock mode", async () => {
    const clients = createApiClients({ env });
    const context = createMockContext({ subjectId: "admin_1" });

    const initialAssignments = await clients.registry.listDocumentAssignments("doc_102", context);
    const assignments = await clients.registry.replaceDocumentAssignments(
      "doc_102",
      {
        assignments: [
          {
            role: "owner",
            subject_type: "user",
            subject_id: "user_777",
            display_label: "New owner",
            is_primary: true,
            active: true,
            sla_days: 5,
            escalation_subject_type: "unit",
            escalation_subject_id: "Security",
            escalation_label: "Security management"
          },
          {
            role: "reviewer",
            subject_type: "group",
            subject_id: "review-board",
            display_label: "Review board",
            is_primary: true,
            active: true,
            sla_days: 2
          }
        ]
      },
      context
    );
    const document = await clients.registry.getDocument("doc_102", context);
    const tasks = await clients.registry.listWorkflowTasks(context, { kind: "review" });
    const reviewTask = tasks.find((task) => task.document_id === "doc_102");

    assert.ok(initialAssignments.length > 0);
    assert.equal(assignments.length, 2);
    assert.equal(document.owner_id, "user_777");
    assert.equal(reviewTask?.owner_id, "review-board");
    assert.equal(reviewTask?.metadata.assignment_role, "reviewer");
  });

  it("filters audit events in mock mode", async () => {
    const clients = createApiClients({ env });
    const context = createMockContext({ subjectId: "auditor_1" });
    const documentEvents = await clients.registry.listAuditEvents(context, {
      resourceType: "document",
      resourceId: "doc_102"
    });
    const workflowEvents = await clients.registry.listAuditEvents(context, {
      eventType: "workflow.task.approve"
    });

    assert.equal(documentEvents.length, 1);
    assert.equal(documentEvents[0].event_type, "document.assignments.updated");
    assert.equal(workflowEvents[0].resource_id, "task_review_doc_102");
  });

  it("runs governance checks in mock mode", async () => {
    const clients = createApiClients({ env });
    const context = createMockContext({ subjectId: "auditor_1" });
    const document = await clients.registry.getDocument("doc_101", context);
    const versions = await clients.registry.listDocumentVersions("doc_101", context);
    const [rightVersion, leftVersion] = versions;

    assert.ok(leftVersion);
    assert.ok(rightVersion);

    const result = await clients.governance.compareVersions(
      {
        subject_id: context.subjectId,
        left_version: {
          document_id: document.document_id,
          document_version_id: leftVersion.document_version_id,
          document_title: document.title,
          version_label: leftVersion.version_label,
          status: "valid",
          classification: document.classification,
          valid_from: leftVersion.valid_from,
          valid_to: leftVersion.valid_to,
          source_uri: leftVersion.source_file_uri,
          content: leftVersion.change_summary ?? "left",
          citations: []
        },
        right_version: {
          document_id: document.document_id,
          document_version_id: rightVersion.document_version_id,
          document_title: document.title,
          version_label: rightVersion.version_label,
          status: "review",
          classification: document.classification,
          valid_from: rightVersion.valid_from,
          valid_to: rightVersion.valid_to,
          source_uri: rightVersion.source_file_uri,
          content: rightVersion.change_summary ?? "right",
          citations: []
        }
      },
      context
    );

    assert.equal(result.result_id, "governance_compare_mock");
    assert.ok(result.citations.length > 0);
    assert.ok(result.warnings.includes("WEB_BRIDGE_METADATA_CONTENT_ONLY"));
  });

  it("enforces the publish gate in mock mode", async () => {
    const clients = createApiClients({ env });
    const context = createMockContext({ subjectId: "admin_1" });

    await assert.rejects(
      clients.registry.publishDocumentVersion("doc_103", "ver_103_1", context),
      (error) => error instanceof ApiClientError && error.code === "PUBLISH_REQUIRES_APPROVAL"
    );

    const tasks = await clients.registry.listWorkflowTasks(context, { kind: "review" });
    const reviewTask = tasks.find((task) => task.document_id === "doc_102");
    assert.ok(reviewTask);

    await clients.registry.applyWorkflowTaskAction(reviewTask.task_id, { action: "approve" }, context);
    const approvedDocument = await clients.registry.getDocument("doc_102", context);

    assert.equal(approvedDocument.status, "approved");
  });
});

function mockIntelligenceScope() {
  return {
    authorizationToken: "mock-intelligence-authorization-token-long-enough",
    idempotencyKey: "intelligence:mock-test",
    correlationId: "mock-intelligence-correlation",
    authorizedDocuments: [
      {
        document_id: "doc_109",
        document_version_id: "ver_109_1",
        policy_hash: `sha256:${"0".repeat(64)}`,
      },
    ],
  };
}
