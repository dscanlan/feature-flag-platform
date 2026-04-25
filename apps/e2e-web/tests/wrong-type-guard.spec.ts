import { expect, test } from "@playwright/test";
import { configurePricing, ensureHarnessFlags } from "./helpers/stack";
import { expectBanner, gotoHarness } from "./helpers/page";

test.describe("wrong type guard", () => {
  test.beforeEach(async () => {
    const seed = await ensureHarnessFlags();
    await configurePricing(seed, 1);
    await seed.setCorsOrigins(["*"]);
  });

  test("reading a JSON flag as boolean returns the default and logs WRONG_TYPE", async ({ page }) => {
    const warnings: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "warning") {
        warnings.push(msg.text());
      }
    });

    await gotoHarness(page);
    await page.getByTestId("read-pricing-as-boolean").check();

    await expectBanner(page, "off");
    await expect
      .poll(() => warnings.some((entry) => entry.includes("WRONG_TYPE")))
      .toBeTruthy();
  });
});
