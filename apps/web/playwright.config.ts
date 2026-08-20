import { defineConfig, devices } from "@playwright/test";

const backendDataFile = `/tmp/beecode-phase2-playwright-${process.pid}.json`;
const backendPort = process.env.BEECODE_E2E_BACKEND_PORT ?? "8787";
const webPort = process.env.BEECODE_E2E_WEB_PORT ?? "5173";
const backendUrl = `http://127.0.0.1:${backendPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: webUrl,
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
        BEECODE_BACKEND_PORT: backendPort,
        BEECODE_PUBLIC_BASE_URL: backendUrl,
        BEECODE_WEB_ORIGIN: webUrl,
        BEECODE_DEV_AUTH_ENABLED: "true",
      },
      url: `${backendUrl}/openapi.json`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `pnpm --filter @beecode/web exec vite --host 127.0.0.1 --port ${webPort}`,
      cwd: "../..",
      env: {
        ...process.env,
        BEECODE_VITE_BACKEND_URL: backendUrl,
      },
      url: `${webUrl}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
