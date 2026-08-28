import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { documentDeadlines, workflowToday, approvesDocument, managesDocument, urgentDeadline } from "../src/features/tasks/document-deadlines";
import { buildWorkflowTasks } from "../src/features/tasks/workflow-task-model";
import { ProductionRegistryClient } from "../src/lib/api/production/registry-client";
import { MockRegistryClient } from "../src/lib/api/mock/registry-client";
import { documentReviewError } from "../src/lib/documents/review-errors";
import { latestDocumentVersion, selectedDocumentVersion } from "../src/lib/documents/review-version";
import { mockVersions } from "../src/lib/api/mock/data";
import { workflowQuery } from "../src/features/tasks/workflow-query";
import { canReadTeamTasks } from "../src/lib/auth/authorization";
import { ApiClientError, type ApiRequestContext, type RegistryWorkflowTask, type WorkflowDocument } from "../src/lib/types";

const context: ApiRequestContext = { subjectId: "reviewer-fixture", authorizationSource: "mock", correlationId: "review-test" };
const document: WorkflowDocument = {
  document_id: "doc-test", title: "Manual", document_type: "manual", status: "valid",
  assignment_roles: ["gestor"], document_version_id: "version-2", version_label: "2", version_status: "draft",
  valid_from: "2026-08-01", valid_to: "2027-09-01", published_version_label: "1", published_valid_to: "2026-09-01",
  review_due_on: "2026-09-02", review_date_invalid: false, updated_at: "2026-08-27T10:00:00Z",
};
const task: RegistryWorkflowTask = {
  task_id: "review-task", source_key: null, kind: "review", priority: "medium", status: "open",
  title: "Document review required", description: "Review the exact submitted version before approval.",
  source: "Document review submission", owner_id: "reviewer-fixture", owner_label: "Reviewer", role: "approver",
  document_id: "doc-test", document_title: "Manual", document_version_id: "version-2", audit_event_id: null, job_id: null,
  due_at: "2026-09-01T10:00:00Z", resolved_at: null, created_at: "2026-08-27T10:00:00Z", updated_at: "2026-08-27T10:00:00Z",
  metadata: { version_label: "2", submission_comment: "Check the appendix" },
  assigned_to_me: true, allowed_actions: ["approve", "request_changes"],
};

describe("local approval workflow", () => {
  it("keeps server pagination order instead of sorting only the visible page", () => {
    const registryTasks = [task, { ...task, task_id: "higher-priority", priority: "critical" as const }];
    const rows = buildWorkflowTasks({ documents: [], jobs: [], auditEvents: [], registryTasks, preserveRegistryOrder: true });
    assert.deepEqual(rows.map((row) => row.id), ["review-task", "higher-priority"]);
  });
  it("keeps one returned task and closes it when the owner resubmits", async () => {
    const client = new MockRegistryClient();
    const owner = { ...context, subjectId: "user_209", roles: ["document_owner"] };
    const approver = { ...context, subjectId: "user_301", roles: ["reviewer"] };
    const first = await client.submitDocumentReview("doc_102", "ver_102_1", {}, owner);
    const queue = await client.listWorkflowTasks(approver, { assignedToMe: true, kind: "review" });
    assert.equal(queue.length, 1);
    assert.deepEqual(queue[0].allowed_actions, ["approve", "request_changes"]);
    await client.applyWorkflowTaskAction(first.task_id, { action: "request_changes", comment: "Check the appendix" }, approver);
    const returned = await client.listWorkflowTasks(owner, { assignedToMe: true, kind: "draft" });
    assert.equal(returned.length, 1);
    assert.equal(returned[0].metadata.last_comment, "Check the appendix");
    const second = await client.submitDocumentReview("doc_102", "ver_102_1", {}, owner);
    assert.notEqual(second.task_id, first.task_id);
    assert.equal((await client.listWorkflowTasks(owner, { assignedToMe: true, kind: "draft" })).length, 0);
    await client.applyWorkflowTaskAction(second.task_id, { action: "approve" }, approver);
    assert.equal((await client.listWorkflowTasks(approver, { assignedToMe: true, kind: "review" })).length, 0);
  });
});

