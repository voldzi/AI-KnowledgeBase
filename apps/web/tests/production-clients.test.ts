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
  AKL_EVALUATION_API_BASE_URL: "https://evaluation.local/api/v1/",
  AKL_WEB_OIDC_ISSUER: "https://login.local/realms/stratos",
  AKL_WEB_PUBLIC_BASE_URL: "https://akl.local",
  AKL_WEB_SESSION_SECRET: "test-session-secret",
  AKL_WEB_STRATOS_AUTH_ME_URL: "https://stratos.local/api/v1/auth/me"
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

  it("loads document readiness reports from the Registry API", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher: AklFetch = async (input, init) => {
      calls.push([input, init]);
      return Response.json({
        generated_at: "2026-07-09T12:00:00Z",
        total_visible_documents: 222,
        ready_documents: 12,
        review_documents: 210,
        blocked_documents: 0,
        readiness_score: 0.0541,
        issue_counts: [{ key: "document_number_missing", label: "document_number_missing", count: 222 }],
        by_severity: [{ key: "warning", label: "warning", count: 222 }],
        by_document_type: [],
        by_classification: [],
        by_status: [],
        issues: [],
        warnings: ["REGISTRY_DOCUMENT_READINESS_REPORT"]
      });
    };

    const clients = createApiClients({ env, fetcher });
    const report = await clients.registry.getDocumentReadinessReport(createMockContext(), {
      classification: "internal",
      documentType: "directive",
      maxIssues: 24
    });

    assert.equal(report.total_visible_documents, 222);
    assert.equal(report.issue_counts[0]?.key, "document_number_missing");
    assert.equal(
      calls[0][0],
      "https://registry.local/api/v1/documents/readiness-report?classification=internal&document_type=directive&max_issues=24"
    );
  });

  it("loads entity facets from the Ingestion API", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher: AklFetch = async (input, init) => {
      calls.push([input, init]);
      return Response.json({
        status: "ready",
        index_name: "akl_document_chunks",
        total_chunks: 5,
        chunks_with_entities: 3,
        generated_at: "2026-07-09T12:00:00Z",
        warnings: [],
        entity_types: [{ key: "document_number", label: "Document number", count: 2 }],
        entity_groups: [
          {
            entity_type: "document_number",
            label: "Document number",
            count: 2,
            values: [{ key: "RMO12/2024", label: "RMO12/2024", count: 2 }]
          }
        ]
      });
    };

    const clients = createApiClients({ env, fetcher });
    const report = await clients.ingestion.getEntityFacets(createMockContext(), {
      limit: 8,
      valueLimit: 4
    });

    assert.equal(report.status, "ready");
    assert.equal(report.entity_groups[0]?.values[0]?.key, "RMO12/2024");
    assert.equal(
      calls[0][0],
      "https://ingestion.local/api/v1/intelligence/entities/facets?limit=8&value_limit=4"
    );
    assert.equal(calls[0][1]?.method, "GET");
  });

  it("posts analyst search requests to the Ingestion API", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher: AklFetch = async (input, init) => {
      calls.push([input, init]);
      return Response.json({
        status: "ready",
        index_name: "akl_document_chunks",
        query_mode: "fielded",
        total_hits: 1,
        returned_hits: 1,
        generated_at: "2026-07-09T12:00:00Z",
        warnings: [],
        hits: [
          {
            chunk_id: "chunk_1",
            document_id: "doc_109",
            document_version_id: "ver_109_1",
            document_title: "Směrnice RMO 12/2024 pro řízení AI",
            version_label: "1.0",
            document_type: "directive",
            classification: "internal",
            status: "valid",
            score: 10.4,
            snippet: "RMO 12/2024",
            page_number: 3,
            section_title: "Odpovědnosti",
            section_path: [],
            source_file_name: "rmo-ai.pdf",
            entity_types: ["document_number"],
            entity_values: ["RMO12/2024"],
            entity_pairs: ["document_number:RMO12/2024"]
          }
        ]
      });
    };

    const clients = createApiClients({ env, fetcher });
    const report = await clients.ingestion.analystSearch(
      {
        query: "title:RMO AND entity:RMO12/2024",
        query_mode: "fielded",
        search_fields: ["title", "entity"],
        allowed_document_ids: ["doc_109"],
        limit: 3
      },
      createMockContext()
    );

    assert.equal(report.status, "ready");
    assert.equal(report.hits[0]?.document_id, "doc_109");
    assert.equal(calls[0][0], "https://ingestion.local/api/v1/intelligence/analyst/search");
    assert.equal(calls[0][1]?.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0][1]?.body)), {
      query: "title:RMO AND entity:RMO12/2024",
      query_mode: "fielded",
      search_fields: ["title", "entity"],
      allowed_document_ids: ["doc_109"],
      limit: 3
    });
  });

  it("uses Registry API analyst case endpoints", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const now = "2026-07-09T12:00:00Z";
    const fetcher: AklFetch = async (input, init) => {
      calls.push([input, init]);
      const url = String(input);
      if (url.endsWith("/intelligence/cases") && init?.method === "POST") {
        return Response.json(
          {
            case_id: "case_1",
            title: "RMO evidence",
            description: null,
            status: "open",
            owner_id: "analyst_1",
            classification: "internal",
            tags: ["rmo"],
            metadata: {},
            saved_queries: [],
            evidence_items: [],
            created_at: now,
            updated_at: now
          },
          { status: 201 }
        );
      }
      if (url.endsWith("/intelligence/cases/case_1/saved-queries")) {
        return Response.json(
          {
            saved_query_id: "qry_1",
            case_id: "case_1",
            title: "RMO fielded",
            query_text: "title:RMO",
            query_mode: "fielded",
            search_fields: ["title"],
            filters: {},
            created_by: "analyst_1",
            created_at: now
          },
          { status: 201 }
        );
      }
      if (url.endsWith("/intelligence/cases/case_1/evidence")) {
        return Response.json(
          {
            evidence_id: "evd_1",
            case_id: "case_1",
            title: "RMO chunk",
            note: null,
            document_id: "doc_109",
            document_version_id: "ver_109_1",
            document_title: "Směrnice RMO",
            chunk_id: "chunk_1",
            page_number: 3,
            section_title: null,
            source_file_name: null,
            score: 10.4,
            snippet: "RMO 12/2024",
            entity_types: ["document_number"],
            entity_values: ["RMO12/2024"],
            metadata: {},
            created_by: "analyst_1",
            created_at: now
          },
          { status: 201 }
        );
      }
      return Response.json({ items: [], limit: 50, offset: 0 });
    };

    const clients = createApiClients({ env, fetcher });
    const context = createMockContext({ subjectId: "analyst_1", roles: ["reader"] });
    const analystCase = await clients.registry.createAnalystCase({ title: "RMO evidence", tags: ["rmo"] }, context);
    const savedQuery = await clients.registry.createAnalystSavedQuery(
      analystCase.case_id,
      {
        title: "RMO fielded",
        query_text: "title:RMO",
        query_mode: "fielded",
        search_fields: ["title"],
        filters: {}
      },
      context
    );
    const evidence = await clients.registry.createAnalystEvidence(
      analystCase.case_id,
      {
        title: "RMO chunk",
        document_id: "doc_109",
        chunk_id: "chunk_1",
        snippet: "RMO 12/2024"
      },
      context
    );

    assert.equal(analystCase.case_id, "case_1");
    assert.equal(savedQuery.saved_query_id, "qry_1");
    assert.equal(evidence.evidence_id, "evd_1");
    assert.equal(calls[0][0], "https://registry.local/api/v1/intelligence/cases");
    assert.equal(calls[1][0], "https://registry.local/api/v1/intelligence/cases/case_1/saved-queries");
    assert.equal(calls[2][0], "https://registry.local/api/v1/intelligence/cases/case_1/evidence");
  });

  it("uses Registry API profile settings endpoints", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher: AklFetch = async (input, init) => {
      calls.push([input, init]);
      return Response.json({
        subject_id: "user_1",
        settings: {
          core: { language: "cs" },
          apps: { akb: { settingsMode: "sidebar" } }
        },
        roles: ["reader"],
        groups: []
      });
    };

    const clients = createApiClients({ env, fetcher });
    const context = createMockContext({ subjectId: "user_1", roles: ["reader"] });

    const current = await clients.registry.getProfileSettings(context);
    const saved = await clients.registry.putProfileSettings(
      {
        settings: {
          core: { language: "en" },
          apps: { akb: { settingsMode: "fullscreen" } }
        }
      },
      context
    );

    assert.equal(current.subject_id, "user_1");
    assert.equal(saved.settings.apps.akb.settingsMode, "sidebar");
    assert.equal(calls[0][0], "https://registry.local/api/v1/user-profiles/me/settings");
    assert.equal(calls[0][1]?.method, "GET");
    assert.equal(calls[1][0], "https://registry.local/api/v1/user-profiles/me/settings");
    assert.equal(calls[1][1]?.method, "PUT");
  });

  it("searches workflow assignees through the non-admin directory endpoint", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher: AklFetch = async (input, init) => {
      calls.push([input, init]);
      return Response.json({
        users: [
          {
            subject_id: "user_reviewer",
            display_name: "Revizor dokumentu",
            email: "revizor@example.cz",
            username: "revizor",
            enabled: true,
            groups: ["reviewers"]
          }
        ]
      });
    };

    const clients = createApiClients({ env, fetcher });
    const users = await clients.registry.searchDirectoryUsers("revizor", createMockContext(), 12);

    assert.equal(users[0].subject_id, "user_reviewer");
    assert.equal(calls[0][0], "https://registry.local/api/v1/directory/users?limit=12&query=revizor");
    assert.equal(calls[0][1]?.method, "GET");
  });

  it("loads default workflow assignees without a search query", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher: AklFetch = async (input, init) => {
      calls.push([input, init]);
      return Response.json({ users: [] });
    };

    const clients = createApiClients({ env, fetcher });
    const users = await clients.registry.searchDirectoryUsers("", createMockContext(), 50);

    assert.equal(users.length, 0);
    assert.equal(calls[0][0], "https://registry.local/api/v1/directory/users?limit=50");
    assert.equal(calls[0][1]?.method, "GET");
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

  it("uses Registry conversation-history endpoints for persisted assistant threads", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const conversation = {
      conversation_id: "conv_1",
      user_id: "employee_1",
      status: "active",
      title: "Digitalizace",
      visibility: "shared",
      retention_until: "2026-12-31T00:00:00Z",
      archived_at: null,
      created_at: "2026-06-22T10:00:00Z",
      updated_at: "2026-06-22T10:05:00Z",
      shared_with: [
        {
          conversation_share_id: "share_1",
          subject_type: "group",
          subject_id: "projectflow",
          permission: "viewer",
          status: "active",
          created_by: "employee_1",
          created_at: "2026-06-22T10:02:00Z",
          updated_at: "2026-06-22T10:02:00Z"
        }
      ],
      messages: [
        {
          message_id: "msg_1",
          role: "user",
          content: "Kolik máme dokumentů k digitalizaci?",
          response_type: null,
          citations: [],
          metadata: {},
          created_at: "2026-06-22T10:00:00Z"
        }
      ]
    };
    const fetcher: AklFetch = async (input, init) => {
      calls.push([input, init]);
      if (String(input).includes("/assistant/conversation-history?")) {
        return Response.json({
          items: [{ ...conversation, message_count: 1 }],
          limit: 50,
          offset: 0
        });
      }
      return Response.json(conversation);
    };

    const clients = createApiClients({ env, fetcher });
    const context = createMockContext({ subjectId: "employee_1", accessToken: "test-token" });

    await clients.registry.listAssistantConversations(context, true);
    await clients.registry.getAssistantConversation("conv_1", context);
    await clients.registry.appendAssistantConversationMessages(
      "conv_1",
      {
        user_id: "employee_1",
        messages: [{ role: "user", content: "Navazující dotaz" }]
      },
      context
    );
    await clients.registry.updateAssistantConversation("conv_1", { status: "archived" }, context);
    await clients.registry.replaceAssistantConversationShares(
      "conv_1",
      {
        shares: [{ subject_type: "group", subject_id: "projectflow", permission: "viewer" }]
      },
      context
    );

    assert.equal(calls[0][0], "https://registry.local/api/v1/assistant/conversation-history?include_archived=true&limit=50&offset=0");
    assert.equal(calls[0][1]?.method, "GET");
    assert.equal(calls[1][0], "https://registry.local/api/v1/assistant/conversation-history/conv_1");
    assert.equal(calls[1][1]?.method, "GET");
    assert.equal(calls[2][0], "https://registry.local/api/v1/assistant/conversations/conv_1/messages");
    assert.equal(calls[2][1]?.method, "POST");
    assert.equal(calls[3][0], "https://registry.local/api/v1/assistant/conversation-history/conv_1");
    assert.equal(calls[3][1]?.method, "PATCH");
    assert.equal(calls[4][0], "https://registry.local/api/v1/assistant/conversation-history/conv_1/shares");
    assert.equal(calls[4][1]?.method, "PUT");
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

  it("loads retrieval quality overview through the Evaluation API", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher: AklFetch = async (input, init) => {
      calls.push([input, init]);
      return Response.json({
        datasets: [],
        recent_runs: [],
        latest_run: null,
        thresholds: {
          retrieval_recall_min: 0.95,
          retrieval_ndcg_min: 0.85,
          false_zero_result_rate_max: 0.02,
          authorization_leak_rate_max: 0,
          citation_traceability_min: 1,
          retrieval_latency_p95_ms_max: 3000
        },
        generated_at: "2026-07-10T10:00:00Z"
      });
    };
    const clients = createApiClients({ env, fetcher });
    const context = createMockContext({ accessToken: "test-token" });
    const overview = await clients.evaluation.getQualityOverview(context, {
      datasetId: "quality_1",
      limit: 5
    });

    assert.equal(overview.latest_run, null);
    assert.equal(
      calls[0][0],
      "https://evaluation.local/api/v1/evaluations/quality/overview?dataset_id=quality_1&limit=5"
    );
    assert.equal((calls[0][1]?.headers as Headers).get("Authorization"), "Bearer test-token");
  });
});
