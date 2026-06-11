import { defineConfig, devices } from "@playwright/test";

const baseURL = (process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3217").replace(/\/+$/, "");
const appBasePath = process.env.NEXT_PUBLIC_AKL_BASE_PATH?.replace(/\/+$/, "") ?? "";
const healthURL = `${baseURL}${appBasePath}/api/health`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure"
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3217",
    env: {
      AKL_API_CLIENT_MODE: "mock",
      AKL_AUTH_MODE: "mock",
      AKL_ENV: "test",
      AKL_WEB_OBJECT_STORAGE_ROOT: "../../object-storage",
      NEXT_TELEMETRY_DISABLED: "1"
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: healthURL
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"]
      }
    }
  ]
});
