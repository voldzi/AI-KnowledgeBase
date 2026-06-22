import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createApiClients } from "../src/lib/api";
import { createMockContext } from "../src/lib/api/correlation";
import type { AklFetch } from "../src/lib/api/http-client";

const env = {
  AKL_ENV: "test",
  AKL_API_CLIENT_MODE: "production",
  AKL_AUTH_MODE: "oidc",
  AKL_REGISTRY_API_BASE_URL: "https://registry.local/api/v1/",
  AKL_INGESTION_API_BASE_URL: "https://ingestion.local/api/v1/",
  AKL_RAG_API_BASE_URL: "https://rag.local/api/v1/",
  AKL_GOVERNANCE_API_BASE_URL: "https://governance.local/api/v1/",
  AKL_WEB_OIDC_ISSUER: "https://login.local/realms/stratos",
  AKL_WEB_PUBLIC_BASE_URL: "https://akl.local",
  AKL_WEB_SESSION_SECRET: "test-session-secret"
};

function documentFixture(documentId: string) {
  return {
    document_id: documentId,
    title: `Document ${documentId}`,
    document_type: "directive",
    status: "valid",
    classification: "internal",
    owner_id: "user_1",
    owner: "user_1",
    gestor_unit: "IT",
    tags: [],
    created_at: "2026-06-05T10:00:00Z",
    updated_at: "2026-06-05T10:00:00Z"
  };
}

