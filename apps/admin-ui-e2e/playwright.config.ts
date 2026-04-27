import { defineConfig, devices } from "@playwright/test";
import { adminApiUrl } from "../e2e-stack/src/constants.ts";

const adminUiPort = 5183;
const adminUiBaseUrl = `http://127.0.0.1:${adminUiPort}`;

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: {
    timeout: 7_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: adminUiBaseUrl,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    // Brings up postgres + redis + admin-api (port 4100) + resolver. We only
    // exercise admin-api here, but reusing the existing stack keeps CI infra
    // and DB seeding consistent with the rest of the e2e suite.
    {
      command: "pnpm --filter @ffp/e2e-stack start",
      port: 4101,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `ADMIN_UI_HOST=127.0.0.1 ADMIN_UI_PORT=${adminUiPort} ADMIN_API_PROXY_TARGET=${adminApiUrl} pnpm --filter @ffp/admin-ui dev`,
      port: adminUiPort,
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
