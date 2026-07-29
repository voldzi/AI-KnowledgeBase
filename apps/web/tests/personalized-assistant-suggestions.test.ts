import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  personalizedAssistantSuggestions,
  promptFingerprint,
  suggestionTemplatesForTesting,
} from "../src/lib/assistant/personalized-suggestions";
import { routeAssistantMessage } from "../src/lib/assistant/assistant-tool-router";
import { resolveConversationQuery } from "../src/lib/director-copilot/query-state";
import { classifyDirectorCopilotV2Intent } from "../src/lib/director-copilot-v2/intent-router";
import { pinnedDirectorCopilotV2Catalog } from "../src/lib/director-copilot-v2/manifest-catalog";
import { buildDirectorCopilotV2Plan } from "../src/lib/director-copilot-v2/planner";
import type { AklConfig } from "../src/lib/api/config";
import type {
  ApiRequestContext,
  AssistantConversationListItem,
  AssistantSuggestionSignal,
} from "../src/lib/types";

const NOW = new Date("2026-07-29T08:00:00.000Z");
const CONFIG: AklConfig = {
  environment: "test",
  apiClientMode: "mock",
  authMode: "mock",
  serviceBaseUrls: {
    registry: "http://registry.local",
    ingestion: "http://ingestion.local",
    rag: "http://rag.local",
    governance: "http://governance.local",
    evaluation: "http://evaluation.local",
  },
  directorCopilot: {
    enabled: true,
    clientId: "svc-akb-director-copilot",
    timeoutMs: 8_000,
    maxResponseBytes: 262_144,
  },
};

describe("personalized assistant suggestions", () => {
  it("offers only questions covered by the current access projection", async () => {
    const response = await personalizedAssistantSuggestions({
      context: projectedContext(["projectflow"]),
      config: CONFIG,
      now: NOW,
    });

    assert.ok(response.suggestions.length > 0);
    assert.ok(response.suggestions.every((item) => (
      item.domain === "ProjectFlow" || item.domain === "Dokumenty"
    )));
    assert.ok(response.suggestions.every((item) => item.domain !== "Service Desk"));
    assert.ok(response.suggestions.every((item) => !/incident|přístup/i.test(item.prompt)));
  });

  it("fails closed for live applications without a qualifying grant", async () => {
    const response = await personalizedAssistantSuggestions({
      context: {
        ...projectedContext([]),
        applicationAccess: [],
      },
      config: CONFIG,
      now: NOW,
    });

    assert.deepEqual(response.suggestions.map((item) => item.domain), ["Dokumenty"]);
  });

  it("returns no suggestions when AKB chat access is inactive", async () => {
    const response = await personalizedAssistantSuggestions({
      context: {
        ...projectedContext(["projectflow"]),
        applicationAccessActive: false,
        capabilities: [],
      },
      config: CONFIG,
      now: NOW,
    });

    assert.deepEqual(response.suggestions, []);
  });

  it("uses the Prague month-end cadence without overriding authorization", async () => {
    const response = await personalizedAssistantSuggestions({
      context: projectedContext(["budget", "projectflow", "archflow", "aiip"]),
      config: CONFIG,
      now: NOW,
    });

    assert.equal(response.suggestions[0]?.label, "Odchylka a zpoždění");
    assert.ok(response.suggestions.every((item) => item.domain !== "Service Desk"));
  });

  it("offers a complete executable English set for the same projection", async () => {
    const response = await personalizedAssistantSuggestions({
      context: projectedContext(["budget", "projectflow", "archflow", "aiip"]),
      config: CONFIG,
      language: "en",
      now: NOW,
    });

    assert.equal(response.suggestions.length, 4);
    assert.ok(response.suggestions.every((item) => (
      item.domain === "Documents"
      || classifyDirectorCopilotV2Intent(item.prompt) !== null
    )));
  });

  it("uses structured history across owned threads without repeating a recent prompt", async () => {
    const repeatedPrompt = "Jaký je stav projektového portfolia?";
    const response = await personalizedAssistantSuggestions({
      context: projectedContext(["projectflow"]),
      config: CONFIG,
      conversations: [
        conversationListItem(
          "conv_history",
          "user-1",
          [
            signal(
            "project_portfolio_status",
              repeatedPrompt,
            "2026-07-28T08:00:02.000Z",
            ),
          ],
        ),
      ],
      now: NOW,
    });

    assert.notEqual(response.suggestions[0]?.prompt, repeatedPrompt);
    assert.ok(response.suggestions.some((item) => item.domain === "ProjectFlow"));
  });

  it("raises historically useful domains without copying raw prompts into suggestions", async () => {
    const conversations = [0, 1, 2].map((index) => conversationListItem(
      `conv_aiip_${index}`,
      "user-1",
      [
        signal(
          "aiip_idea_overview",
          `Vlastní historická formulace ${index}`,
          `2026-07-${20 + index}T08:00:02.000Z`,
        ),
      ],
    ));
    const response = await personalizedAssistantSuggestions({
      context: projectedContext(["budget", "projectflow", "archflow", "aiip"]),
      config: CONFIG,
      conversations,
      now: NOW,
    });

    assert.equal(response.suggestions[0]?.domain, "AIIP");
    assert.ok(response.suggestions.every((item) => !item.prompt.includes("Vlastní historická formulace")));
  });

  it("ignores suggestion signals from shared threads owned by another subject", async () => {
    const conversations: AssistantConversationListItem[] = [
      conversationListItem("conv_owned", "user-1", [
        signal(
          "project_portfolio_status",
          "Stav projektů",
          "2026-07-27T08:00:00.000Z",
        ),
      ]),
      conversationListItem("conv_shared", "other-user", [
        signal(
          "aiip_idea_overview",
          "AI podněty",
          "2026-07-28T08:00:00.000Z",
        ),
        signal(
          "aiip_idea_overview",
          "Další AI podněty",
          "2026-07-28T09:00:00.000Z",
        ),
      ]),
    ];
    const response = await personalizedAssistantSuggestions({
      context: projectedContext(["projectflow", "aiip"]),
      config: CONFIG,
      conversations,
      now: NOW,
    });

    assert.equal(response.suggestions[0]?.domain, "ProjectFlow");
  });

  it("keeps every Czech template on an executable bounded chat route", () => {
    const context = projectedContext(["budget", "projectflow", "archflow", "aiip"]);
    const catalog = pinnedDirectorCopilotV2Catalog();
    for (const template of suggestionTemplatesForTesting("cs", NOW)) {
      if (template.kind === "registry_documents") {
        const route = routeAssistantMessage(template.prompt, "cs");
        assert.equal(route.tool, "registry_document_report", template.prompt);
        continue;
      }
      const resolved = resolveConversationQuery({
        message: template.prompt,
        now: NOW,
      });
      assert.equal(resolved.recognized, true, template.prompt);
      assert.equal(
        classifyDirectorCopilotV2Intent(template.prompt),
        template.intent,
        template.prompt,
      );
      const plan = buildDirectorCopilotV2Plan({
        message: template.prompt,
        language: "cs",
        context,
        intent: template.intent!,
        queryState: resolved.state,
        catalog,
        now: NOW,
      });
      assert.ok(plan.nodes.length > 0, template.prompt);
      assert.ok(plan.nodes.every((node) => (
        node.access.authorized
        && node.request !== null
        && node.planning_error_code === null
      )), template.prompt);
    }
  });
});

