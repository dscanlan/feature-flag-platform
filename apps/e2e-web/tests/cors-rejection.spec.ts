import { expect, test } from "@playwright/test";
import { appOrigin, configureCheckout, ensureHarnessFlags } from "./helpers/stack";
import { expectBanner, gotoHarness, lastError } from "./helpers/page";

test.describe("cors rejection", () => {
  test.beforeEach(async () => {
    const seed = await ensureHarnessFlags();
    await configureCheckout(seed, {
      enabled: true,
      defaultValueIndex: 1,
    });
  });

  test("rejecting the test origin surfaces a network error and falls back to defaults", async ({ page }) => {
    const seed = await ensureHarnessFlags();
    await seed.setCorsOrigins(["https://other.example"]);
    await seed.waitForCors(appOrigin, false);

    await gotoHarness(page, "/?transport=direct");

    await expect(lastError(page)).toContainText("NETWORK_ERROR", { timeout: 10_000 });
    await expectBanner(page, "off");
  });

  test("resetting the allow-list to wildcard restores flag resolution", async ({ page }) => {
    const seed = await ensureHarnessFlags();
    await seed.setCorsOrigins(["*"]);
    await seed.waitForCors(appOrigin, true);

    await gotoHarness(page, "/?transport=direct");
    await expectBanner(page, "on");
  });
});
