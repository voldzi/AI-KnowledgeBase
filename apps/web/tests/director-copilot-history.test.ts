import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { AklConfig } from "../src/lib/api/config";
import {
  authorizeDirectorCopilotHistory,
  directorCopilotPersistenceMetadata,
  persistedDirectorCopilotResponse,
} from "../src/lib/director-copilot/history";
import {
  orchestrateDirectorCopilot,
} from "../src/lib/director-copilot/orchestrator";
import type {
  ApiRequestContext,
  AssistantChatResponse,
  AssistantConversationMessage,
} from "../src/lib/types";
import type {
  DomainToolRequest,
  DomainToolResponse,
} from "../src/lib/director-copilot/contracts";

const projectFixture = JSON.parse(readFileSync(
  new URL(
    "../../../contracts/director-copilot/v1/fixtures/projectflow-complete.json",
    import.meta.url,
  ),
  "utf8",
)) as DomainToolResponse;

describe("Director Copilot governed history", () => {
  it("persists a bounded envelope without raw facts or the live snapshot", async () => {
    const response = await directorResponse();
    const metadata = directorCopilotPersistenceMetadata(response, context());
    const serialized = JSON.stringify(metadata);
    const persisted = persistedDirectorCopilotResponse(response);

    assert.match(serialized, /director-copilot-history-1/);
    assert.match(serialized, /STRATOS_PROJECTFLOW/);
    assert.equal(serialized.includes("project.schedule_status"), false);
    assert.equal(serialized.includes("director_copilot_snapshot"), false);
    assert.equal(
      JSON.stringify(persisted.current_context).includes(
        "director_copilot_snapshot",
      ),
      false,
    );
    assert.equal(
      persisted.warnings.includes(
        "CONVERSATION_HISTORY_DISABLED_FOR_GOVERNED_FEDERATION",
      ),
      false,
    );
  });

  it("reauthorizes the original governed source and fails closed on access change", async () => {
    const response = await directorResponse();
    const message = assistantMessage(
      directorCopilotPersistenceMetadata(response, context()),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as DomainToolRequest;
      return Response.json({
        ...structuredClone(projectFixture),
        tool_call_id: request.tool_call_id,
      });
    };
    try {
      assert.deepEqual(
        await authorizeDirectorCopilotHistory({
          message,
          previousUserMessage: "Jaký je stav projektů?",
          actorContext: context(),
          config: config(),
        }),
        { status: "allowed" },
      );
      assert.deepEqual(
        await authorizeDirectorCopilotHistory({
          message,
          previousUserMessage: "Jaký je stav projektů?",
          actorContext: {
            ...context(),
            applicationAccess: [],
          },
          config: config(),
        }),
        { status: "access_changed" },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("hides governed history when the source cannot be verified", async () => {
    const response = await directorResponse();
    const message = assistantMessage(
      directorCopilotPersistenceMetadata(response, context()),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("source unavailable");
    };
    try {
      assert.deepEqual(
        await authorizeDirectorCopilotHistory({
          message,
          previousUserMessage: "Jaký je stav projektů?",
          actorContext: context(),
          config: config(),
        }),
        { status: "source_unavailable" },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails closed for a malformed or empty governed history envelope", async () => {
    const malformed = assistantMessage({
      director_copilot_history: {
        schema: "director-copilot-history-1",
        source_refs: [],
      },
    });
    assert.deepEqual(
      await authorizeDirectorCopilotHistory({
        message: malformed,
        previousUserMessage: "Jaký je stav projektů?",
        actorContext: context(),
        config: config(),
      }),
      { status: "access_changed" },
    );
  });
});

async function directorResponse(): Promise<AssistantChatResponse> {
  const orchestration = await orchestrateDirectorCopilot({
    message: "Jaký je stav projektů?",
    language: "cs",
    context: context(),
    intent: "project_portfolio_status",
    client: {
      execute: async (_application, request) => ({
        ...structuredClone(projectFixture),
        tool_call_id: request.tool_call_id,
      }),
    },
  });
  assert.ok(orchestration.snapshot);
  return {
    response_type: "answer",
    conversation_id: "conv_history",
    answer: "Ověřený stav projektů.",
    message: null,
    questions: [],
    why_needed: null,
    current_context: {
      answer_source: "director_copilot_projectflow",
      active_source_application: "projectflow",
      director_copilot_snapshot: orchestration.snapshot,
    },
    citations: [],
    follow_up_questions: ["Které projekty jsou zpožděné?"],
    suggested_actions: [],
    report_artifacts: [],
    confidence: "high",
    warnings: [
      "DIRECTOR_COPILOT_PROJECTFLOW_LIVE_DATA",
      "CONVERSATION_HISTORY_DISABLED_FOR_GOVERNED_FEDERATION",
    ],
    missing_information: null,
    recommended_action: null,
  };
}

function assistantMessage(
  metadata: Record<string, unknown>,
): AssistantConversationMessage {
  return {
    message_id: "msg_history",
    role: "assistant",
    author_subject_id: "akb-assistant",
    author_subject_type: "service",
    author_display_name: "AKB Assistant",
    content: "Ověřený stav projektů.",
    response_type: "answer",
    citations: [],
    metadata,
    availability: "available",
    viewer_feedback: null,
    created_at: "2026-07-25T08:00:00.000Z",
  };
}

function config(): AklConfig {
  return {
    environment: "test",
    apiClientMode: "mock",
    authMode: "mock",
    serviceBaseUrls: {
      registry: "mock://registry",
      ingestion: "mock://ingestion",
      rag: "mock://rag",
      governance: "mock://governance",
      evaluation: "mock://evaluation",
    },
    directorCopilot: {
      enabled: true,
      clientId: "svc-akb-director-copilot",
      projectflowBaseUrl: "https://projectflow.example",
      timeoutMs: 1_000,
      maxResponseBytes: 262_144,
    },
  };
}

function context(): ApiRequestContext {
  return {
    subjectId: "user-001",
    organizationId: "org_stratos",
    authorizationSource: "stratos_projection",
    accessToken: "actor-token",
    requestId: "request-history",
    correlationId: "correlation-history",
    capabilities: ["akb:chat"],
    scopes: ["project:project-001"],
    applicationAccess: [{
      application: "projectflow",
      capabilities: ["projectflow:access", "projectflow:read"],
      scopes: ["project:project-001"],
      effectiveScopes: ["project:project-001"],
    }],
  };
}