describe("personal document deadlines", () => {
  it("uses the Prague calendar day, including midnight and daylight saving changes", () => {
    assert.equal(workflowToday("2026-08-27T22:30:00Z"), "2026-08-28");
    assert.equal(workflowToday("2026-01-27T23:30:00Z"), "2026-01-28");
    assert.equal(workflowToday("2026-10-25T00:30:00Z"), "2026-10-25");
  });
  it("keeps expiry of the published version visible while a replacement is in draft", () => {
    assert.deepEqual(documentDeadlines(document, "2026-08-27"), ["expires_soon", "review_soon"]);
    assert.deepEqual(documentDeadlines(document, "2026-09-02"), ["expired", "review_soon"]);
  });
  it("treats valid_to as inclusive and review expiry as a separate warning", () => {
    assert.deepEqual(documentDeadlines(document, "2026-09-01"), ["expires_soon", "review_soon"]);
    const onlyReview = { ...document, published_valid_to: null, review_due_on: "2026-08-01" };
    assert.deepEqual(documentDeadlines(onlyReview, "2026-08-27"), ["review_overdue"]);
    assert.equal(onlyReview.status, "valid");
  });
  it("handles open-ended validity, missing review dates, invalid dates and inactive documents", () => {
    const noDate = { ...document, published_valid_to: null, review_due_on: null };
    assert.deepEqual(documentDeadlines(noDate, "2026-08-27"), ["review_missing"]);
    assert.equal(urgentDeadline(["review_missing"]), false);
    assert.deepEqual(documentDeadlines({ ...noDate, review_date_invalid: true }, "2026-08-27"), ["review_invalid"]);
    assert.deepEqual(documentDeadlines({ ...document, status: "archived" }, "2026-08-27"), []);
    assert.equal(managesDocument(document), true);
    assert.equal(approvesDocument(document), false);
    assert.equal(approvesDocument({ ...document, assignment_roles: ["approver"] }), true);
  });
});

describe("version-bound review navigation", () => {
  it("opens the requested version instead of silently substituting the published version", () => {
    const versions = [
      { ...mockVersions[0], document_version_id: "published", status: "valid" as const, created_at: "2026-08-01T00:00:00Z" },
      { ...mockVersions[0], document_version_id: "draft", status: "review" as const, created_at: "2026-08-02T00:00:00Z" },
    ];
    assert.equal(selectedDocumentVersion(versions, "draft")?.document_version_id, "draft");
    assert.equal(selectedDocumentVersion(versions, "unknown"), undefined);
    assert.equal(selectedDocumentVersion(versions, null)?.document_version_id, "published");
    assert.equal(latestDocumentVersion(versions)?.document_version_id, "draft");
  });
  it("carries exact version, notes and server-authorized actions into the task detail", () => {
    const result = buildWorkflowTasks({ documents: [], jobs: [], auditEvents: [], registryTasks: [task], nowIso: "2026-08-27T10:00:00Z" })[0];
    assert.match(result.href, /version=version-2/);
    assert.match(result.href, /tab=viewer/);
    assert.equal(result.version_label, "2");
    assert.equal(result.submission_comment, "Check the appendix");
    assert.deepEqual(result.allowed_actions, ["approve", "request_changes"]);
  });
  it("renders safe localized review errors, not arbitrary upstream messages", () => {
    assert.match(documentReviewError("review_source_changed", 409, "cs"), /znovu předat/);
    assert.match(documentReviewError("review_self_approval_forbidden", 403, "cs"), /jiný/);
    assert.doesNotMatch(documentReviewError("UNTRUSTED_TECHNICAL_ERROR", 500, "cs"), /UNTRUSTED/);
  });
});

