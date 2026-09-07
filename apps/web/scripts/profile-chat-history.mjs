// Local synthetic UI profile: production React and actual AKB/STRATOS styles.
// No server, provider calls, uploads or real conversation data are involved.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(path.join(webRoot, "package.json"));
const { chromium } = require("@playwright/test");
const { build } = createRequire(require.resolve("tsx"))("esbuild");
const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const turns = option("--turns", "500,1000").split(",").map(Number);
const runs = Number(option("--runs", "3"));
const cpuRate = Number(option("--cpu-rate", "1"));
const unboundedReference = process.argv.includes("--unbounded-reference");
const output = option("--output", null);
if (turns.some((value) => !Number.isInteger(value) || value < 1 || value > 2000)
    || !Number.isInteger(runs) || runs < 1 || runs > 10 || cpuRate < 1 || cpuRate > 8) {
  throw new Error("Use 1–2000 turns, 1–10 runs, and CPU rate 1–8.");
}
const styles = await build({ stdin: { contents: '@import "@voldzi/stratos-ui/styles.css"; @import "./src/app/globals.css";',
  loader: "css", resolveDir: webRoot }, bundle: true, write: false });
const css = styles.outputFiles[0].text;
const bundle = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {LanguageProvider} from './src/lib/i18n';
    import {AkbAssistantApp} from './src/features/assistant/akb-assistant-app';
    createRoot(document.getElementById('test-root')).render(<LanguageProvider><AkbAssistantApp
      currentSubjectId="user_dev" initialNowIso="2026-09-05T12:00:00Z"
      initialConversations={[window.__conversation]} suggestions={[]} /></LanguageProvider>);`,
    resolveDir: webRoot, loader: "tsx" },
  bundle: true, write: false, minify: true, platform: "browser", format: "iife",
  tsconfig: path.join(webRoot, "tsconfig.json"),
  define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_AKL_BASE_PATH": '""' },
  plugins: unboundedReference ? [{ name: "controlled-unbounded-reference", setup(builder) {
    builder.onLoad({ filter: /\/akb-assistant-app\.tsx$/ }, ({ path: file }) => {
      let contents = readFileSync(file, "utf8");
      const replace = (before, after) => {
        if (!contents.includes(before)) throw new Error("The profile control must be updated for the current component.");
        contents = contents.replace(before, after);
      };
      // Test-only in-memory counterfactual of the same candidate. This never
      // writes an application file or adds a production performance bypass.
      replace("const visibleWindow = transcriptWindow(activeThread.messages.length, transcriptEnds[activeThread.id] ?? null);",
        "const visibleWindow = { start: 0, end: activeThread.messages.length, isLatest: true };");
      replace("const ChatMessageContent = memo(function ChatMessageContent({", "const ChatMessageContent = (function ChatMessageContent({");
      replace("activeThread.historyLoaded && activeThread.messages.length > TRANSCRIPT_WINDOW_SIZE ? (", "false ? (");
      return { contents, loader: "tsx" };
    });
  } }] : [],
});

function conversation(turnCount) {
  const now = "2026-09-05T12:00:00Z";
  const messages = Array.from({ length: turnCount }, (_, index) => {
    const shared = { citations: [], metadata: {}, availability: "available", created_at: now,
      author_subject_id: "user_dev", author_subject_type: "user", author_display_name: null };
    return [
      { ...shared, message_id: `user_${index}`, role: "user", content: `Dotaz ${index + 1}: Jaké jsou podmínky kontroly dokumentace?` },
      { ...shared, message_id: `assistant_${index}`, role: "assistant", content:
        `Odpověď ${index + 1}\n\n**Kontrola dokumentace** vyžaduje ověřit správnou verzi a dostupné podklady.\n\n- Zkontrolujte aktuální podmínky.\n- Zaznamenejte výsledek kontroly.\n\nDalší krok projednejte s odpovědnou osobou.`,
        citations: [{ document_id: "doc_synthetic", document_version_id: "ver_synthetic", chunk_id: `chunk_${index}`,
          document_title: "Syntetický podklad", version_label: "1.0", page_number: index + 1, section_path: [] }] },
    ];
  }).flat();
  return { conversation_id: "conv_profile", user_id: "user_dev", title: "Synthetic long conversation",
    status: "active", visibility: "private", retention_until: null, archived_at: null, pinned_at: null,
    created_at: now, updated_at: now, shared_with: [], message_count: messages.length,
    suggestion_signals: [], messages };
}

const browser = await chromium.launch({ headless: true });
const measurements = [];
try {
  for (const turnCount of turns) for (let run = 1; run <= runs; run++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
    await page.route("**/*", (route) => route.request().resourceType() === "document"
      ? route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><style>${css}</style></head><body class="stratos-akb-shell stratos-akb-shell--chat"><div id="test-root" style="height:100dvh;min-height:0"></div></body></html>` })
      : route.abort());
    await page.goto("http://akb-profile.test/");
    await page.evaluate((value) => {
      window.__conversation = value;
      window.__inputSamples = [];
      window.__longTasks = [];
      new PerformanceObserver((entries) => window.__longTasks.push(...entries.getEntries().map((entry) => entry.duration)))
        .observe({ type: "longtask", buffered: false });
      window.fetch = async (input) => {
        if (String(input).includes("/api/assistant/conversations/")) {
          window.__historyStart = performance.now();
          return Response.json({ conversation: value });
        }
        if (String(input).includes("/api/assistant/suggestions")) return Response.json({ suggestions: [] });
        throw new Error(`Unexpected request in local profile: ${String(input)}`);
      };
      new MutationObserver((_, observer) => {
        if (!document.querySelector(".akb-chat-message--assistant")) return;
        observer.disconnect();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          window.__historyReadyMs = performance.now() - window.__historyStart;
        }));
      }).observe(document.getElementById("test-root"), { subtree: true, childList: true });
      document.addEventListener("input", (event) => {
        if (event.target.id !== "akb-chat-composer") return;
        const start = performance.now();
        requestAnimationFrame(() => requestAnimationFrame(() => window.__inputSamples.push(performance.now() - start)));
      }, true);
    }, conversation(turnCount));
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForFunction(() => window.__historyReadyMs !== undefined, null, { timeout: 120_000 });
    const initial = await page.evaluate(() => ({ historyReadyMs: window.__historyReadyMs,
      renderedMessages: document.querySelectorAll(".akb-chat-message").length,
      transcriptNodes: document.querySelector(".akb-chat-transcript").querySelectorAll("*").length,
      initialLongTasksMs: window.__longTasks.slice() }));
    await page.locator("#akb-chat-composer").focus();
    for (const [index, character] of [..."abcdefghij"].entries()) {
      await page.keyboard.press(character);
      await page.waitForFunction((expected) => window.__inputSamples.length >= expected, index + 1, { timeout: 120_000 });
    }
    const inputSamplesMs = await page.evaluate(() => window.__inputSamples);
    const result = { turns: turnCount, messages: turnCount * 2, run, ...initial, inputSamplesMs };
    measurements.push(result);
    process.stderr.write(`${turnCount} turns, run ${run}: history ${initial.historyReadyMs.toFixed(1)} ms, ${initial.renderedMessages} messages, typing max ${Math.max(...inputSamplesMs).toFixed(1)} ms\n`);
    await context.close();
  }
} finally {
  await browser.close();
}
const result = { measuredAt: new Date().toISOString(), node: process.version, platform: process.platform,
  browser: "Playwright Chromium headless", reactMode: "production", viewport: "1440x900", cpuRate,
  variant: unboundedReference ? "same candidate with render window and content memo disabled in memory" : "bounded production candidate",
  scope: "Synthetic authorized history response through actual client component; actual styles; excludes network/PDP, Next hydration, hardware-independent INP and provider latency.", measurements };
if (output) writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
