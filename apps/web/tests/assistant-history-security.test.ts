import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { NextRequest } from "next/server";
import "./helpers/next-server-navigation";

import { GET, PATCH } from "../src/app/api/assistant/conversations/[conversationId]/route";
import { PUT } from "../src/app/api/assistant/conversations/[conversationId]/shares/route";
import { GET as LIST } from "../src/app/api/assistant/conversations/route";

function environment(t: TestContext) {
  const previous = { ...process.env };
  const previousFetch = globalThis.fetch;
  Object.assign(process.env, {
    AKL_ENV: "development", AKL_AUTH_MODE: "mock", AKL_API_CLIENT_MODE: "production",
    AKL_DEV_ACCESS_TOKEN: "", AKL_WEB_DEV_SUBJECT: "user_dev",
    ...Object.fromEntries(["REGISTRY", "INGESTION", "RAG", "GOVERNANCE", "EVALUATION"].map(
      (service) => [`AKL_${service}_API_BASE_URL`, `https://${service.toLowerCase()}.example/api/v1`],
    )),
  });
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    globalThis.fetch = previousFetch;
  });
}

function conversation() {
  return {
    conversation_id: "conv_security", user_id: "user_dev", status: "active", title: "Secret source title",
    visibility: "shared", shared_with: [],
    messages: [
      { message_id: "m1", role: "user", content: "Secret quoted prompt", metadata: {}, citations: [], availability: "available" },
      { message_id: "m2", role: "assistant", content: "Secret answer", metadata: { report_artifacts: [{ title: "Secret report" }] }, citations: [], availability: "available" },
      { message_id: "m3", role: "user", content: "Secret quoted follow-up", metadata: {}, citations: [], availability: "available" },
      { message_id: "m4", role: "assistant", content: "Secret derived answer", metadata: {}, citations: [], availability: "available" },
    ],
  };
}

for (const [method, handler, suffix] of [["GET", GET, ""], ["PATCH", PATCH, ""], ["PUT", PUT, "/shares"]] as const) {
  for (const reason of ["document_revoked", "federated_proof_invalid", "projection_unavailable"] as const) {
    test(`${method} history hides prompts, titles and derived text after ${reason}`, async (t) => {
      environment(t);
      const stored = conversation();
      if (reason === "document_revoked") stored.messages[1].availability = "source_access_changed";
      if (reason === "federated_proof_invalid") stored.messages[1].metadata = { director_copilot_history: {} } as typeof stored.messages[1]["metadata"];
      if (reason === "projection_unavailable") process.env.AKL_DEV_ACCESS_TOKEN = "test-person-token";
      let registryCalls = 0;
      globalThis.fetch = async (input) => {
        if (String(input).startsWith("https://registry.example/")) {
          registryCalls++;
          return Response.json(stored);
        }
        return Response.json({ error: "unavailable" }, { status: 503 });
      };
      const response = await handler(new NextRequest(`https://akb.example/api/assistant/conversations/conv_security${suffix}`, {
        method, ...(method === "GET" ? {} : { body: JSON.stringify(method === "PUT" ? { shares: [] } : { pinned: true }) }),
      }), { params: Promise.resolve({ conversationId: "conv_security" }) });
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(registryCalls, 1);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      const body = await response.json();
      assert.equal(body.conversation.title, null);
      assert.equal(body.conversation.messages.length, 4);
      assert.ok(body.conversation.messages.every((message: { content: string; citations: unknown[] }) => message.content === "" && message.citations.length === 0));
      assert.equal(JSON.stringify(body).includes("Secret"), false);
    });
  }
}

test("valid source-free own history preserves its title and content", async (t) => {
  environment(t);
  const stored = { ...conversation(), visibility: "private" };
  globalThis.fetch = async () => Response.json(stored);
  const response = await GET(new NextRequest("https://akb.example/api/assistant/conversations/conv_security"), {
    params: Promise.resolve({ conversationId: "conv_security" }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).conversation, stored);
});

test("conversation list keeps Registry redaction without a detail request fan-out", async (t) => {
  environment(t);
  const stored = conversation();
  stored.messages[1].metadata = { director_copilot_history: {} } as typeof stored.messages[1]["metadata"];
  const item = { ...stored, title: null, messages: undefined, message_count: 4, suggestion_signals: [] };
  globalThis.fetch = async (input) => {
    assert.match(String(input), /conversation-history\?/);
    return Response.json({ items: [item, { ...item, conversation_id: "conv_private", visibility: "private", title: "My own title" }], limit: 50, offset: 0 });
  };
  const response = await LIST(new Request("https://akb.example/api/assistant/conversations"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.items[0].title, null);
  assert.deepEqual(body.items[0].suggestion_signals, []);
  assert.equal(body.items[1].title, "My own title");
});

test("Registry federated refresh receipts retain their accurate UI reason", async (t) => {
  environment(t);
  const stored = conversation();
  for (const message of stored.messages) {
    message.content = "";
    message.availability = "source_access_changed";
    message.metadata = { history_live_source_refresh_required: true } as typeof message.metadata;
  }
  globalThis.fetch = async () => Response.json({ ...stored, title: null });
  const response = await GET(new NextRequest("https://akb.example/api/assistant/conversations/conv_security"), {
    params: Promise.resolve({ conversationId: "conv_security" }),
  });
  assert.equal(response.status, 200);
  assert.ok((await response.json()).conversation.messages.every((message: { metadata: Record<string, unknown> }) => message.metadata.history_live_source_refresh_required === true));
});
