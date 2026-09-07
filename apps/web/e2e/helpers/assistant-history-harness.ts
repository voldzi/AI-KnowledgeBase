import type { Page } from "@playwright/test";
import { createRequire } from "node:module";
import type { AssistantConversationListItem } from "../../src/lib/types";

export async function mountAssistantHistory(page: Page, conversation: AssistantConversationListItem) {
  const basePath = process.env.NEXT_PUBLIC_AKL_BASE_PATH?.replace(/\/+$/, "") ?? "";
  const runtimeRequire = createRequire(`${process.cwd()}/package.json`);
  const { build } = createRequire(runtimeRequire.resolve("tsx"))("esbuild");
  const styles = await build({ stdin: { contents: '@import "@voldzi/stratos-ui/styles.css"; @import "./src/app/globals.css";',
    loader: "css", resolveDir: process.cwd() }, bundle: true, write: false });
  const css = styles.outputFiles[0].text;
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
  await page.route(`**${basePath}/history-window-harness`, (route) => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html><head><style>${css}</style></head><body class="stratos-akb-shell stratos-akb-shell--chat"><div id="test-root" style="height:100dvh;min-height:0"></div></body></html>`,
  }));
  await page.goto(`${basePath}/history-window-harness`);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
}
