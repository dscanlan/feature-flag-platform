import { test } from "@playwright/test";
import { configureCheckout, ensureHarnessFlags } from "./helpers/stack";
import { expectBanner, expectConnection, gotoHarness } from "./helpers/page";

test.describe("polling fallback", () => {
  test.beforeEach(async () => {
    const seed = await ensureHarnessFlags();
    await configureCheckout(seed, {
      enabled: false,
      defaultValueIndex: 1,
      disabledValueIndex: 0,
    });
    await seed.setCorsOrigins(["*"]);
  });

  test("three 5xx stream attempts switch the client to polling", async ({ page }) => {
    let remainingFailures = 3;
    await page.route("**/sdk/stream", async (route) => {
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        await route.fulfill({ status: 503, body: "unavailable" });
        return;
      }
      await route.continue();
    });

    await gotoHarness(page);
    await expectConnection(page, "polling", 8_000);
  });

  test("while polling, changes still propagate and resume can restore streaming", async ({ page }) => {
    const seed = await ensureHarnessFlags();
    let remainingFailures = 3;
    await page.route("**/sdk/stream", async (route) => {
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        await route.fulfill({ status: 503, body: "unavailable" });
        return;
      }
      await route.continue();
    });

    await gotoHarness(page);
    await expectConnection(page, "polling", 8_000);

    await seed.toggleFlag("new-checkout", true);
    await expectBanner(page, "on", 4_000);

    await page.unroute("**/sdk/stream");
    await page.evaluate(() => window.__sdk?.tryResume());
    await expectConnection(page, "streaming", 5_000);
  });
});