describe("production API clients", () => {
  it("uses service base URLs and required request headers", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher: AklFetch = async (input, init) => {
      calls.push([input, init]);
      return Response.json({
        items: [documentFixture("doc_1")],
        limit: 200,
        offset: 0
      });
    };

    const clients = createApiClients({ env, fetcher });
    const context = createMockContext({
      subjectId: "user_1",
      accessToken: "test-token",
      requestId: "req_test",
      correlationId: "corr_test"
    });

    await clients.registry.listDocuments(context);

    assert.equal(calls.length, 1);
    const [url, init] = calls[0];
    const headers = init?.headers as Headers;

    assert.equal(url, "https://registry.local/api/v1/documents?limit=200&offset=0");
    assert.equal(headers.get("Authorization"), "Bearer test-token");
    assert.equal(headers.get("X-Request-ID"), "req_test");
    assert.equal(headers.get("X-Correlation-ID"), "corr_test");
    assert.equal(init?.cache, "no-store");
  });

  it("loads additional document pages when the first page is full", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher: AklFetch = async (input, init) => {
      calls.push([input, init]);
      const url = new URL(String(input));
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const count = offset === 0 ? 200 : 22;
      return Response.json({
        items: Array.from({ length: count }, (_, index) => documentFixture(`doc_${offset + index + 1}`)),
        limit: 200,
        offset
      });
    };

    const clients = createApiClients({ env, fetcher });
    const documents = await clients.registry.listDocuments(createMockContext());

    assert.equal(documents.length, 222);
    assert.equal(calls.length, 2);
    assert.equal(calls[0][0], "https://registry.local/api/v1/documents?limit=200&offset=0");
    assert.equal(calls[1][0], "https://registry.local/api/v1/documents?limit=200&offset=200");
  });

  it("loads filtered document lists from the Registry API", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher: AklFetch = async (input, init) => {
      calls.push([input, init]);
      return Response.json({
        items: [documentFixture("doc_contract_1")],
        limit: 200,
        offset: 0
      });
    };

    const clients = createApiClients({ env, fetcher });
    const documents = await clients.registry.listDocuments(createMockContext(), {
      topics: ["smlouvy"],
      tenantId: "tenant-a",
      externalSystem: "STRATOS_BUDGET",
      entityType: "contract",
      entityId: "contract-1",
      contextTags: ["budget-contract:contract-1"]
    });

    assert.equal(documents.length, 1);
    assert.equal(
      calls[0][0],
      "https://registry.local/api/v1/documents?topic=smlouvy&tenant_id=tenant-a&external_system=STRATOS_BUDGET&entity_type=contract&entity_id=contract-1&context_tag=budget-contract%3Acontract-1&limit=200&offset=0"
    );
  });

  it("loads document metadata summary from the Registry API", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher: AklFetch = async (input, init) => {
      calls.push([input, init]);
      return Response.json({
        total_visible_documents: 2,
        total_matched_documents: 1,
        topics: [
          {
            topic: "digitalizace",
            document_count: 1,
            valid_or_approved_count: 1,
            document_types: [{ key: "methodology", label: "methodology", count: 1 }],
            classifications: [{ key: "internal", label: "internal", count: 1 }],
            statuses: [{ key: "valid", label: "valid", count: 1 }],
            owners: [{ key: "IT", label: "IT", count: 1 }],
            example_documents: ["Metodika digitalizace"]
          }
        ],
        by_document_type: [],
        by_classification: [],
        by_status: [],
        by_owner: [],
        warnings: ["REGISTRY_METADATA_SUMMARY"]
      });
    };

    const clients = createApiClients({ env, fetcher });
    const summary = await clients.registry.getDocumentMetadataSummary(createMockContext(), {
      topics: ["digitalizace", "řízení projektů"],
      classification: "internal",
      tenantId: "tenant-a",
      externalSystem: "STRATOS_BUDGET",
      entityType: "contract",
      entityId: "contract-1",
      externalRef: "contract:1",
      contextTags: ["budget-contract:contract-1"]
    });

    assert.equal(summary.total_visible_documents, 2);
    assert.equal(summary.topics[0].topic, "digitalizace");
    assert.equal(
      calls[0][0],
      "https://registry.local/api/v1/documents/metadata-summary?topic=digitalizace&topic=%C5%99%C3%ADzen%C3%AD+projekt%C5%AF&classification=internal&tenant_id=tenant-a&external_system=STRATOS_BUDGET&entity_type=contract&entity_id=contract-1&external_ref=contract%3A1&context_tag=budget-contract%3Acontract-1"
    );
  });

  it("maps upstream error bodies to ApiClientError", async () => {
    const fetcher: AklFetch = async () =>
      Response.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Denied",
            details: {},
            trace_id: "trace_1"
          }
        },
        { status: 403 }
      );

    const clients = createApiClients({ env, fetcher });

    await assert.rejects(
      () => clients.registry.listDocuments(createMockContext()),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        "code" in error &&
        "traceId" in error &&
        error.status === 403 &&
        error.code === "FORBIDDEN" &&
        error.traceId === "trace_1"
    );
  });

  it("uses assistant endpoints under the RAG API base URL", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher: AklFetch = async (input, init) => {
      calls.push([input, init]);
      if (String(input).includes("/assistant/citations/")) {
        return Response.json({
          chunk_id: "chunk_1",
          document_id: "doc_1",
          document_version_id: "ver_1",
          document_title: "Test",
          source_file_uri: "s3://akl/test.md",
          source_mime_type: "text/markdown",
          source_file_name: "test.md",
          source_size_bytes: 10,
          source_sha256: "sha256:test",
          viewer_mode: "markdown",
          location: {
            page_number: null,
            slide_number: null,
            sheet_name: null,
            row_number: null,
            column_name: null,
            section_path: [],
            section_title: null,
            paragraph_number: null,
            char_start: null,
            char_end: null,
            bbox: null
          },
          chunk_text: "Test text",
          before_text: "",
          after_text: "",
          warnings: []
        });
      }
      if (String(input).includes("/assistant/chat")) {
        return Response.json({
          response_type: "answer",
          conversation_id: "conv_test",
          message: "Answered.",
          answer: "Answered.",
          citations: [],
          confidence: "medium",
          follow_up_questions: [],
          suggested_actions: [],
          current_context: {}
        });
      }
      return Response.json({
        suggestions: [
          {
            label: "Nový přístup",
            prompt: "Jak požádám o nový přístup?",
            domain: "Service Desk",
            audience: "employee"
          }
        ]
      });
    };
    const clients = createApiClients({ env, fetcher });
    const context = createMockContext({
      subjectId: "employee_1",
      accessToken: "test-token",
      requestId: "req_assistant",
      correlationId: "corr_assistant"
    });

    const response = await clients.rag.assistantSuggestions(context);
    const source = await clients.rag.openAssistantCitation("chunk_1", context);
    const chat = await clients.rag.assistantChat(
      {
        user_id: "employee_1",
        conversation_id: null,
        message: "How do I request access?",
        context: {},
        mode: "ask",
        response_language: "cs"
      },
      context
    );

    assert.equal(response.suggestions[0].label, "Nový přístup");
    assert.equal(source.chunk_id, "chunk_1");
    assert.equal(chat.conversation_id, "conv_test");
    assert.equal(calls.length, 3);
    assert.equal(calls[0][0], "https://rag.local/api/v1/assistant/suggestions");
    assert.equal(calls[0][1]?.method, "GET");
    assert.equal(calls[1][0], "https://rag.local/api/v1/assistant/citations/chunk_1/open?subject_id=employee_1");
    assert.equal(calls[1][1]?.method, "GET");
    assert.equal(calls[2][0], "https://rag.local/api/v1/assistant/chat");
    assert.equal(calls[2][1]?.method, "POST");
  });

  it("loads workflow tasks from the Registry API", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher: AklFetch = async (input, init) => {
      calls.push([input, init]);
      return Response.json({
        items: [
          {
            task_id: "task_1",
            source_key: "document-review:doc_1",
            kind: "review",
            priority: "high",
            status: "open",
            title: "Review",
            description: "Review document.",
            source: "Registry document status",
            owner_id: "user_1",
            owner_label: "IT",
            role: "Owner / gestor",
            document_id: "doc_1",
            document_title: "Document",
            document_version_id: null,
            audit_event_id: null,
            job_id: null,
            due_at: "2026-06-06T10:00:00Z",
            resolved_at: null,
            metadata: {},
            created_at: "2026-06-05T10:00:00Z",
            updated_at: "2026-06-05T10:00:00Z"
          }
        ],
        limit: 100,
        offset: 0
      });
    };
    const clients = createApiClients({ env, fetcher });
    const tasks = await clients.registry.listWorkflowTasks(createMockContext(), {
      includeResolved: true,
      documentId: "doc_1"
    });

    assert.equal(tasks[0].task_id, "task_1");
    assert.equal(calls[0][0], "https://registry.local/api/v1/workflow/tasks?document_id=doc_1&include_resolved=true");
    assert.equal(calls[0][1]?.method, "GET");
  });

  it("loads and replaces document assignments through the Registry API", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher: AklFetch = async (input, init) => {
      calls.push([input, init]);
      return Response.json({
        items: [
          {
            assignment_id: "assign_1",
            document_id: "doc_1",
            role: "reviewer",
            subject_type: "group",
            subject_id: "reviewers",
            display_label: "Reviewers",
            is_primary: true,
            active: true,
            sla_days: 3,
            escalation_subject_type: "unit",
            escalation_subject_id: "Compliance",
            escalation_label: "Compliance",
            assigned_by: "admin_1",
            assigned_at: "2026-06-06T10:00:00Z",
            last_audit_event_id: "audit_1",
            metadata: {},
            created_at: "2026-06-06T10:00:00Z",
            updated_at: "2026-06-06T10:00:00Z"
          }
        ]
      });
    };
    const clients = createApiClients({ env, fetcher });
    const context = createMockContext();

    const listed = await clients.registry.listDocumentAssignments("doc_1", context);
    const replaced = await clients.registry.replaceDocumentAssignments(
      "doc_1",
      {
        assignments: [
          {
            role: "reviewer",
            subject_type: "group",
            subject_id: "reviewers",
            display_label: "Reviewers",
            is_primary: true,
            active: true,
            sla_days: 3,
            escalation_subject_type: "unit",
            escalation_subject_id: "Compliance",
            escalation_label: "Compliance"
          }
        ]
      },
      context
    );

    assert.equal(listed[0].assignment_id, "assign_1");
    assert.equal(replaced[0].role, "reviewer");
    assert.equal(calls[0][0], "https://registry.local/api/v1/documents/doc_1/assignments");
    assert.equal(calls[0][1]?.method, "GET");
    assert.equal(calls[1][0], "https://registry.local/api/v1/documents/doc_1/assignments");
    assert.equal(calls[1][1]?.method, "PUT");
    assert.deepEqual(JSON.parse(String(calls[1][1]?.body)), {
      assignments: [
        {
          role: "reviewer",
          subject_type: "group",
          subject_id: "reviewers",
          display_label: "Reviewers",
          is_primary: true,
          active: true,
          sla_days: 3,
          escalation_subject_type: "unit",
          escalation_subject_id: "Compliance",
          escalation_label: "Compliance"
        }
      ]
    });
  });

  it("loads filtered audit events from the Registry API", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher: AklFetch = async (input, init) => {
      calls.push([input, init]);
      return Response.json({
        items: [
          {
            audit_event_id: "audit_1",
            actor_id: "admin_1",
            event_type: "document.assignments.updated",
            resource_type: "document",
            resource_id: "doc_1",
            severity: "info",
            correlation_id: "corr_1",
            metadata: { document_id: "doc_1" },
            created_at: "2026-06-06T10:00:00Z"
          }
        ],
        limit: 25,
        offset: 0
      });
    };
    const clients = createApiClients({ env, fetcher });
    const events = await clients.registry.listAuditEvents(createMockContext(), {
      eventType: "document.assignments.updated",
      resourceType: "document",
      resourceId: "doc_1",
      limit: 25
    });

    assert.equal(events[0].audit_event_id, "audit_1");
    assert.equal(
      calls[0][0],
      "https://registry.local/api/v1/audit/events?event_type=document.assignments.updated&resource_type=document&resource_id=doc_1&limit=25"
    );
    assert.equal(calls[0][1]?.method, "GET");
  });

  it("applies workflow task actions through the Registry API", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher: AklFetch = async (input, init) => {
      calls.push([input, init]);
      return Response.json({
        task_id: "task_1",
        source_key: "document-review:doc_1",
        kind: "review",
        priority: "high",
        status: "resolved",
        title: "Review",
        description: "Review document.",
        source: "Registry document status",
        owner_id: "user_2",
        owner_label: "user_2",
        role: "Owner / gestor",
        document_id: "doc_1",
        document_title: "Document",
        document_version_id: null,
        audit_event_id: null,
        job_id: null,
        due_at: "2026-06-06T10:00:00Z",
        resolved_at: "2026-06-06T11:00:00Z",
        metadata: {
          last_action: "approve"
        },
        created_at: "2026-06-05T10:00:00Z",
        updated_at: "2026-06-06T11:00:00Z"
      });
    };
    const clients = createApiClients({ env, fetcher });
    const task = await clients.registry.applyWorkflowTaskAction(
      "task_1",
      {
        action: "approve",
        comment: "Looks good.",
        assignee_id: "user_2",
        metadata: { source: "test" }
      },
      createMockContext()
    );

    assert.equal(task.status, "resolved");
    assert.equal(calls[0][0], "https://registry.local/api/v1/workflow/tasks/task_1/actions");
    assert.equal(calls[0][1]?.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0][1]?.body)), {
      action: "approve",
      comment: "Looks good.",
      assignee_id: "user_2",
      metadata: { source: "test" }
    });
  });

  it("archives document versions through the Registry API", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher: AklFetch = async (input, init) => {
      calls.push([input, init]);
      return Response.json({
        document_version_id: "ver_1",
        document_id: "doc_1",
        version_label: "1.0",
        status: "archived",
        valid_from: "2026-06-01",
        valid_to: null,
        source_file_uri: "s3://akl-documents/doc_1/ver_1/file.pdf",
        file_hash: "sha256:abc",
        change_summary: "Archived.",
        created_at: "2026-06-01T10:00:00Z",
        published_at: "2026-06-02T10:00:00Z"
      });
    };
    const clients = createApiClients({ env, fetcher });
    const version = await clients.registry.archiveDocumentVersion("doc_1", "ver_1", createMockContext());

    assert.equal(version.status, "archived");
    assert.equal(calls[0][0], "https://registry.local/api/v1/documents/doc_1/versions/ver_1/archive");
    assert.equal(calls[0][1]?.method, "POST");
  });

  it("runs governance version comparison through the Governance API", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher: AklFetch = async (input, init) => {
      calls.push([input, init]);
      return Response.json({
        result_id: "result_1",
        document_id: "doc_1",
        left_version_id: "ver_1",
        right_version_id: "ver_2",
        summary: "Changed.",
        change_counts: { added: 0, removed: 0, modified: 1 },
        materiality_score: 0.5,
        changes: [],
        citations: [],
        sources: [],
        confidence: "medium",
        warnings: [],
        missing_information: null
      });
    };
    const clients = createApiClients({ env, fetcher });
    const response = await clients.governance.compareVersions(
      {
        subject_id: "user_1",
        left_version: {
          document_id: "doc_1",
          document_version_id: "ver_1",
          document_title: "Document",
          version_label: "1.0",
          status: "valid",
          classification: "internal",
          valid_from: "2026-06-01",
          valid_to: null,
          source_uri: "s3://akl/doc_1/ver_1.md",
          content: "Old content",
          citations: []
        },
        right_version: {
          document_id: "doc_1",
          document_version_id: "ver_2",
          document_title: "Document",
          version_label: "2.0",
          status: "review",
          classification: "internal",
          valid_from: "2026-07-01",
          valid_to: null,
          source_uri: "s3://akl/doc_1/ver_2.md",
          content: "New content",
          citations: []
        }
      },
      createMockContext()
    );

    assert.equal(response.result_id, "result_1");
    assert.equal(calls[0][0], "https://governance.local/api/v1/governance/compare-versions");
    assert.equal(calls[0][1]?.method, "POST");
    assert.equal(JSON.parse(String(calls[0][1]?.body)).subject_id, "user_1");
  });
});