function projectedContext(
  applications: Array<"budget" | "projectflow" | "archflow" | "aiip">,
): ApiRequestContext {
  return {
    subjectId: "user-1",
    organizationId: "org_stratos",
    identityActive: true,
    membershipActive: true,
    applicationAccessActive: true,
    authorizationSource: "stratos_projection",
    accessToken: "actor-token",
    capabilities: ["akb:chat"],
    applicationAccess: applications.map((application) => ({
      application,
      capabilities: capabilities(application),
      scopes: ["organization:org_stratos"],
      effectiveScopes: ["organization:org_stratos"],
      validUntil: null,
    })),
  };
}

function capabilities(application: "budget" | "projectflow" | "archflow" | "aiip"): string[] {
  if (application === "budget") return ["budget:access", "budget:read"];
  if (application === "projectflow") return ["projectflow:access", "projectflow:read"];
  if (application === "archflow") return ["archflow:access", "archflow:read_organization"];
  return ["aiip:access", "aiip:read_organization"];
}

function conversationListItem(
  conversationId: string,
  userId: string,
  suggestionSignals: AssistantSuggestionSignal[] = [],
): AssistantConversationListItem {
  return {
    conversation_id: conversationId,
    user_id: userId,
    status: "active",
    title: null,
    visibility: userId === "user-1" ? "private" : "shared",
    retention_until: "2027-01-01T00:00:00.000Z",
    archived_at: null,
    pinned_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-28T08:00:02.000Z",
    shared_with: [],
    message_count: 2,
    suggestion_signals: suggestionSignals,
  };
}

function signal(
  intent: string,
  prompt: string,
  createdAt: string,
): AssistantSuggestionSignal {
  return {
    source_kind: "director_copilot_v2",
    intent,
    prompt_fingerprint: promptFingerprint(prompt),
    feedback_rating: "helpful",
    created_at: createdAt,
  };
}
