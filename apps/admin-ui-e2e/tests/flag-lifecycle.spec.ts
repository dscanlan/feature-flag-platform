import { expect, test } from "@playwright/test";
import { defaultWorkspaceKey } from "../../e2e-stack/src/constants.ts";
import { login, stageDisplayName } from "./helpers/page";

test.describe("flag lifecycle through the admin UI", () => {
  test("create, toggle on, reload — change persists", async ({ page }) => {
    // Unique key per run keeps the test idempotent against the long-lived
    // e2e-stack DB without needing teardown.
    const flagKey = `ui-e2e-${Date.now().toString(36)}`;
    const flagName = `UI E2E ${flagKey}`;

    await login(page);
    await page.goto(`/workspaces/${defaultWorkspaceKey}`);
    await expect(page.getByRole("heading", { name: defaultWorkspaceKey })).toBeVisible();

    // Open the create-flag form and submit a boolean flag.
    await page.getByRole("button", { name: "New flag" }).click();
    await expect(page).toHaveURL(/\/flags\/new$/);
    await page.getByLabel("Flag key").fill(flagKey);
    await page.getByLabel("Display name").fill(flagName);
    await page.getByRole("button", { name: "Create flag" }).click();

    // After create, the page navigates to the flag detail.
    await expect(page).toHaveURL(new RegExp(`/flags/${flagKey}$`));

    // Pick the playwright stage explicitly so we know which stage's toggle
    // we're flipping (the page defaults to the first stage in the list).
    await page.getByRole("button", { name: stageDisplayName }).first().click();

    // Wait for the StageEditor to mount before clicking the toggle —
    // react-query has to fetch the stage config first. The Enabled toggle is
    // the only button on the page with an aria-pressed attribute, so we can
    // target it precisely without relying on accessible names.
    const toggle = page.locator("button[aria-pressed]");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true", { timeout: 5_000 });
    await expect(page.getByText("ON", { exact: true })).toBeVisible();

    // Reload the page; the toggle should still be ON because the change was
    // persisted to admin-api, not just to component state.
    await page.reload();
    await page.getByRole("button", { name: stageDisplayName }).first().click();
    await expect(page.locator("button[aria-pressed]")).toHaveAttribute("aria-pressed", "true", {
      timeout: 5_000,
    });
    await expect(page.getByText("ON", { exact: true })).toBeVisible();
  });
});
