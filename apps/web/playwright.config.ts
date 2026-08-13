import { defineConfig, devices } from "@playwright/test";

const backendDataFile = `/tmp/beecode-phase2-playwright-${process.pid}.json`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
  webServer: [
    {
      command: "pnpm --filter @beecode/backend start",
      cwd: "../..",
      env: {
        ...process.env,
        BEECODE_PROVIDER: "fake",
        BEECODE_BACKEND_DATA: backendDataFile,
        BEECODE_BACKEND_HOST: "127.0.0.1",
        BEECODE_BACKEND_PORT: "8787",
        BEECODE_PUBLIC_BASE_URL: "http://127.0.0.1:8787",
        BEECODE_WEB_ORIGIN: "http://127.0.0.1:5173",
        BEECODE_DEV_AUTH_ENABLED: "true",
      },
      url: "http://127.0.0.1:8787/openapi.json",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: "pnpm --filter @beecode/web dev",
      cwd: "../..",
      url: "http://127.0.0.1:5173/login",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
