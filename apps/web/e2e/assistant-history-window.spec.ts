import { expect, test } from "@playwright/test";
import { mountAssistantHistory } from "./helpers/assistant-history-harness";
import type { AssistantConversationDetail, AssistantConversationListItem } from "../src/lib/types";

const basePath = process.env.NEXT_PUBLIC_AKL_BASE_PATH?.replace(/\/+$/, "") ?? "";
function history(count: number): AssistantConversationDetail & AssistantConversationListItem {
  const now = "2026-09-05T12:00:00Z";
  return {
    conversation_id: "conv_window", user_id: "user_dev", title: "Dlouhá konverzace",
    status: "active", visibility: "private", retention_until: null, archived_at: null,
    pinned_at: null, created_at: now, updated_at: now, shared_with: [], message_count: count, suggestion_signals: [],
    messages: Array.from({ length: count }, (_, index) => ({
      message_id: `msg_${index + 1}`, role: index % 2 ? "user" : "assistant",
      content: `Historická zpráva ${index + 1}`, response_type: index % 2 ? null : "answer",
      citations: index % 2 ? [] : [{ document_id: `doc_${index + 1}`, document_version_id: `ver_${index + 1}`,
        chunk_id: `chunk_${index + 1}`, document_title: `Zdroj ${index + 1}`, version_label: "1.0", document_version: "1.0",
        page_number: index + 1, section_path: [] }], metadata: {}, availability: "available",
      created_at: now, author_subject_id: "user_dev", author_subject_type: "user", author_display_name: null,
      viewer_feedback: null,
    })),
  };
}

