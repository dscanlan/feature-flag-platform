import { expect, test } from "@playwright/test";
import { configureCheckout, ensureHarnessFlags } from "./helpers/stack";
import { expectBanner, gotoHarness, pickUser } from "./helpers/page";

test.describe("sse live update", () => {
  test.beforeEach(async () => {
    const seed = await ensureHarnessFlags();
    await configureCheckout(seed, {
      enabled: false,
      defaultValueIndex: 1,
      disabledValueIndex: 0,
    });
    await seed.setCorsOrigins(["*"]);
  });

  test("admin-api mutation propagates to the open browser view", async ({ page }) => {
    const seed = await ensureHarnessFlags();
    await gotoHarness(page);

    const started = Date.now();
    await seed.toggleFlag("new-checkout", true);

    await expectBanner(page, "on", 1_500);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  test("switching subjects does not create overlapping SSE connections", async ({ page }) => {
    let inflight = 0;
    let maxInflight = 0;
    const watch = (url: string) => url.includes("/sdk/stream");
    page.on("request", (request) => {
      if (!watch(request.url())) return;
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
    });
    const settle = (url: string) => {
      if (!watch(url)) return;
      inflight = Math.max(0, inflight - 1);
    };
    page.on("requestfinished", (request) => settle(request.url()));
    page.on("requestfailed", (request) => settle(request.url()));

    await gotoHarness(page);
    await pickUser(page, "user-vip");
    await page.waitForTimeout(750);
    await pickUser(page, "user-anon");
    await page.waitForTimeout(750);

    expect(maxInflight).toBe(1);
  });
});
