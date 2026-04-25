import { expect, test } from "@playwright/test";
import { configureCheckout, ensureHarnessFlags } from "./helpers/stack";
import { expectBanner, gotoHarness } from "./helpers/page";

test.describe("boolean flag", () => {
  test.beforeEach(async () => {
    const seed = await ensureHarnessFlags();
    await configureCheckout(seed, {
      enabled: false,
      defaultValueIndex: 1,
      disabledValueIndex: 0,
    });
    await seed.setCorsOrigins(["*"]);
    await seed.waitForBooleanFlagValue("new-checkout", false);
  });

  test("initial render reflects the disabled default", async ({ page }) => {
    await gotoHarness(page);
    await expectBanner(page, "off");
  });

  test("toggle via admin API updates the DOM within 1s", async ({ page }) => {
    const seed = await ensureHarnessFlags();
    await gotoHarness(page);

    const started = Date.now();
    await seed.toggleFlag("new-checkout", true);

    await expectBanner(page, "on", 1_500);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