test("CHAT-WINDOW pages all history with bounded DOM, keyboard focus and matching citation context", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const conversation = history(125);
  await page.route(`**${basePath}/api/assistant/conversations/conv_window`, (route) => route.fulfill({ json: { conversation } }));
  await page.route(`**${basePath}/api/assistant/citations/chunk_125/open`, (route) => route.fulfill({ json: { source_context: {
    chunk_id: "chunk_125", document_id: "doc_125", document_version_id: "ver_125", document_title: "Zdroj 125",
    viewer_mode: "text", location: { page_number: 125, section_path: [] }, chunk_text: "Náhled posledního zdroje",
    before_text: "", after_text: "", warnings: [],
  } } }));
  await mountAssistantHistory(page, conversation);
  const messages = page.locator(".akb-chat-message");
  const navigation = page.getByRole("navigation", { name: "Části konverzace" });
  await expect(messages).toHaveCount(60);
  await expect(navigation).toContainText("Zprávy 66–125 z 125");
  const panel = page.getByRole("complementary", { name: "Zdroje odpovědi" });
  await panel.getByRole("button", { name: "Otevřít citaci", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Náhled posledního zdroje");
  await page.keyboard.press("Escape");
  await navigation.getByRole("button", { name: "Starší zprávy", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(navigation).toContainText("Zprávy 6–65 z 125");
  await expect(messages).toHaveCount(60);
  await expect(messages.first()).toBeFocused();
  await expect(messages.first()).toContainText("Historická zpráva 6");
  await expect(panel).not.toContainText("Náhled posledního zdroje");
  await expect(panel).toContainText("Zdroj 65");
  await expect(page.getByRole("log")).toHaveAttribute("aria-live", "off");
  await navigation.getByRole("button", { name: "Starší zprávy", exact: true }).click();
  await expect(messages).toHaveCount(5);
  await expect(navigation).toContainText("Zprávy 1–5 z 125");
  await expect(navigation.getByRole("button", { name: "Starší zprávy", exact: true })).toBeDisabled();
  await navigation.getByRole("button", { name: "Novější zprávy", exact: true }).click();
  await expect(messages).toHaveCount(60);
  await expect(navigation).toContainText("Zprávy 6–65 z 125");
  await navigation.getByRole("button", { name: "Nejnovější zprávy", exact: true }).click();
  await expect(navigation).toContainText("Zprávy 66–125 z 125");
  await expect(messages.last()).toBeFocused();
  await expect(messages.last()).toContainText("Historická zpráva 125");
  await page.screenshot({ path: testInfo.outputPath("chat-history-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(navigation.getByRole("button", { name: "Starší zprávy", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("chat-history-mobile.png") });
});

test("CHAT-WINDOW a pending answer stays reachable and completion does not move an older reader", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const conversation = history(2000);
  await page.route(`**${basePath}/api/assistant/conversations/conv_window`, (route) => route.fulfill({ json: { conversation } }));
  await page.addInitScript((chatPath) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      if (!String(input).endsWith(chatPath)) return originalFetch(input, init);
      return new Promise<Response>((resolve) => {
        (window as unknown as { completeChat: () => void }).completeChat = () => resolve(Response.json({
          response: { response_type: "answer", conversation_id: "conv_window", answer: "Aktuální odpověď",
            message: null, questions: [], why_needed: null, current_context: {}, confidence: "high", warnings: [],
            citations: [], report_artifacts: [], follow_up_questions: [], suggested_actions: [], missing_information: null, recommended_action: null },
          persistence_status: "failed", message_id: null,
        }));
      });
    };
  }, `${basePath}/api/assistant/chat`);
  await mountAssistantHistory(page, conversation);
  const messages = page.locator(".akb-chat-message");
  await expect(messages).toHaveCount(60);
  const navigation = page.getByRole("navigation", { name: "Části konverzace" });
  await navigation.getByRole("button", { name: "Starší zprávy", exact: true }).click();
  const composer = page.getByLabel("Zeptejte se na informace v AKB a aplikacích STRATOS");
  await composer.fill("Nový dotaz");
  await page.getByRole("button", { name: "Odeslat", exact: true }).click();
  await expect(navigation).toContainText("Zprávy 1943–2002 z 2002");
  await expect(page.locator(".akb-chat-loader")).toHaveCSS("animation-name", "none");
  await expect(messages).toHaveCount(60);
  await navigation.getByRole("button", { name: "Starší zprávy", exact: true }).click();
  await expect(navigation).toContainText("Zprávy 1883–1942 z 2002");
  await expect(messages.first()).toBeFocused();
  await page.evaluate(() => (window as unknown as { completeChat: () => void }).completeChat());
  await expect(page.getByRole("button", { name: "Nová odpověď", exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nová odpověď", exact: false })).toBeInViewport();
  await expect(navigation).toContainText("Zprávy 1883–1942 z 2002");
  await expect(messages.first()).toBeFocused();
  await expect(page.getByRole("log")).not.toContainText("Aktuální odpověď");
  await page.getByRole("button", { name: "Nová odpověď", exact: false }).click();
  await expect(messages.last()).toContainText("Aktuální odpověď");
  await expect(messages.last()).toBeFocused();
  await expect(messages).toHaveCount(60);
});

test("CHAT-CLARIFICATION unbound stored history fails visibly without substituting a user prompt", async ({ page }) => {
  const conversation = history(2);
  conversation.messages[0] = { ...conversation.messages[0], role: "user", content: "Nesouvisející otázka", response_type: null, citations: [] };
  conversation.messages[1] = { ...conversation.messages[1], role: "assistant", content: "Uložené doplnění", response_type: "clarification_needed" };
  await page.route(`**${basePath}/api/assistant/conversations/conv_window`, (route) => route.fulfill({ json: { conversation } }));
  let submissions = 0;
  await page.route(`**${basePath}/api/assistant/clarify`, (route) => { submissions++; return route.fulfill({ status: 500 }); });
  await mountAssistantHistory(page, conversation);
  await page.getByRole("button", { name: "Pokračovat", exact: true }).click();
  await expect(page.locator(".akb-chat-status")).toContainText("Původní otázku pro toto doplnění nelze bezpečně určit");
  expect(submissions).toBe(0);
});
