import { test } from "@playwright/test";
import { configureCheckout, ensureHarnessFlags } from "./helpers/stack";
import { expectBanner, expectConnection, gotoHarness } from "./helpers/page";

// The default e2e harness routes SDK traffic through a Vite proxy, so every
// request looks same-origin to the browser and never trips CORS. It also
// passes a custom `fetch` to the SDK, so the global-fetch fallback path is
// never exercised. This spec opts out of both: it points the SDK directly at
// the resolver (cross-origin) without instrumenting fetch, so the Chromium
// browser's CORS enforcement and the SDK's default fetch path both run.
//
// Catches two regressions we shipped past once already:
//   1. SDK calling the unbound global fetch as `opts.fetchImpl(...)` →
//      Chromium throws "Illegal invocation" and SSE never connects.
//   2. /sdk/stream raw response missing Access-Control-Allow-Origin →
//      browser blocks the SSE response and connection stays "connecting".
test.describe("cross-origin streaming", () => {
  test.beforeEach(async () => {
    const seed = await ensureHarnessFlags();
    await seed.setCorsOrigins(["*"]);
    await configureCheckout(seed, {
      enabled: false,
      defaultValueIndex: 1,
      disabledValueIndex: 0,
    });
  });

  test("SDK opens a streaming connection cross-origin and sees live updates", async ({ page }) => {
    const seed = await ensureHarnessFlags();
    await gotoHarness(page, "/?transport=direct");

    await expectConnection(page, "streaming");
    await expectBanner(page, "off");

    await seed.toggleFlag("new-checkout", true);
    await expectBanner(page, "on", 1_500);
  });
});
