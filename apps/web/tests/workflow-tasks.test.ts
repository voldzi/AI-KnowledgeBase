import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mockAuditEvents, mockDocuments, mockIngestionJobs } from "../src/lib/api/mock/data";
import { buildWorkflowTasks, isTaskOverdue } from "../src/features/tasks/workflow-task-model";
import { workflowTaskPresentation } from "../src/features/tasks/workflow-task-presentation";

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

describe("workflow task presentation", () => {
  it("translates generated workflow text for Czech users", () => {
    const task = buildWorkflowTasks({
      documents: mockDocuments,
      jobs: mockIngestionJobs,
      auditEvents: mockAuditEvents,
      nowIso: "2026-06-06T09:00:00.000Z",
    }).find((candidate) => candidate.kind === "draft");

    assert.ok(task);
    const presentation = workflowTaskPresentation(task, "cs");
    assert.equal(presentation.title, "Koncept je potřeba dokončit");
    assert.equal(presentation.actionLabel, "Dokončit koncept");
    assert.equal(presentation.role, "Správce dokumentu");
  });

  it("replaces a technical owner with the responsibility label in the main UI", () => {
    const presentation = workflowTaskPresentation({
      id: "task-1",
      registry_task_id: "task-1",
      kind: "review",
      priority: "medium",
      status: "open",
      title: "DOCUMENT_REVIEW_REQUIRED",
      description: "DOCUMENT_REVIEW_REQUIRED",
      source: "registry.document.review",
      owner: "3c8420a7-00aa-4c1d-9879-123456789abc",
      role: "Owner / gestor",
      document_id: "doc-1",
      document_title: "Směrnice",
      document_version_id: "version-1",
      job_id: null,
      due_at: "2026-08-03T08:00:00.000Z",
      created_at: "2026-08-01T08:00:00.000Z",
      href: "/documents/doc-1",
      secondary_href: null,
      action_label: "Open document workbench",
    }, "cs");

    assert.equal(presentation.title, "Dokument čeká na kontrolu");
    assert.equal(presentation.owner, "Vlastník nebo gestor");
    assert.equal(presentation.technicalOwner, "3c8420a7-00aa-4c1d-9879-123456789abc");
    assert.equal(presentation.source, "Workflow dokumentu");
  });

  it("localizes known organizational assignee labels", () => {
    const presentation = workflowTaskPresentation({
      id: "task-2",
      registry_task_id: "task-2",
      kind: "review",
      priority: "medium",
      status: "open",
      title: "Document review required",
      description: "Review metadata, source context, access classification and publication readiness.",
      source: "Registry document status",
      owner: "Security reviewers",
      role: "Governance / auditor",
      document_id: "doc-2",
      document_title: "Bezpečnostní směrnice",
      document_version_id: null,
      job_id: null,
      due_at: "2026-08-03T08:00:00.000Z",
      created_at: "2026-08-01T08:00:00.000Z",
      href: "/documents/doc-2",
      secondary_href: null,
      action_label: "Open document workbench",
    }, "cs");

    assert.equal(presentation.owner, "Bezpečnostní hodnotitelé");
    assert.equal(presentation.role, "Gestor pravidel nebo auditor");
    assert.equal(presentation.technicalOwner, null);
  });
});
