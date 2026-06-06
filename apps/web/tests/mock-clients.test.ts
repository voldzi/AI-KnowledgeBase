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
    const job = await clients.ingestion.createJob(
      {
        document_id: documents[0].document_id,
        document_version_id: createdVersion.document_version_id,
        source_file_uri: createdVersion.source_file_uri,
        parser_profile: "controlled_document",
        ocr_enabled: true,
        chunking_strategy: "legal_structured",
        embedding_profile: "default"
      },
      context
    );

    assert.ok(documents.length > 0);
    assert.equal(createdVersion.document_id, documents[0].document_id);
    assert.equal(job.status, "queued");
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

    assert.equal(clarification.response_type, "clarification_needed");
    assert.ok(clarification.questions.some((question) => question.id === "system"));
    assert.equal(answer.response_type, "answer");
    assert.ok(answer.citations.length > 0);
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
