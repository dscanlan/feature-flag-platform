import { test } from "@playwright/test";
import { configureCheckout, ensureHarnessFlags } from "./helpers/stack";
import { expectBanner, expectConnection, gotoHarness } from "./helpers/page";

test.describe("reconnect", () => {
  test.beforeEach(async () => {
    const seed = await ensureHarnessFlags();
    await configureCheckout(seed, {
      enabled: false,
      defaultValueIndex: 1,
      disabledValueIndex: 0,
    });
    await seed.setCorsOrigins(["*"]);
  });

  test("a brief offline blip reconnects without dropping the last-known flag value", async ({
    page,
  }) => {
    const seed = await ensureHarnessFlags();
    await gotoHarness(page);
    await seed.toggleFlag("new-checkout", true);
    await expectBanner(page, "on", 1_500);
    await expectConnection(page, "streaming");

    await page.context().setOffline(true);
    await page.waitForTimeout(2_000);
    await expectBanner(page, "on");

    await page.context().setOffline(false);
    await expectConnection(page, "streaming", 5_000);
    await expectBanner(page, "on");
  });
});