describe("personal workspace API pagination", () => {
  it("loads only the requested task page with server-side filters", async () => {
    const calls: URL[] = [];
    const client = new ProductionRegistryClient("http://registry.test/api/v1", async (input) => {
      calls.push(new URL(String(input)));
      return Response.json({ total: 57, limit: 25, offset: 50, items: Array.from({ length: 7 }, (_, index) => ({ ...task, task_id: `task-${50 + index}` })) });
    });
    const page = await client.listWorkflowTaskPage(context, { assignedToMe: true, kind: "review", query: "manual", limit: 25, offset: 50 });
    assert.equal(page.total, 57);
    assert.equal(page.items.length, 7);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].searchParams.get("assigned_to_me"), "true");
    assert.equal(calls[0].searchParams.get("kind"), "review");
    assert.equal(calls[0].searchParams.get("q"), "manual");
    assert.equal(calls[0].searchParams.get("offset"), "50");
  });
  it("sends document filters to the server instead of filtering an incomplete page", async () => {
    const client = new ProductionRegistryClient("http://registry.test/api/v1", async (input) => {
      const params = new URL(String(input)).searchParams;
      assert.deepEqual(Object.fromEntries(params), { q: "manual", assignment: "managed", version_status: "draft", deadline: "review", limit: "25", offset: "0" });
      return Response.json({ items: [document], total: 1, limit: 25, offset: 0 });
    });
    const page = await client.listWorkflowDocumentPage(context, { query: "manual", assignment: "managed", versionStatus: "draft", deadline: "review" });
    assert.deepEqual(page.items, [document]);
  });
  for (const result of [
    { items: [], total: 1, limit: 25, offset: 0 },
    { items: [task, task], total: 2, limit: 25, offset: 0 },
    { items: [task], total: 1, limit: 25, offset: 25 },
    { items: [task], limit: 25, offset: 0 },
    { items: [null], total: 1, limit: 25, offset: 0 },
  ]) {
    it(`rejects malformed single-page metadata ${JSON.stringify(result).length}`, async () => {
      const client = new ProductionRegistryClient("http://registry.test/api/v1", async () => Response.json(result));
      await assert.rejects(() => client.listWorkflowTaskPage(context), (error: unknown) => error instanceof ApiClientError && error.code === "WORKFLOW_INCOMPLETE");
    });
  }
  it("loads the entire authorized personal queue and preserves the personal filter", async () => {
    const calls: URL[] = [];
    const client = new ProductionRegistryClient("http://registry.test/api/v1", async (input) => {
      const url = new URL(String(input));
      calls.push(url);
      const offset = Number(url.searchParams.get("offset"));
      return Response.json({ total: 105, items: Array.from({ length: offset === 0 ? 100 : 5 }, (_, index) => ({ ...task, task_id: `task-${offset + index}` })) });
    });
    assert.equal((await client.listWorkflowTasks(context, { assignedToMe: true })).length, 105);
    assert.deepEqual(calls.map((url) => url.searchParams.get("offset")), ["0", "100"]);
    assert.ok(calls.every((url) => url.searchParams.get("assigned_to_me") === "true"));
  });
  for (const mode of ["short-page", "duplicate", "changed-total", "missing-total"] as const) {
    it(`rejects an incomplete or changing queue: ${mode}`, async () => {
      let page = 0;
      const client = new ProductionRegistryClient("http://registry.test/api/v1", async () => {
        const offset = page++ * 100;
        const total = mode === "missing-total" ? undefined : offset && mode === "changed-total" ? 106 : 105;
        const count = offset ? 5 : mode === "short-page" ? 1 : 100;
        return Response.json({ total, items: Array.from({ length: count }, (_, index) => ({ ...document, document_id: `doc-${mode === "duplicate" && offset ? index : offset + index}` })) });
      });
      await assert.rejects(() => client.listWorkflowDocuments(context), (error: unknown) => error instanceof ApiClientError && error.code === "WORKFLOW_INCOMPLETE");
    });
  }
  it("submits only the exact document/version and a comment", async () => {
    let requestUrl = "";
    let requestBody = "";
    const client = new ProductionRegistryClient("http://registry.test/api/v1", async (input, init) => {
      requestUrl = String(input);
      requestBody = String(init?.body);
      assert.equal(init?.method, "POST");
      assert.equal(init?.cache, "no-store");
      return Response.json(task);
    });
    await client.submitDocumentReview("doc-test", "version-2", { comment: "Ready" }, context);
    assert.equal(new URL(requestUrl).pathname, "/api/v1/documents/doc-test/versions/version-2/submit-review");
    assert.deepEqual(JSON.parse(requestBody), { comment: "Ready" });
  });
});

describe("personal workspace query and visibility", () => {
  it("does not let a read-only user opt into team tasks", () => {
    const employee = { ...context, roles: ["stratos_user"], capabilities: ["akb:read_document"] };
    assert.equal(canReadTeamTasks(employee), false);
    const result = workflowQuery({ view: "team", assigned_to_me: "false", page: "3" }, canReadTeamTasks(employee));
    assert.equal(result.view, "mine");
    assert.equal(result.tasks.assignedToMe, true);
    assert.equal(result.tasks.limit, 25);
    assert.equal(result.tasks.offset, 50);
    assert.equal(canReadTeamTasks({ ...employee, capabilities: ["akb:manage_document"] }), true);
    assert.equal(canReadTeamTasks({ ...employee, capabilities: ["akb:manage_document"], applicationAccessActive: false }), false);
  });
  it("keeps approval and document filters distinct and validates input", () => {
    const result = workflowQuery({ view: "approvals", kind: "audit", q: "a".repeat(300), page: "-5", deadline: "unexpected", assignment: "approver" }, false);
    assert.equal(result.tasks.kind, "review");
    assert.equal(result.tasks.query?.length, 200);
    assert.equal(result.page, 1);
    assert.equal(result.documents.deadline, undefined);
    assert.equal(result.documents.assignment, "approver");
    assert.equal(workflowQuery({ view: ["team"], page: "Infinity" }, true).view, "mine");
  });
  it("the mock personal queue cannot expose somebody else's tasks", async () => {
    const client = new MockRegistryClient();
    const employee = { ...context, subjectId: "unassigned-person", roles: ["stratos_user"], capabilities: ["akb:read_document"] };
    const page = await client.listWorkflowTaskPage(employee, { assignedToMe: false });
    assert.equal(page.total, 0);
    assert.deepEqual(page.items, []);
  });
});
