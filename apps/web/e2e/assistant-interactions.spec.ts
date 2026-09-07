import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";

const basePath = process.env.NEXT_PUBLIC_AKL_BASE_PATH?.replace(/\/+$/, "") ?? "";
const appPath = (path: string) => `${basePath}${path}`;

function answer(index: number, conversationId: string | null = null) {
  return {
    response: {
      response_type: "answer", conversation_id: conversationId, answer: `Odpověď ${index}`,
      message: null, questions: [], why_needed: null, current_context: {}, confidence: "high",
      warnings: [], citations: [{ document_id: `doc_${index}`, document_version_id: `ver_${index}`,
        document_title: `Zdroj odpovědi ${index}`, version_label: "1.0", chunk_id: `chunk_${index}`,
        page_number: index, section_path: [] }], report_artifacts: [], follow_up_questions: [],
      suggested_actions: [], missing_information: null, recommended_action: null,
    }, persistence_status: "failed", message_id: null,
  };
}

test("CHAT-STOP canceled and late responses cannot replace the active request", async ({ page }) => {
  await page.addInitScript(({ path, first, second }) => {
    const originalFetch = window.fetch.bind(window);
    const pending = new Map<string, () => void>();
    (window as unknown as { resolveChat: (message: string) => void }).resolveChat = (message) => pending.get(message)?.();
    window.fetch = async (input, init) => {
      if (!String(input).endsWith(path)) return originalFetch(input, init);
      const message = JSON.parse(String(init?.body)).message;
      // Deliberately emulate a transport that resolves after AbortController:
      // the UI must also discard obsolete completions and their finally blocks.
      return new Promise<Response>((resolve) => pending.set(message, () => resolve(Response.json(message === "První" ? first : second))));
    };
  }, { path: appPath("/api/assistant/chat"), first: answer(1), second: answer(2) });
  await page.goto(appPath("/chat"));
  const composer = page.getByLabel("Zeptejte se na informace v AKB a aplikacích STRATOS");
  await composer.fill("První");
  await page.getByRole("button", { name: "Odeslat", exact: true }).click();
  await page.getByRole("button", { name: "Zastavit čekání", exact: true }).click();
  await expect(page.getByRole("button", { name: "Odeslat", exact: true })).toBeEnabled();
  await composer.fill("Druhý");
  await page.getByRole("button", { name: "Odeslat", exact: true }).click();
  await page.evaluate(() => (window as unknown as { resolveChat: (message: string) => void }).resolveChat("První"));
  await expect(page.getByRole("button", { name: "Zastavit čekání", exact: true })).toBeVisible();
  await expect(page.locator(".akb-chat-transcript")).not.toContainText("Odpověď 1");
  await page.evaluate(() => (window as unknown as { resolveChat: (message: string) => void }).resolveChat("Druhý"));
  await expect(page.locator(".akb-chat-transcript")).toContainText("Odpověď 2");
  await expect(page.locator(".akb-chat-transcript")).not.toContainText("Odpověď 1");
  await expect(page.getByRole("button", { name: "Odeslat", exact: true })).toBeEnabled();
});

