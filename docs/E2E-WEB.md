# E2E Web Tests

The `@ffp/e2e-web` package contains end-to-end tests for the browser SDK and
React provider. Tests run in real Chromium via Playwright against a live
admin-api and resolver, verifying flag evaluation, real-time updates,
streaming/polling, and network resilience.

## Quick Start

### Prerequisites

The Playwright config declares the e2e-stack, the sidecar backend, and the
Vite dev server as `webServer` entries — they all start automatically when
the test suite runs. You only need to start things yourself if you want to
reuse a long-running stack across multiple invocations (faster local iteration).

### Run the Suite

```bash
pnpm --filter @ffp/e2e-web test
```

First-time setup also needs the Chromium build:

```bash
pnpm --filter @ffp/e2e-web exec playwright install --with-deps chromium
```

### Run Specific Tests

```bash
# Run a single file
pnpm --filter @ffp/e2e-web exec playwright test tests/boolean-flag.spec.ts

# Match a test name
pnpm --filter @ffp/e2e-web exec playwright test -g "polling"

# Headed (browser visible) — useful for debugging
pnpm --filter @ffp/e2e-web exec playwright test --headed

# Step-through debug
pnpm --filter @ffp/e2e-web exec playwright test --debug
```

### View Test Report

```bash
pnpm --filter @ffp/e2e-web exec playwright show-report
```

The HTML report is written to `apps/e2e-web/playwright-report/` after every
run. CI uploads that directory as the `playwright-report` artifact.

## App Architecture

The harness in `apps/e2e-web/` consists of:

```
┌─────────────────────────────────────────────────────────┐
│  Playwright (chromium project, workers=1)               │
│                                                         │
│  ┌────────────────────────────────────────────────┐     │
│  │ Vite dev server  127.0.0.1:5180                │     │
│  │ React app + @ffp/sdk/react                     │     │
│  │ ├─ FlagsProvider                               │     │
│  │ └─ Shell (renders flag values + state)         │     │
│  └────────────────────────────────────────────────┘     │
│                                                         │
│  ┌────────────────────────────────────────────────┐     │
│  │ Sidecar backend  127.0.0.1:5181                │     │
│  │ src/backend.ts — signs subject tokens, serves  │     │
│  │ /sidecar/runtime so the app discovers the      │     │
│  │ resolver URL and stage public key              │     │
│  └────────────────────────────────────────────────┘     │
│                                                         │
│  ┌────────────────────────────────────────────────┐     │
│  │ e2e-stack (admin-api + resolver + Postgres +   │     │
│  │ Redis) — see E2E-STACK.md                      │     │
│  └────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────┘
```

The three webServer entries in `playwright.config.ts`:

| Command                                  | Port | Purpose                       |
| ---------------------------------------- | ---- | ----------------------------- |
| `pnpm --filter @ffp/e2e-stack start`     | 4101 | resolver readiness probe      |
| `pnpm --filter @ffp/e2e-web dev:sidecar` | 5181 | subject-token signing backend |
| `pnpm --filter @ffp/e2e-web dev:vite`    | 5180 | React harness                 |

`reuseExistingServer` is `true` when `CI` is unset, so a developer who already
has the stack running will reuse it instead of double-starting.

## Test Suites

All specs live in `apps/e2e-web/tests/*.spec.ts` and share helpers from
`tests/helpers/`.

### `boolean-flag.spec.ts`

- `initial render reflects the disabled default`
- `toggle via admin API updates the DOM within 1s`

### `json-flag.spec.ts`

- `json value renders and updates`
- `mutating the returned object does not leak back into renders`

### `polling-fallback.spec.ts`

- `three 5xx stream attempts switch the client to polling`
- `while polling, changes still propagate and resume can restore streaming`

### `reconnect.spec.ts`

- `a brief offline blip reconnects without dropping the last-known flag value`

### `cors-rejection.spec.ts`

- `rejecting the test origin surfaces a network error and falls back to defaults`
- `resetting the allow-list to wildcard restores flag resolution`

### `sse-live-update.spec.ts`

- `admin-api mutation propagates to the open browser view`
- `switching subjects does not create overlapping SSE connections`

### `subject-token.spec.ts`

- `subjectToken is sent on the wire and resolves the pinned subject`
- `the token wins over the local subject`
- `a bad token keeps the last-known value and surfaces the resolver error`

### `wrong-type-guard.spec.ts`

- `reading a JSON flag as boolean returns the default and logs WRONG_TYPE`

## Test Helpers

### Stack helpers (`tests/helpers/stack.ts`)

```ts
import {
  appOrigin,
  createSeedClient,
  ensureHarnessFlags,
  configureCheckout,
  configurePricing,
} from "./helpers/stack";
```

- `ensureHarnessFlags()` — returns a `SeedClient` bound to the harness
  workspace + stage, with `new-checkout` (boolean) and `pricing` (JSON) flags
  ensured.
- `configureCheckout(seed, opts)` — set the `new-checkout` config (enabled,
  default value, pinned subjects).
- `configurePricing(seed, valueIndex)` — pick which `pricing` JSON value to
  serve.

### Page helpers (`tests/helpers/page.ts`)

```ts
import {
  gotoHarness,
  banner,
  pricingCard,
  connectionState,
  lastError,
  expectBanner,
  expectConnection,
  pickUser,
  pickTokenUser,
  useRaw,
  useToken,
  useBadToken,
} from "./helpers/page";
```

