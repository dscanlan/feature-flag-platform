import { expect, test } from "@playwright/test";
import { configurePricing, ensureHarnessFlags } from "./helpers/stack";
import { gotoHarness, pricingCard } from "./helpers/page";

test.describe("json flag", () => {
  test.beforeEach(async () => {
    const seed = await ensureHarnessFlags();
    await configurePricing(seed, 0);
    await seed.setCorsOrigins(["*"]);
  });

  test("json value renders and updates", async ({ page }) => {
    const seed = await ensureHarnessFlags();
    await gotoHarness(page);
    await expect(pricingCard(page)).toContainText("free");

    await configurePricing(seed, 1);

    await expect(pricingCard(page)).toContainText("pro", { timeout: 1_500 });
  });

  test("mutating the returned object does not leak back into renders", async ({ page }) => {
    const seed = await ensureHarnessFlags();
    await configurePricing(seed, 1);
    await gotoHarness(page);

    await page.getByTestId("mutate-pricing").click();

    await expect(pricingCard(page)).toContainText("pro");
    await expect(pricingCard(page)).not.toContainText("mutated");
  });
});
