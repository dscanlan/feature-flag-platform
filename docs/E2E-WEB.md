# E2E Web Tests

The `@ffp/e2e-web` package contains end-to-end tests for the browser SDK and React provider. Tests run in real browsers using Playwright, verifying flag evaluation, real-time updates, streaming/polling, and network resilience.

## Quick Start

### Prerequisites

1. Start the e2e stack (in a separate terminal):
   ```bash
   pnpm --filter @ffp/e2e-stack start
   ```

2. Run tests:
   ```bash
   pnpm --filter @ffp/e2e-web test
   ```

### Run Specific Tests

```bash
# Run only boolean flag tests
pnpm --filter @ffp/e2e-web test boolean-flag

# Run with verbose output
pnpm --filter @ffp/e2e-web test -- --reporter=verbose

# Debug with Playwright inspector
pnpm --filter @ffp/e2e-web test -- --debug

# Run headless (default) or with browser visible
pnpm --filter @ffp/e2e-web test -- --headed
```

### View Test Report

```bash
# After tests run
pnpm --filter @ffp/e2e-web show-report
```

## App Architecture

The e2e-web test harness includes:

```
┌─────────────────────────────────────────┐
│       Playwright Test Runner            │
├─────────────────────────────────────────┤
│  Browser App (React + SDK/React)        │
│  ├─ FlagsProvider (initialized by app)  │
│  ├─ Shell (UI with flag evaluations)    │
│  └─ Connection state display            │
├─────────────────────────────────────────┤
│  Sidecar Backend (Node.js)              │
│  ├─ Subject token signing endpoint      │
│  └─ Runtime config endpoint             │
├─────────────────────────────────────────┤
│  Resolver (live flag evaluation)        │
│  Flags propagate to browser in <1s      │
└─────────────────────────────────────────┘
```

## Test Suites

### Boolean Flag (boolean-flag.spec.ts)

Tests boolean flag evaluation in the browser.

**Tests:**
- **Initial render reflects the disabled default** — App shows correct initial state
- **Toggle via admin API updates the DOM within 1s** — Flags propagate quickly

**Example:**
```ts
test("toggle via admin API updates the DOM within 1s", async ({ page }) => {
  const seed = await ensureHarnessFlags();
  await gotoHarness(page);  // load the app

  // Change flag via admin API
  const started = Date.now();
  await seed.toggleFlag("new-checkout", true);

  // DOM updates within 1s via streaming
  await expectBanner(page, "on", 1_500);
  expect(Date.now() - started).toBeLessThan(1_000);
});
```

### JSON Flag (json-flag.spec.ts)

Tests JSON flag evaluation and type safety.

**Tests:**
- **JSON values render correctly** — JSON flags display in the DOM
- **Complex nested structures work** — Deep objects round-trip
- **Type mismatches return fallback** — Wrong type → default value

### Polling Fallback (polling-fallback.spec.ts)

Tests graceful degradation when SSE is unavailable.

**Tests:**
- **Falls back to polling when SSE fails** — Connection state transitions
- **Polling still updates flags within interval** — No real-time, but still updates
- **Recovers to SSE when available** — Dynamic reconnection works

**Example:**
```ts
test("falls back to polling when SSE fails", async ({ page }) => {
  // Block SSE requests via Playwright
  await page.route("**/sdk/stream*", route => route.abort());

  await gotoHarness(page);

  // Connection state shows polling
  await expect(
    page.getByTestId("connection-state")
  ).toHaveText("polling", { timeout: 5_000 });

  // But flags still update periodically
  const seed = await ensureHarnessFlags();
  await seed.toggleFlag("new-checkout", true);

  // Update arrives via polling (slower than SSE)
  await expectBanner(page, "on", 30_000);
});
```

### Reconnect (reconnect.spec.ts)

Tests recovery from network disconnections.

**Tests:**
- **Recovers after network disconnect** — Reconnects and refetches
- **Queued updates apply on reconnect** — No data loss
- **Multiple disconnects don't cascade** — Robust retry logic

