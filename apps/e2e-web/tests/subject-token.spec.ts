import { expect, test } from "@playwright/test";
import { configureCheckout, ensureHarnessFlags } from "./helpers/stack";
import { expectBanner, gotoHarness, lastError, pickTokenUser, pickUser, useBadToken, useRaw, useToken } from "./helpers/page";

test.describe("subject token", () => {
  test.beforeEach(async () => {
    const seed = await ensureHarnessFlags();
    await configureCheckout(seed, {
      enabled: true,
      defaultValueIndex: 1,
      pinned: [{ subjectType: "user", subjectId: "user-pinned", valueIndex: 0 }],
    });
    await seed.setCorsOrigins(["*"]);
    await seed.waitForBooleanFlagValue("new-checkout", true);
  });

  test("subjectToken is sent on the wire and resolves the pinned subject", async ({ page }) => {
    await gotoHarness(page);
    await pickUser(page, "user-anon");
    await useRaw(page);
    await expectBanner(page, "on");

    await pickTokenUser(page, "user-pinned");
    const requestPromise = page.waitForRequest((request) => {
      const body = request.postData() ?? "";
      return request.url().includes("/sdk/resolve") && body.includes("subjectToken");
    });

    await useToken(page);

    const request = await requestPromise;
    const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
    expect(body.subjectToken).toEqual(expect.any(String));
    expect(body.subject).toBeUndefined();
    await expectBanner(page, "off");
  });

  test("the token wins over the local subject", async ({ page }) => {
    await gotoHarness(page);
    await pickUser(page, "user-anon");
    await pickTokenUser(page, "user-pinned");

    await useToken(page);

    await expectBanner(page, "off");
  });

  test("a bad token keeps the last-known value and surfaces the resolver error", async ({ page }) => {
    await gotoHarness(page);
    await pickUser(page, "user-anon");
    await useRaw(page);
    await expectBanner(page, "on");

    await pickTokenUser(page, "user-pinned");
    await useBadToken(page);

    await expect(lastError(page)).toContainText("BAD_SUBJECT_TOKEN");
    await expectBanner(page, "on");
  });
});
