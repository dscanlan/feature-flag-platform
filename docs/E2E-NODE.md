# E2E Node Tests

The `@ffp/e2e-node` package contains end-to-end tests for the Node.js server-side SDK. Tests run against a live resolver and admin API, verifying real flag evaluation, updates, and error handling.

## Quick Start

### Prerequisites

1. Start the e2e stack (in a separate terminal):
   ```bash
   pnpm --filter @ffp/e2e-stack start
   ```

2. Run tests:
   ```bash
   pnpm --filter @ffp/e2e-node test
   ```

### Run Specific Tests

```bash
# Run only server-mode tests
pnpm --filter @ffp/e2e-node test server-mode

# Run with verbose output
pnpm --filter @ffp/e2e-node test --reporter=verbose

# Debug with inspector
pnpm --filter @ffp/e2e-node test --inspect-brk server-mode
```

## Test Suites

### Server Mode (server-mode.e2e.ts)

Tests the fundamental behavior of the server-mode SDK.

**Tests:**
- **Boolean flag toggle propagates within 1s** — Verifies flag changes are picked up quickly
- **JSON flag round-trips and reacts to default changes** — JSON values persist correctly
- **Composite subject resolves the pinned value when present** — Subject pinning works
- **Multiple subjects' flags resolve independently** — Subject isolation works

**Example:**
```ts
test("boolean flag toggle propagates within 1s", async () => {
  // Initial state
  let value = await fetchJson("/api?user=alice");
  expect(value.checkout).toBe(false);

  // Change flag
  const startedOn = Date.now();
  await stage.seed.toggleFlag("new-checkout", true);

  // Wait for change to propagate
  await waitFor(async () => {
    const res = await fetchJson("/api?user=alice");
    return res.checkout === true;
  }, 2_000);

  // Verify propagation was fast
  expect(Date.now() - startedOn).toBeLessThan(1_500);
});
```

### Subject Tokens (subject-token.e2e.ts)

Tests signed subject token handling for secure subject claims.

**Tests:**
- **Token with valid signature is accepted** — Correct tokens work
- **Token with invalid signature is rejected** — Tampered tokens fail
- **Token claims override raw subject** — Token claims take precedence
- **Bad token triggers error state** — Errors are surfaced correctly

**Example:**
```ts
test("token with valid signature is accepted", async () => {
  // Issue a valid token for a user
  const token = await issueToken(userId, workspaceId);

  // Set token on client
  await client.setSubjectToken(token);

  // Flags evaluate with token claims
  const enabled = client.boolFlag("feature", false);
  expect(enabled).toBe(true);
});
```

### Restart Resilience (restart-resilience.e2e.ts)

Tests the SDK's behavior when the server restarts or reconnects.

**Tests:**
- **Client recovers after resolver restart** — Polling continues to work
- **Cached flags are available before first fetch** — Cache persists
- **Subject mutations are retried on reconnect** — No data loss

**Example:**
```ts
test("client recovers after resolver restart", async () => {
  const client = createServerClient({...});
  await client.ready();

  // Get initial value
  let enabled = client.boolFlag("feature", false);

  // Simulate resolver restart
  await restartResolver();

  // Client recovers and refetches
  await waitFor(async () => {
    enabled = client.boolFlag("feature", false);
    return enabled === true;  // new value
  }, 5_000);
});
```

### Rate Limiting (rate-limit.e2e.ts)

Tests rate limit handling and backoff behavior.

**Tests:**
- **Respects rate limit headers** — Backs off on 429 responses
- **Retries after rate limit window** — Eventually succeeds
- **Multiple subjects don't exceed rate limit** — Batching works

**Example:**
```ts
test("respects rate limit headers", async () => {
  const client = createServerClient({...});

  // Make requests until rate limited
  let responses = [];
  for (let i = 0; i < 100; i++) {
    await client.setSubject({...});
    responses.push(client.getState());
  }

  // Some should be rate-limited
  expect(responses.some(s => s.error?.status === 429)).toBe(true);

  // But eventually recovers
  await waitFor(async () => {
    const state = client.getState();
    return state.ready && !state.error;
  }, 10_000);
});
```

## Test Patterns

### Setup & Teardown

```ts
describe("my test", () => {
  let stage: IsolatedStage;

  beforeAll(async () => {
    // Create isolated workspace and stage
    stage = await provisionStage({ workspaceKey: "my-workspace" });

    // Seed flags
    await stage.seed.ensureBooleanFlag("feature");
    await stage.seed.setFlagConfig("feature", {...});
  });

  afterAll(async () => {
    // Cleanup happens automatically
  });

  test("my test", async () => {
    // Use stage.seed, stage.resolverUrl, etc.
  });
});
```

### Waiting for Async Changes

```ts
// Wait for flag value to change (with timeout)
await waitFor(async () => {
  const value = client.boolFlag("feature", false);
  return value === true;
}, 2_000);  // 2 second timeout

// Or check state
const state = client.getState();
if (state.error) {
  console.error("Last error:", state.error);
}
```

### Fetching Results

```ts
// HTTP request to test server
const result = await fetchJson(`http://localhost:5000/api?user=alice`);

