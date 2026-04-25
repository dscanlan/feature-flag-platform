# End-to-End Testing

The Feature Flag Platform uses end-to-end tests to verify SDK behavior across
Node.js and browsers against a live admin API and resolver. There are no mocks
in these suites — they run real flag mutations through real services.

## Test Architecture

The e2e test suite is split into three workspace packages:

1. **`@ffp/e2e-stack`** — Shared test infrastructure. Spins up Postgres + Redis
   via `apps/e2e-stack/docker-compose.e2e.yml`, then spawns admin-api and
   resolver as Node child processes (admin-api on `127.0.0.1:4100`, resolver on
   `127.0.0.1:4101`). Writes a runtime descriptor to
   `apps/e2e-stack/.runtime/stack.json` that the other suites read.
2. **`@ffp/e2e-node`** — Node.js SDK tests, run with Vitest. A `globalSetup`
   helper auto-starts the stack if one isn't already healthy.
3. **`@ffp/e2e-web`** — Browser SDK tests, run with Playwright. The Playwright
   config declares the stack, sidecar, and Vite dev server as `webServer`
   entries so they start automatically when the suite runs.

## Getting Started

### Prerequisites

- Docker and Docker Compose
- Node 23.6+ (the build relies on Node's default-on TS type stripping)
- pnpm 9

### Running Tests Locally

The simplest path — let each suite manage its own stack:

```bash
# Node.js SDK tests (Vitest)
pnpm --filter @ffp/e2e-node test

# Browser SDK tests (Playwright)
pnpm --filter @ffp/e2e-web test
```

Or, if you want to keep a long-running stack across multiple test invocations
(faster iteration):

```bash
# Terminal 1 — leave this running
pnpm --filter @ffp/e2e-stack start

# Terminal 2 — both suites detect the existing stack and reuse it when CI is unset
pnpm --filter @ffp/e2e-node test
pnpm --filter @ffp/e2e-web test
```

Note that `pnpm test` at the repo root deliberately **excludes**
`@ffp/e2e-node` and `@ffp/e2e-web` — they each get their own CI job so a
half-torn-down stack from one suite doesn't collide with the other.

## Test Categories

| Category           | App         | Runner     | Coverage                                         |
| ------------------ | ----------- | ---------- | ------------------------------------------------ |
| **Node.js SDK**    | `e2e-node`  | Vitest     | Server-mode SDK, restart resilience, rate limits |
| **Browser SDK**    | `e2e-web`   | Playwright | Real browser + network scenarios                 |
| **Infrastructure** | `e2e-stack` | CLI        | Stack startup, seeding, runtime descriptor       |

`@ffp/e2e-stack` itself has no test script — it's a library + CLI consumed by
the other two.

## E2E Stack

See [E2E-STACK.md](./E2E-STACK.md) for what gets started, where, and how to
talk to it.

## Test Suites

### Node.js Tests (`@ffp/e2e-node`)

See [E2E-NODE.md](./E2E-NODE.md) for full details.

**Verifies:**

- Server-mode SDK flag evaluation (boolean, JSON, composite subjects)
- Subject persistence in `/sdk/resolve`
- Subject signing token (`sjt-`) flow
- Restart resilience — SDK survives a resolver outage
- Rate limit handling and cached-value fallback

### Browser Tests (`@ffp/e2e-web`)

See [E2E-WEB.md](./E2E-WEB.md) for full details.

**Verifies:**

- Boolean and JSON flag evaluation in a real browser
- SSE live updates from admin-api mutations
- Polling fallback after stream failures, and resume back to streaming
- Reconnect across short offline blips
- CORS allow-list enforcement
- Subject token (`sjt-`) flow on the wire
- Wrong-type guard surfaces the default

## Development Workflow

### Adding a Test

**Node.js test:**

```bash
# Add file: apps/e2e-node/test/my-feature.e2e.ts
pnpm --filter @ffp/e2e-node test my-feature
```

**Browser test:**

```bash
# Add file: apps/e2e-web/tests/my-feature.spec.ts
pnpm --filter @ffp/e2e-web test my-feature
```

### Debugging

**Node.js:**

```bash
# Run a single file with verbose output
pnpm --filter @ffp/e2e-node exec vitest run test/server-mode.e2e.ts --reporter=verbose
```

Set `E2E_DEBUG=true` to stream resolver/host child-process output to your
terminal.

**Browser:**

```bash
pnpm --filter @ffp/e2e-web exec playwright test --debug
pnpm --filter @ffp/e2e-web exec playwright test --headed
```

### Viewing Test Results

Playwright writes an HTML report to `apps/e2e-web/playwright-report/` after
every run. Open it directly:

```bash
pnpm --filter @ffp/e2e-web exec playwright show-report
```

CI uploads the same directory as a `playwright-report` artifact.

## CI/CD Integration

Each suite runs in its own job in `.github/workflows/ci.yml`, on a fresh
runner, after the `build` job succeeds:

```yaml
e2e-node:
  runs-on: ubuntu-latest
  needs: [build]
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 23
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - run: pnpm --filter @ffp/e2e-node test

e2e-web:
  runs-on: ubuntu-latest
  needs: [build]
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 23
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - run: pnpm --filter @ffp/e2e-web exec playwright install --with-deps chromium
    - run: pnpm --filter @ffp/e2e-web test
    - if: always()
      uses: actions/upload-artifact@v4
      with:
        name: playwright-report
        path: apps/e2e-web/playwright-report
```

GitHub-hosted `ubuntu-latest` runners ship with Docker, so the e2e-stack's
docker-compose containers come up without any extra setup.

## Troubleshooting

### "Port already in use" on 4100 / 4101 / 5180 / 5181

The stack uses fixed host ports:

| Port | Service                                  |
| ---- | ---------------------------------------- |
| 4100 | admin-api (Node child process)           |
| 4101 | resolver (Node child process)            |
| 5180 | e2e-web Vite dev server (browser tests)  |
| 5181 | e2e-web sidecar backend (subject tokens) |
| 5434 | Postgres (host port → container 5432)    |
| 6381 | Redis (host port → container 6379)       |

If a stack didn't shut down cleanly:

```bash
# Find the process bound to the port
lsof -nP -iTCP:4101 -sTCP:LISTEN

# Tear down the docker-compose containers explicitly
docker compose -f apps/e2e-stack/docker-compose.e2e.yml down
```

The Node child processes (admin-api, resolver) are spawned by the e2e-stack
CLI; ctrl-c'ing the foreground `pnpm --filter @ffp/e2e-stack start` is the
intended teardown path.

### "Connection refused to resolver"

The stack takes ~5–10s for Postgres to become healthy and admin-api to
migrate. If you're starting it yourself, give it time before kicking off
tests.

### Tests hanging or stuck

Check what's actually running:

```bash
docker compose -f apps/e2e-stack/docker-compose.e2e.yml ps
lsof -nP -iTCP:4100,4101 -sTCP:LISTEN
```

If only Postgres/Redis are up but the Node processes never came back, the
admin-api or resolver crashed during boot — re-run with `LOG_LEVEL=debug` to
see why.

### Browser test flakiness

Playwright tests are sensitive to timing. The default test timeout is 30s and
expect timeout is 7s (see `apps/e2e-web/playwright.config.ts`). If you have a
genuinely slow assertion, scope a longer timeout to that single expect rather
than raising the global.

## Performance

Approximate wall-clock on a warm machine:

- **Node.js suite**: ~15–20s
- **Browser suite**: ~60–90s (includes Vite build + browser startup)
- **Stack cold start**: ~10s (docker pull-cached, Postgres healthcheck)

## See Also

- [E2E Stack](./E2E-STACK.md) — Infrastructure setup
- [E2E Node Tests](./E2E-NODE.md) — Node.js SDK tests
- [E2E Web Tests](./E2E-WEB.md) — Browser SDK tests
