import { expect, test } from "@playwright/test";
import { expectOnWorkspaces, login } from "./helpers/page";

test.describe("admin login", () => {
  test("rejects bad credentials and stays on the login page", async ({ page }) => {
    await login(page, { password: "definitely-wrong", expectSuccess: false });
    // The mutation surfaces error messages from the admin-api in red text
    // beneath the form. Anything in the INVALID_CREDENTIALS family qualifies.
    await expect(page.getByText(/INVALID_CREDENTIALS|Unauthorized|invalid/i)).toBeVisible({
      timeout: 7_000,
    });
    await expect(page).toHaveURL(/\/login$/);
  });

  test("good credentials land on the workspaces page", async ({ page }) => {
    await login(page);
    await expectOnWorkspaces(page);
  });

  test("an authenticated session survives a reload", async ({ page }) => {
    await login(page);
    await expectOnWorkspaces(page);
    await page.reload();
    await expectOnWorkspaces(page);
  });
});