test("CHAT-SOURCES each answer selects its own citation set", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let turn = 0;
  await page.route(`**${appPath("/api/assistant/chat")}`, (route) => route.fulfill({ json: answer(++turn) }));
  await page.goto(appPath("/chat"));
  const composer = page.getByLabel("Zeptejte se na informace v AKB a aplikacích STRATOS");
  for (let index = 1; index <= 2; index++) {
    await composer.fill(`Dotaz ${index}`);
    await page.getByRole("button", { name: "Odeslat", exact: true }).click();
    await expect(page.locator(".akb-chat-transcript")).toContainText(`Odpověď ${index}`);
  }
  const first = page.locator(".akb-chat-message--assistant").filter({ hasText: "Odpověď 1" });
  await first.getByRole("button", { name: "Zdroje odpovědi", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Zdroje odpovědi" });
  await expect(panel).toContainText("Zdroj odpovědi 1");
  await expect(panel).not.toContainText("Zdroj odpovědi 2");
  await expect(first.getByRole("button", { name: "Zdroje odpovědi", exact: true })).toHaveAttribute("aria-pressed", "true");
  const second = page.locator(".akb-chat-message--assistant").filter({ hasText: "Odpověď 2" });
  await second.getByRole("button", { name: "Zdroje odpovědi", exact: true }).click();
  await expect(panel).toContainText("Zdroj odpovědi 2");
  await expect(panel).not.toContainText("Zdroj odpovědi 1");
});

test("CHAT-HISTORY retry starts a fresh history request after failure", async ({ page }) => {
  // The documented mock API has a new in-memory client per request. Mount the
  // real client component with an explicit stored-history fixture instead of
  // pretending an API seed persists across independent server requests.
  const conversation = {
    conversation_id: "conv_retry", user_id: "user_dev", title: "Test obnovy historie",
    status: "active", visibility: "private", retention_until: null, archived_at: null,
    pinned_at: null, created_at: "2026-09-05T12:00:00Z", updated_at: "2026-09-05T12:00:00Z",
    shared_with: [], message_count: 1, suggestion_signals: [],
  };
  let calls = 0;
  await page.route(`**${appPath(`/api/assistant/conversations/${conversation.conversation_id}`)}`, (route) => {
    calls++;
    return calls === 1
      ? route.fulfill({ status: 503, json: { error: { message: "Temporarily unavailable" } } })
      : route.fulfill({ json: { conversation: { ...conversation, messages: [{
          message_id: "history_restored", role: "user", content: "Historie byla obnovena", citations: [],
          metadata: {}, availability: "available", created_at: conversation.created_at,
          author_subject_id: conversation.user_id, author_subject_type: "user", author_display_name: null,
        }] } } });
  });
  const runtimeRequire = createRequire(`${process.cwd()}/package.json`);
  const { build } = createRequire(runtimeRequire.resolve("tsx"))("esbuild");
  const bundle = await build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import {LanguageProvider} from './src/lib/i18n';
      import {AkbAssistantApp} from './src/features/assistant/akb-assistant-app';
      createRoot(document.getElementById('test-root')).render(<LanguageProvider><AkbAssistantApp
        currentSubjectId="user_dev" initialNowIso="2026-09-05T12:00:00Z"
        initialConversations={${JSON.stringify([conversation])}} suggestions={[]} /></LanguageProvider>);`,
      resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife",
    tsconfig: `${process.cwd()}/tsconfig.json`,
    define: { "process.env.NODE_ENV": '"test"', "process.env.NEXT_PUBLIC_AKL_BASE_PATH": JSON.stringify(basePath) },
  });
  await page.route(`**${appPath("/history-test-harness")}`, (route) => route.fulfill({ contentType: "text/html", body: '<html><body><div id="test-root"></div></body></html>' }));
  await page.goto(appPath("/history-test-harness"));
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.getByRole("button", { name: "Načíst znovu", exact: true }).click();
  await expect(page.locator(".akb-chat-transcript")).toContainText("Historie byla obnovena");
  expect(calls).toBe(2);
});

test("CHAT-CLARIFICATION submits the selected response's original prompt, context and own fields", async ({ page }) => {
  let calls = 0;
  await page.route(`**${appPath("/api/assistant/chat")}`, (route) => {
    const index = ++calls;
    const payload = answer(index);
    return route.fulfill({ json: { ...payload, response: { ...payload.response,
      response_type: "clarification_needed", answer: `Doplnění odpovědi ${index}`,
      current_context: { scope_marker: `scope_${index}` }, why_needed: `Upřesnění dotazu ${index}`,
      questions: [{ id: "department", question: "Které oddělení?", type: "free_text", options: [] }],
    } } });
  });
  let request: { message: string; context: Record<string, string> } | undefined;
  await page.route(`**${appPath("/api/assistant/clarify")}`, (route) => {
    request = route.request().postDataJSON();
    return route.fulfill({ json: answer(3) });
  });
  await page.goto(appPath("/chat"));
  const composer = page.getByLabel("Zeptejte se na informace v AKB a aplikacích STRATOS");
  for (const question of ["Původní otázka", "Pozdější nesouvisející otázka"]) {
    await composer.fill(question);
    await page.getByRole("button", { name: "Odeslat", exact: true }).click();
    await expect(page.getByRole("button", { name: "Odeslat", exact: true })).toBeEnabled();
  }
  const original = page.locator(".akb-chat-message--assistant").filter({ hasText: "Doplnění odpovědi 1" });
  const later = page.locator(".akb-chat-message--assistant").filter({ hasText: "Doplnění odpovědi 2" });
  await original.getByLabel("Které oddělení?").fill("Oddělení původní otázky");
  await later.getByLabel("Které oddělení?").fill("Jiné oddělení");
  await expect(original.getByLabel("Které oddělení?")).toHaveValue("Oddělení původní otázky");
  await original.getByRole("button", { name: "Pokračovat", exact: true }).click();
  await expect.poll(() => request).toBeTruthy();
  expect(request?.message).toBe("Původní otázka");
  expect(request?.context.scope_marker).toBe("scope_1");
  expect(request?.context.department).toBe("Oddělení původní otázky");
});
