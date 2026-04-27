import { expect, type Page } from "@playwright/test";
import { adminEmail, adminPassword, defaultStageName } from "../../../e2e-stack/src/constants.ts";

export const stageDisplayName = defaultStageName;

export async function login(
  page: Page,
  options: { email?: string; password?: string; expectSuccess?: boolean } = {},
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(options.email ?? adminEmail);
  await page.getByLabel("Password").fill(options.password ?? adminPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Wait for the post-login redirect so the session cookie is set before
  // callers do any further navigation. Tests that intentionally pass bad
  // credentials skip this with `expectSuccess: false`.
  if (options.expectSuccess !== false) {
    await page.waitForURL(/\/workspaces$/, { timeout: 10_000 });
  }
}

export async function expectOnWorkspaces(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/workspaces$/, { timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "Workspaces" })).toBeVisible();
}
