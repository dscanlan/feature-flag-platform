# E2E Admin UI Tests

The `@ffp/admin-ui-e2e` package contains end-to-end tests for the admin UI.
Tests run in real Chromium via Playwright against a live admin-api, verifying
login, navigation, and flag-lifecycle flows the same way a human admin would.

## Quick Start

### Prerequisites

The Playwright config declares the e2e-stack and the admin-ui Vite dev server
as `webServer` entries — they start automatically when the test suite runs.
You only need to start things yourself if you want to reuse a long-running
stack across multiple invocations.

### Run the Suite

```bash
pnpm --filter @ffp/admin-ui-e2e test
```

First-time setup also needs the Chromium build:

```bash
pnpm --filter @ffp/admin-ui-e2e exec playwright install --with-deps chromium
```

### Run Specific Tests

```bash
# Run a single file
pnpm --filter @ffp/admin-ui-e2e exec playwright test tests/login.spec.ts

# Headed (browser visible) — useful for debugging
pnpm --filter @ffp/admin-ui-e2e exec playwright test --headed

# Step-through debug
pnpm --filter @ffp/admin-ui-e2e exec playwright test --debug
```

### View Test Report

```bash
pnpm --filter @ffp/admin-ui-e2e exec playwright show-report
```

CI uploads the report directory as the `playwright-report-admin-ui` artifact.

## App Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Playwright (chromium project, workers=1)               │
│                                                         │
│  ┌────────────────────────────────────────────────┐     │
│  │ admin-ui Vite dev server  127.0.0.1:5183       │     │
│  │ /api/* proxied to admin-api at 127.0.0.1:4100  │     │
│  └────────────────────────────────────────────────┘     │
│                                                         │
│  ┌────────────────────────────────────────────────┐     │
│  │ e2e-stack (admin-api + resolver + Postgres +   │     │
│  │ Redis) — see E2E-STACK.md                      │     │
│  └────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────┘
```

The two webServer entries in `playwright.config.ts`:

| Command                                                          | Port | Purpose                  |
| ---------------------------------------------------------------- | ---- | ------------------------ |
| `pnpm --filter @ffp/e2e-stack start`                             | 4101 | resolver readiness probe |
| `pnpm --filter @ffp/admin-ui dev` (with `ADMIN_*` env overrides) | 5183 | admin UI Vite dev server |

The admin-ui Vite config reads three optional env vars so the suite can drive
the dev server without forking config:

| Env var                  | Effect                                        |
| ------------------------ | --------------------------------------------- |
| `ADMIN_UI_PORT`          | Port to bind on (defaults to 5173)            |
| `ADMIN_UI_HOST`          | Bind interface (the suite forces `127.0.0.1`) |
| `ADMIN_API_PROXY_TARGET` | Backend the `/api` proxy points at            |

`ADMIN_UI_HOST=127.0.0.1` is needed because Vite's default `localhost` binds
IPv6-only on some macOS configurations, leaving Playwright unable to reach
`127.0.0.1`.

## Test Suites

All specs live in `apps/admin-ui-e2e/tests/*.spec.ts` and share helpers from
`tests/helpers/`.

### `login.spec.ts`

- `rejects bad credentials and stays on the login page`
- `good credentials land on the workspaces page`
- `an authenticated session survives a reload`

### `flag-lifecycle.spec.ts`

- `create, toggle on, reload — change persists`

The flag-lifecycle test creates a fresh flag with a timestamp-derived key
(`ui-e2e-<base36>`) on each run, so it stays idempotent against the
long-lived e2e-stack DB without needing teardown between runs.

## Test Helpers

### Page helpers (`tests/helpers/page.ts`)

```ts
import { login, expectOnWorkspaces, stageDisplayName } from "./helpers/page";
```

- `login(page, { email?, password?, expectSuccess? })` — fills in the form,
  submits, and waits for the post-login redirect (so the cookie is set
  before the next navigation). Pass `expectSuccess: false` for negative
  tests that want to stay on `/login`.
- `expectOnWorkspaces(page)` — assert the URL and heading of the workspace
  list page.
- `stageDisplayName` — re-export of the e2e-stack default stage name so
  tests can click the right stage tab without hard-coding strings.

## Configuration

`apps/admin-ui-e2e/playwright.config.ts` mirrors the e2e-web config. The
suite runs serially (`workers: 1`, `fullyParallel: false`) because all tests
mutate state on the shared workspace.

## Writing a New Test

1. Add `apps/admin-ui-e2e/tests/my-feature.spec.ts`.
2. Import helpers and the e2e-stack constants:

   ```ts
   import { expect, test } from "@playwright/test";
   import { defaultWorkspaceKey } from "../../e2e-stack/src/constants.ts";
   import { login, stageDisplayName } from "./helpers/page";
   ```

3. Most tests start with `await login(page);` then navigate to the page
   under test and drive UI controls with role-based locators
   (`getByRole`, `getByLabel`).
4. For state that has to survive a reload, prefer reload-then-reassert over
   inspecting localStorage — the cookie-based session is what the admin
   actually relies on.

Use a unique key per test run for any resource you create
(`Date.now().toString(36)` is enough), so the long-lived e2e-stack DB
doesn't accumulate conflicts across runs.

## Troubleshooting

### "Connection refused" on `127.0.0.1:5183`

Vite likely bound IPv6-only. The suite passes `ADMIN_UI_HOST=127.0.0.1` to
force IPv4 — if you've started the dev server yourself for `reuseExistingServer`,
make sure that env var is set, or run the dev server through the Playwright
config instead.

### Login test passes but flag-lifecycle redirects to `/login`

The login helper now waits for the post-login redirect before returning, so
the session cookie is set. If you've forked the helper, make sure your
custom flow waits for the URL change before the next `page.goto`.

### Flag toggle not flipping

The Enabled toggle is the only button on the page with an `aria-pressed`
attribute, so target it as `page.locator("button[aria-pressed]")` and
assert against the attribute directly. `getByRole("button", { pressed: ... })`
is too permissive: Playwright treats buttons without `aria-pressed` as
matching `pressed: false`, which yields strict-mode violations.

## See Also

- [E2E Overview](./E2E-OVERVIEW.md)
- [E2E Stack](./E2E-STACK.md)
- [E2E Web Tests](./E2E-WEB.md)
- [Playwright Docs](https://playwright.dev)