**Example:**
```ts
test("recovers after network disconnect", async ({ page }) => {
  await gotoHarness(page);

  // Simulate network failure
  await page.context().setOffline(true);
  await expect(
    page.getByTestId("connection-state")
  ).toHaveText("offline");

  // Restore network
  await page.context().setOffline(false);

  // SDK recovers
  await expect(
    page.getByTestId("connection-state")
  ).toHaveText("streaming", { timeout: 10_000 });
});
```

### CORS Rejection (cors-rejection.spec.ts)

Tests CORS error handling.

**Tests:**
- **CORS error is surfaced clearly** — Error state is set
- **App shows error message** — UX handles the error gracefully
- **Still works with CORS-enabled resolver** — Normal case works

### Real-Time Updates (sse-live-update.spec.ts)

Tests real-time flag updates via SSE.

**Tests:**
- **Flag changes appear in <1s without page reload** — Streaming works
- **Multiple concurrent changes propagate** — Batching works
- **Updates survive page interactions** — No race conditions

### Subject Tokens (subject-token.spec.ts)

Tests signed subject token flow.

**Tests:**
- **Valid token is accepted** — Token auth works
- **Bad token is rejected** — Invalid tokens fail gracefully
- **Token overrides raw subject** — Token claims take precedence

**Example:**
```ts
test("valid token is accepted", async ({ page }) => {
  const seed = await ensureHarnessFlags();
  await gotoHarness(page);

  // Request a signed token
  await page.getByTestId("use-token").click();

  // Token is applied and flags re-evaluate
  await expect(
    page.getByTestId("token-state")
  ).toHaveText("yes", { timeout: 5_000 });
});
```

### Wrong Type Guard (wrong-type-guard.spec.ts)

Tests type safety and fallback behavior.

**Tests:**
- **Reading boolean flag as JSON returns fallback** — Type mismatch handled
- **Reading JSON flag as boolean returns fallback** — Graceful degradation
- **Console warns on type mismatch** — Developer feedback

## Test Helpers

### `gotoHarness(page, path?)`

Navigate to the test app and wait for ready.

```ts
await gotoHarness(page);  // Load app, wait for "app-ready"=yes
```

### `ensureHarnessFlags()`

Get the SeedClient for the harness workspace/stage.

```ts
const seed = await ensureHarnessFlags();
await seed.toggleFlag("new-checkout", true);
```

### `expectBanner(page, state, timeout?)`

Wait for the checkout banner to show "on" or "off".

```ts
await expectBanner(page, "on", 5_000);  // wait up to 5s
```

### `expectConnection(page, state, timeout?)`

Wait for the connection state to change.

```ts
await expectConnection(page, "streaming", 5_000);
await expectConnection(page, "polling", 5_000);
await expectConnection(page, "offline", 5_000);
```

### `connectionState(page)`

Get the connection state locator.

```ts
const state = page.getByTestId("connection-state");
await expect(state).toHaveText("streaming");
```

## Test Data Elements

The harness app exposes test identifiers (data-testid):

| Element | ID | Purpose |
|---------|----|---------| 
| App ready | `app-ready` | "yes" = ready, "no" = loading |
| Checkout banner | `checkout-banner` | "new-checkout: on" or "off" |
| Pricing card | `pricing-card` | JSON flag display |
| Connection state | `connection-state` | "streaming"/"polling"/"offline" |
| User picker | `user-picker` | Change subject |
| Token button | `use-token` | Request signed token |
| Token state | `token-state` | "yes" = token active, "no" = raw subject |
| Last error | `last-error` | Error display |

## Debugging

### Run with Browser Visible

```bash
pnpm --filter @ffp/e2e-web test -- --headed
```

### Debug with Inspector

```bash
pnpm --filter @ffp/e2e-web test -- --debug
```

Opens Playwright Inspector where you can step through tests.

### Print Logs

```ts
test("my test", async ({ page }) => {
  // Log page errors
  page.on("console", (msg) => console.log(msg.text()));
  page.on("pageerror", (err) => console.error(err));

  await gotoHarness(page);
});
```

### Check Network Activity

```ts
test("my test", async ({ page }) => {
  const requests = [];
  page.on("request", (req) => {
    if (req.url().includes("/sdk/")) {
      requests.push(req.url());
    }
  });

  await gotoHarness(page);
  console.log("SDK requests:", requests);
});
```