- `gotoHarness(page, path?)` — navigate and wait for `app-ready=yes`.
- `expectBanner(page, "on" | "off", timeout?)` — assert the checkout banner
  shows the expected state.
- `expectConnection(page, "streaming" | "polling" | "offline", timeout?)` —
  assert the SDK connection state.
- The `pickUser`, `useToken`, `useRaw`, `useBadToken` helpers click harness
  controls that swap the active subject / subject token.

## Test Data Elements

The harness app exposes these `data-testid` attributes:

| Element           | ID                  | Notes                                                       |
| ----------------- | ------------------- | ----------------------------------------------------------- |
| App ready         | `app-ready`         | "yes" once `FlagsProvider` reports ready                    |
| Checkout banner   | `checkout-banner`   | "new-checkout: on" or "new-checkout: off"                   |
| Pricing card      | `pricing-card`      | JSON flag rendering                                         |
| Connection state  | `connection-state`  | "streaming" / "polling" / "offline"                         |
| User picker       | `user-picker`       | Switches the local subject                                  |
| Token user picker | `token-user-picker` | Picks the subject the sidecar signs into the next sjt token |
| Use raw           | `use-raw`           | Send raw subject (no token)                                 |
| Use token         | `use-token`         | Request and apply a valid sjt- token                        |
| Use bad token     | `use-bad-token`     | Apply an invalid token (negative test)                      |
| Last error        | `last-error`        | Most recent error from the SDK                              |

## Debugging

### Run with Browser Visible

```bash
pnpm --filter @ffp/e2e-web exec playwright test --headed
```

### Step Through with the Inspector

```bash
pnpm --filter @ffp/e2e-web exec playwright test --debug
```

### Capture Page / Browser Logs

```ts
test("my test", async ({ page }) => {
  page.on("console", (msg) => console.log(`[browser] ${msg.text()}`));
  page.on("pageerror", (err) => console.error("[pageerror]", err));

  await gotoHarness(page);
});
```

### Trace, Screenshot, Video

The config sets `trace: "on-first-retry"`, `screenshot: "only-on-failure"`,
`video: "retain-on-failure"`. After a failed run, look in
`apps/e2e-web/test-results/` and `apps/e2e-web/playwright-report/` for the
captured artifacts.

## Configuration

`apps/e2e-web/playwright.config.ts`:

```ts
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5180",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @ffp/e2e-stack start",
      port: 4101,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "pnpm --filter @ffp/e2e-web dev:sidecar",
      port: 5181,
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "pnpm --filter @ffp/e2e-web dev:vite",
      port: 5180,
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
```

The suite runs serially (`workers: 1`, `fullyParallel: false`) because every
test mutates flags on the same shared workspace + stage.

### App Config

The Vite app fetches its runtime config from `/sidecar/runtime` (proxied to
`127.0.0.1:5181`). The sidecar (`apps/e2e-web/src/backend.ts`) reads the
e2e-stack runtime descriptor and serves it, plus signs subject tokens on
request.

## Writing a New Test

1. Add `apps/e2e-web/tests/my-feature.spec.ts`.
2. Import helpers:

   ```ts
   import { expect, test } from "@playwright/test";
   import { configureCheckout, ensureHarnessFlags } from "./helpers/stack";
   import { expectBanner, gotoHarness } from "./helpers/page";
   ```

3. Stage the flags in `beforeEach`, write the test, then run a single file:

   ```bash
   pnpm --filter @ffp/e2e-web exec playwright test tests/my-feature.spec.ts
   ```

Example:

```ts
test.describe("my feature", () => {
  test.beforeEach(async () => {
    const seed = await ensureHarnessFlags();
    await configureCheckout(seed, { enabled: false, defaultValueIndex: 1, disabledValueIndex: 0 });
    await seed.setCorsOrigins(["*"]);
    await seed.waitForBooleanFlagValue("new-checkout", false);
  });

  test("flag flips on toggle", async ({ page }) => {
    const seed = await ensureHarnessFlags();
    await gotoHarness(page);
    await seed.toggleFlag("new-checkout", true);
    await expectBanner(page, "on", 1_500);
  });
});
```

## Performance

- Cold suite: ~60–90s (Vite + Chromium + stack startup)
- Warm suite (stack already running): ~30s

## Troubleshooting

### "Port 4101 is already used"

A previous stack didn't shut down cleanly. See the troubleshooting section in
[E2E-STACK.md](./E2E-STACK.md) — typically:

```bash
docker compose -f apps/e2e-stack/docker-compose.e2e.yml down
lsof -nP -iTCP:4100,4101,5180,5181 -sTCP:LISTEN
```

### Tests timeout waiting for the app

Confirm the Vite server, sidecar, and stack all came up:

```bash
lsof -nP -iTCP:5180,5181,4101 -sTCP:LISTEN
```

If the sidecar is missing, `gotoHarness` will time out at the
`app-ready=yes` check because the runtime fetch never resolves.

### Flaky tests

Default timeouts are conservative (`expect.timeout: 7_000`). Use
`expectBanner(page, state, longer)` for genuinely slow assertions instead of
raising the global timeout. Avoid `page.waitForTimeout` — use a Locator-based
wait so Playwright's auto-retry kicks in.

## See Also

- [E2E Overview](./E2E-OVERVIEW.md)
- [E2E Stack](./E2E-STACK.md)
- [E2E Node Tests](./E2E-NODE.md)
- [SDK Web Guide](./SDK-Web.md)
- [SDK React Guide](./SDK-React.md)
- [Playwright Docs](https://playwright.dev)
