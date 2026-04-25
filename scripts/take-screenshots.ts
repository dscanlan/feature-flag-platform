/* eslint-disable no-console */
import { chromium } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../docs/images");
const BASE = "http://localhost:5173";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });

  // --- Login page ---
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/login.png` });
  console.log("✓ login.png");

  // Log in
  await page.fill('input[type="email"]', "admin@example.com");
  await page.fill('input[type="password"]', "changeme");
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/workspaces`);
  await page.waitForLoadState("networkidle");

  // --- Workspace list ---
  await page.screenshot({ path: `${OUT}/workspace-list.png` });
  console.log("✓ workspace-list.png");

  // --- Workspace home (stages + flag list) ---
  await page.goto(`${BASE}/workspaces/demo`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/workspace-stage-keys.png` });
  console.log("✓ workspace-stage-keys.png");

  // --- Flag detail ---
  await page.goto(`${BASE}/workspaces/demo/flags/new-checkout`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/flag-detail-stage-config.png` });
  console.log("✓ flag-detail-stage-config.png");

  // --- Audience detail ---
  await page.goto(`${BASE}/workspaces/demo/audiences/beta-users`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/audience-detail.png` });
  console.log("✓ audience-detail.png");

  await browser.close();
  console.log(`\nAll screenshots saved to docs/images/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