### Screenshot on Failure

```ts
test("my test", async ({ page }) => {
  try {
    await gotoHarness(page);
  } catch (err) {
    await page.screenshot({ path: "failure.png" });
    throw err;
  }
});
```

## Configuration

### Playwright Config (playwright.config.ts)

Key settings:

```ts
export default defineConfig({
  testDir: "./tests",
  testMatch: "*.spec.ts",
  fullyParallel: true,
  workers: 4,          // parallelism
  timeout: 30_000,     // per test timeout
  expect: { timeout: 5_000 },
  retries: 1,          // retry flaky tests
  use: {
    baseURL: "http://localhost:5180",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm dev:vite & pnpm dev:sidecar",
    port: 5180,
    reuseExistingServer: true,
  },
});
```

### App Config (src/app.tsx)

The test app loads configuration from `/sidecar/runtime`:

```ts
interface RuntimeConfig {
  resolverUrl: string;
  publicKey: string;
  users: string[];
  pollIntervalMs: number;
}
```

The sidecar (backend.ts) serves this based on the e2e-stack runtime.

## Writing a New Test

1. **Create test file** in `tests/my-feature.spec.ts`
2. **Import helpers**:
   ```ts
   import { expect, test } from "@playwright/test";
   import { ensureHarnessFlags, gotoHarness } from "./helpers/stack";
   ```
3. **Write test**:
   ```ts
   test("my feature works", async ({ page }) => {
     const seed = await ensureHarnessFlags();
     await gotoHarness(page);  // wait for app ready

     // Use Playwright API
     await page.getByTestId("my-button").click();

     // Assert
     await expect(page.getByTestId("result")).toHaveText("success");
   });
   ```
4. **Run**: `pnpm --filter @ffp/e2e-web test my-feature`

Example:
```ts
import { expect, test } from "@playwright/test";
import { ensureHarnessFlags, gotoHarness } from "./helpers/stack";

test.describe("my feature", () => {
  test.beforeEach(async () => {
    const seed = await ensureHarnessFlags();
    // setup
  });

  test("works correctly", async ({ page }) => {
    await gotoHarness(page);

    // Test your feature
    const banner = page.getByTestId("checkout-banner");
    await expect(banner).toContainText("new-checkout");
  });
});
```

## Performance

- **Startup**: ~10s (webpack build + stack readiness check)
- **Per test**: ~2-5s (page load + interactions)
- **Full suite**: ~2-3 min (4 parallel workers)

To speed up:
1. Run in parallel: already configured (`workers: 4`)
2. Reduce `timeout` if tests are fast
3. Cache browser (already done)
4. Run subset: `pnpm --filter @ffp/e2e-web test my-feature`

## Troubleshooting

### "Port 5180 already in use"

Another process is using the port. Kill it:
```bash
lsof -i :5180
kill -9 <PID>
```

Or change the port in `playwright.config.ts`.

### "Connection refused to resolver"

The e2e-stack isn't running:
```bash
pnpm --filter @ffp/e2e-stack start
```

### Tests timeout

Increase timeouts:
```ts
test("slow test", async ({ page }) => {
  // ...
}, 60_000);  // 60 second timeout
```

### Flaky tests

Playwright tests can be timing-sensitive. To reduce flakiness:
1. Use `waitFor` with longer timeouts
2. Avoid hard waits (`sleep`)
3. Check `expect(...).toHaveText()` with timeout
4. Increase `retries` in config

Example:
```ts
// Bad
await page.waitForTimeout(1_000);
expect(something).toBe(true);

// Good
await expect(page.getByTestId("ready")).toHaveText("yes", { timeout: 5_000 });
```

### App doesn't load

1. Check webserver is running: `lsof -i :5180`
2. Check logs: `docker compose ... logs resolver`
3. Check browser console: use `page.on("console", console.log)`

## See Also

- [E2E Overview](./E2E-OVERVIEW.md)
- [E2E Stack](./E2E-STACK.md)
- [E2E Node Tests](./E2E-NODE.md)
- [SDK Web Guide](./SDK-Web.md)
- [SDK React Guide](./SDK-React.md)
- [Playwright Docs](https://playwright.dev)
