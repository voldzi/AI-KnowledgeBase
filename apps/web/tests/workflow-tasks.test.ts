import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mockAuditEvents, mockDocuments, mockIngestionJobs } from "../src/lib/api/mock/data";
import { buildWorkflowTasks, isTaskOverdue } from "../src/features/tasks/workflow-task-model";

describe("workflow task read model", () => {
  it("derives blocking ingestion, governance and review work from current platform state", () => {
    const nowIso = "2026-06-06T09:00:00.000Z";
    const tasks = buildWorkflowTasks({
      documents: mockDocuments,
      jobs: mockIngestionJobs,
      auditEvents: mockAuditEvents,
      nowIso
    });

    assert.ok(tasks.some((task) => task.id === "ingestion-failed:ing_299"));
    assert.ok(tasks.some((task) => task.id === "governance:doc_102"));
    assert.ok(tasks.some((task) => task.id === "review:doc_102"));
    assert.equal(tasks.find((task) => task.id === "review:doc_102")?.registry_task_id, null);
    assert.equal(tasks[0].priority, "critical");
    assert.equal(tasks[0].status, "blocked");
  });

  it("marks non-waiting tasks as overdue when their due date passed", () => {
    const tasks = buildWorkflowTasks({
      documents: mockDocuments,
      jobs: mockIngestionJobs,
      auditEvents: mockAuditEvents,
      nowIso: "2026-06-07T09:00:00.000Z"
    });
    const failedIngestionTask = tasks.find((task) => task.id === "ingestion-failed:ing_299");
    const activeIngestionTask = tasks.find((task) => task.id === "ingestion-active:ing_301");

    assert.ok(failedIngestionTask);
    assert.equal(isTaskOverdue(failedIngestionTask, "2026-06-07T09:00:00.000Z"), true);
    assert.ok(activeIngestionTask);
    assert.equal(activeIngestionTask.status, "waiting");
    assert.equal(isTaskOverdue(activeIngestionTask, "2026-06-07T09:00:00.000Z"), false);
  });

  it("prefers registry workflow tasks while keeping ingestion operations work", () => {
    const tasks = buildWorkflowTasks({
      documents: mockDocuments,
      jobs: mockIngestionJobs,
      auditEvents: mockAuditEvents,
      registryTasks: [
        {
          task_id: "task_registry_review",
          source_key: "document-review:doc_102",
          kind: "review",
          priority: "high",
          status: "open",
          title: "Registry review",
          description: "Authoritative Registry task.",
          source: "Registry API",
          owner_id: "user_209",
          owner_label: "Security",
          role: "Owner / gestor",
          document_id: "doc_102",
          document_title: "Metodika vyjimek z bezpecnostnich pravidel",
          document_version_id: null,
          audit_event_id: null,
          job_id: null,
          due_at: "2026-06-06T09:00:00.000Z",
          resolved_at: null,
          metadata: {},
          created_at: "2026-06-05T09:00:00.000Z",
          updated_at: "2026-06-05T09:00:00.000Z"
        }
      ],
      nowIso: "2026-06-06T09:00:00.000Z"
    });

    assert.ok(tasks.some((task) => task.id === "task_registry_review"));
    assert.equal(tasks.find((task) => task.id === "task_registry_review")?.registry_task_id, "task_registry_review");
    assert.ok(tasks.some((task) => task.id === "ingestion-failed:ing_299"));
    assert.equal(tasks.some((task) => task.id === "review:doc_102"), false);
  });
});