// With timeout
const result = await Promise.race([
  fetchJson("..."),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), 5_000)
  ),
]);
```

## Test Helpers

### `provisionStage(options)`

Creates an isolated workspace and stage for testing.

```ts
const stage = await provisionStage({
  workspaceKey: "unique-key",
  stageName: "Test Stage",
});

// stage.seed — SeedClient for the workspace
// stage.workspace — Workspace object
// stage.stage — Stage object
// stage.resolverUrl — Resolver endpoint URL
// stage.publicKey — Public key for this stage
// stage.serverKey — Server key for this stage
```

### `spawnHost(options)`

Starts a test Node.js server that uses the SDK.

```ts
const host = await spawnHost({
  resolverUrl: stage.resolverUrl,
  serverKey: stage.serverKey,
  publicKey: stage.publicKey,
  env: { DEBUG: "true" },  // optional env vars
});

// host.url — server base URL
// host.stop() — gracefully shut down

const response = await fetch(`${host.url}/api?user=alice`);
```

### `waitFor(fn, timeout)`

Poll until a condition is true (or timeout).

```ts
await waitFor(async () => {
  const value = client.boolFlag("feature", false);
  return value === true;
}, 5_000);  // 5 second timeout
```

### `fetchJson(url)`

Fetch and parse JSON response.

```ts
const data = await fetchJson("http://localhost:5000/api");
// data is already parsed
```

## Configuration

### Workspace Isolation

Each test suite creates its own workspace to avoid conflicts:

```ts
describe("feature A", () => {
  const stage = await provisionStage({ workspaceKey: "feature-a-tests" });
  // ...
});

describe("feature B", () => {
  const stage = await provisionStage({ workspaceKey: "feature-b-tests" });
  // ...
});
```

### Vitest Config

See `vitest.config.ts` for:
- Test environment setup
- Global timeouts
- Reporters

Customize test settings:
```ts
test("my test", async () => {
  // ...
}, 10_000);  // 10 second timeout for this test
```

## Debugging

### Enable Logging

```ts
const client = createServerClient({
  // ...
  logger: (level, msg, meta) => {
    if (level === "error" || level === "warn") {
      console.error(`[SDK] ${msg}`, meta);
    }
  },
});
```

### Run with Inspector

```bash
pnpm --filter @ffp/e2e-node test --inspect-brk server-mode
```

Then open `chrome://inspect` in Chrome DevTools.

### Print State

```ts
const state = client.getState();
console.log("Client state:", {
  ready: state.ready,
  error: state.error,
  version: state.version,
  connectionState: state.connectionState,
});
```

### Check Resolver Response

Mock or inspect what the resolver returns:

```ts
const mockFetch = async (input, init) => {
  const res = await fetch(input, init);
  if (typeof input === "string" && input.includes("/sdk/resolve")) {
    const body = await res.clone().json();
    console.log("Resolver returned:", body);
  }
  return res;
};

const client = createServerClient({
  // ...
  fetch: mockFetch,
});
```

## Troubleshooting

### "Connection refused"

The e2e stack isn't running. Start it:
```bash
pnpm --filter @ffp/e2e-stack start
```

### "Timeout waiting for..."

The test exceeded its timeout. Either:
1. Increase the timeout in the test: `test("...", async () => {...}, 30_000)`
2. Check resolver logs for errors
3. Increase wait-for timeouts in the test

### Test flakiness

Tests depend on timing (flag propagation). To reduce flakiness:
1. Increase timeouts in `waitFor` calls
2. Check resolver and database performance
3. Verify no other processes are competing for resources

### "Workspace already exists"

Tests should use unique workspace keys. Update the workspace key:
```ts
const stage = await provisionStage({
  workspaceKey: `test-${Date.now()}`,
});
```

## Performance

- **Startup**: ~5s (stack must be running)
- **Per test**: ~1-2s (flag propagation waits)
- **Full suite**: ~30-45s

To speed up:
1. Run tests in parallel: `pnpm --filter @ffp/e2e-node test --threads=4`
2. Reduce `waitFor` timeouts if acceptable
3. Upgrade resolver and database

## Writing a New Test

1. **Create test file** in `test/my-feature.e2e.ts`
2. **Import helpers**:
   ```ts
   import { describe, test, expect, beforeAll, afterAll } from "vitest";
   import { provisionStage } from "./helpers/stack.ts";
   ```
3. **Provision stage** in `beforeAll`
4. **Seed flags** needed for your tests
5. **Write tests** using SDK and helpers
6. **Run**: `pnpm --filter @ffp/e2e-node test my-feature`

Example:
```ts
describe("my feature", () => {
  let stage: IsolatedStage;

  beforeAll(async () => {
    stage = await provisionStage({ workspaceKey: "my-feature" });
    await stage.seed.ensureBooleanFlag("my-flag");
  });

  test("flag evaluates correctly", async () => {
    const client = createServerClient({
      baseUrl: stage.resolverUrl,
      serverKey: stage.serverKey,
      subject: { type: "user", id: "test-user" },
    });

    await client.ready();
    const value = client.boolFlag("my-flag", false);
    expect(value).toBeDefined();
  });
});
```

## See Also

- [E2E Overview](./E2E-OVERVIEW.md)
- [E2E Stack](./E2E-STACK.md)
- [E2E Web Tests](./E2E-WEB.md)
- [SDK Node Guide](./SDK-Node.md)
