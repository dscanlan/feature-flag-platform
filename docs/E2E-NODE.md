# E2E Node Tests

The `@ffp/e2e-node` package contains end-to-end tests for the server-side SDK
(`@ffp/sdk/server`). Tests run against a live admin-api and resolver, with
each spec spawning its own host process that uses the SDK and exercises real
flag evaluation, propagation, and error handling.

## Quick Start

The test suite's `globalSetup` (`apps/e2e-node/test/helpers/global-setup.ts`)
auto-starts the e2e-stack if one isn't already healthy, so the simplest path
is just:

```bash
pnpm --filter @ffp/e2e-node test
```

If you want to skip the auto-start and reuse a long-running stack:

```bash
# Terminal 1 — leave running
pnpm --filter @ffp/e2e-stack start

# Terminal 2 — globalSetup detects the existing stack and reuses it (when CI is unset)
pnpm --filter @ffp/e2e-node test
```

### Run Specific Tests

```bash
# Run a single file
pnpm --filter @ffp/e2e-node exec vitest run test/server-mode.e2e.ts

# Match by name (vitest's -t flag)
pnpm --filter @ffp/e2e-node exec vitest run -t "boolean flag toggle"

# Verbose
pnpm --filter @ffp/e2e-node exec vitest run --reporter=verbose
```

### Stream child-process logs

The host and spawned resolver child processes are silent by default. Set
`E2E_DEBUG=true` to see their stdout/stderr inline:

```bash
E2E_DEBUG=true pnpm --filter @ffp/e2e-node test
```

## Test Suites

All specs live in `apps/e2e-node/test/*.e2e.ts`. Each describe block uses a
unique workspace key so cross-file isolation survives a missed teardown.

### `server-mode.e2e.ts`

Tests the fundamental behavior of the server-mode SDK against a live
resolver, with a real Node host process consuming the SDK.

- `boolean flag toggle propagates within 1s`
- `JSON flag round-trips and reacts to default changes`
- `composite subject resolves the pinned value when present`
- `calling boolFlag on a JSON flag returns the default and logs WRONG_TYPE`

### `persistence.e2e.ts`

Verifies that subjects flowing through `/sdk/resolve` get persisted and
exposed via the admin API.

- `five distinct user subjects show up via the admin API in last_seen DESC order`
- `composite subject expands to one row per typed sub-subject`
- `re-resolving the same subject replaces (not merges) its attributes`

### `subject-token.e2e.ts`

Exercises the signed subject-token flow that lets a Node backend hand the
browser a `sjt-` token without leaking the stage's signing secret.

- `a server-signed sjt- token resolves the pinned value via /sdk/resolve`
- `rotating the signing secret invalidates tokens minted with the old one`

### `restart-resilience.e2e.ts`

Spawns a dedicated resolver, kills it mid-test, and confirms the SDK keeps
serving cached values until it comes back.

- `resolver kill keeps cached values; restart → next change propagates`

### `rate-limit.e2e.ts`

Spawns a resolver with a low rate-limit budget and confirms 429 responses
surface through the SDK error path while cached values keep flowing.

- `burst exhaustion → 429 → cached value still served`

## Test Helpers

The `apps/e2e-node/test/helpers/` directory exports four helpers:

### `provisionStage(opts)` — `helpers/stack.ts`

Creates a fresh workspace + stage scoped to a single test file. The returned
`SeedClient` is preconfigured against the new workspace + stage so test code
reads naturally.

```ts
import { provisionStage, type IsolatedStage } from "./helpers/stack.ts";

const stage: IsolatedStage = await provisionStage({
  workspaceKey: "e2e-node-my-feature-1",
  // optional:
  // workspaceName?, stageKey?, stageName?, resolverUrl?
});

// stage.seed         — SeedClient bound to this workspace + stage
// stage.workspace    — Workspace
// stage.stage        — Stage
// stage.publicKey    — pub- key for /sdk/resolve
// stage.serverKey    — srv- key for server-mode
// stage.subjectSigningSecret — for sjt- tokens
// stage.adminApiUrl  — e2e-stack admin URL
// stage.resolverUrl  — e2e-stack resolver URL
```

The helper re-exports `adminApiUrl`, `adminEmail`, `adminPassword`,
`resolverUrl`, `SeedClient`, `waitForRuntime`, and `StackRuntime` from
`@ffp/e2e-stack` for convenience.

### `spawnHost(opts)` — `helpers/host.ts`

Spawns the harness host app (`apps/e2e-node/src/app.ts`) as a Node child
process via `node --import tsx`. Picks an ephemeral port, parses
`E2E_HOST_LISTENING port=<n>` from stdout, and returns a handle.

```ts
import { spawnHost, type HostHandle } from "./helpers/host.ts";

const host: HostHandle = await spawnHost({
  resolverUrl: stage.resolverUrl,
  serverKey: stage.serverKey,
  publicKey: stage.publicKey, // optional
  env: { SDK_STREAMING: "false", SDK_POLL_MS: "1000" }, // extra env
  readyTimeoutMs: 15_000, // optional, defaults to 15s
});

// host.url   — "http://127.0.0.1:<port>"
// host.port  — number
// host.child — ChildProcess
// host.output() — accumulated stdout/stderr
// await host.stop()
```

Set `E2E_DEBUG=true` to mirror the host's stdout/stderr to your terminal.

### `spawnResolver(opts)` — `helpers/resolver.ts`

Spawns an isolated resolver process so tests can kill/restart it or pin a low
rate-limit budget without disturbing the shared e2e-stack resolver. Postgres
+ Redis are still shared so the spawned resolver sees the same flag config
the test seeded via the admin API.

```ts
import { spawnResolver, type ResolverHandle } from "./helpers/resolver.ts";
import { databaseUrl, redisUrl, streamTokenSecret } from "@ffp/e2e-stack";

const resolver: ResolverHandle = await spawnResolver({
  databaseUrl,
  redisUrl,
  streamTokenSecret,
  rateLimitRps: 5,    // optional, defaults to 10_000
  rateLimitBurst: 10, // optional, defaults to 10_000
  port: 4202,         // optional, defaults to ephemeral
  readyTimeoutMs: 30_000,
});

// resolver.url, resolver.port, resolver.child
// resolver.output(), await resolver.stop()
```

### `globalSetup` / `teardown` — `helpers/global-setup.ts`

Hooked up via `apps/e2e-node/vitest.config.ts`:

```ts
test: {
  globalSetup: "./test/helpers/global-setup.ts",
  pool: "forks",
  poolOptions: { forks: { singleFork: true } },
  fileParallelism: false,
}
```

Detects an existing healthy stack and reuses it locally; in CI it always
restarts from a clean slate. Spawns the stack as a detached child with a
process-group teardown so admin-api / resolver children get cleaned up.

## Test Patterns

### Setup with isolated workspace

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { spawnHost, type HostHandle } from "./helpers/host.ts";
import { provisionStage, type IsolatedStage } from "./helpers/stack.ts";

describe("my feature", () => {
  let stage: IsolatedStage;
  let host: HostHandle;

  beforeAll(async () => {
    stage = await provisionStage({ workspaceKey: "e2e-node-my-feature-1" });
    await stage.seed.ensureBooleanFlag("my-flag");
    await stage.seed.setFlagConfig("my-flag", {
      enabled: true,
      disabledValueIndex: 0,
      defaultServe: { kind: "value", valueIndex: 1 },
      pinned: [],
      rules: [],
    });

    host = await spawnHost({
      resolverUrl: stage.resolverUrl,
      serverKey: stage.serverKey,
      publicKey: stage.publicKey,
    });
  });

  afterAll(async () => {
    await host?.stop();
  });

  test("flag evaluates", async () => {
    const r = await fetch(`${host.url}/?user=alice`).then((res) => res.json());
    expect(r.checkout).toBe(true);
  });
});
```

### Waiting for async propagation

There's no shared `waitFor` helper — each test file rolls its own tiny poll
loop because the conditions and timeouts are case-specific:

```ts
async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}
```

Or use the `SeedClient`'s built-ins when they fit:

```ts
await stage.seed.waitForBooleanFlagValue("new-checkout", true);
await stage.seed.waitForCors("http://127.0.0.1:5180", true);
```

## Configuration

`apps/e2e-node/vitest.config.ts`:

```ts
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.e2e.ts"],
    testTimeout: 60_000,
    hookTimeout: 90_000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    globalSetup: "./test/helpers/global-setup.ts",
  },
});
```

Tests run **serially in a single fork**. Two reasons: every test spawns
real child processes, and many mutate shared resolver state via the admin
API. Parallelising would just produce flaky races.

## Debugging

### Stream child-process output

```bash
E2E_DEBUG=true pnpm --filter @ffp/e2e-node test
```

Prefixes `[host]` and `[resolver]` are added to each line.

### Inspect with the Node debugger

```bash
pnpm --filter @ffp/e2e-node exec vitest run --inspect-brk test/server-mode.e2e.ts
```

Then connect via `chrome://inspect` or your IDE.

### Print SDK state from the host

The harness host (`apps/e2e-node/src/app.ts`) exposes
`/debug/last-warn` and `/debug/reset` for assertions on logged warnings;
extend it if you need more introspection rather than mocking around the SDK.

## Troubleshooting

### "Connection refused"

The e2e-stack isn't running. The globalSetup should auto-start it; if it
didn't (e.g. you're running a single test outside vitest), start it manually:

```bash
pnpm --filter @ffp/e2e-stack start
```

### "Workspace already exists"

You re-ran a test that left a workspace behind. Either bump the workspace key
suffix (`e2e-node-my-feature-1` → `…-2`) or `provisionStage` will return the
existing one (it falls back to `ensureWorkspace` on 409).

### "host app did not listen within 15000ms"

The host app crashed during boot. Re-run with `E2E_DEBUG=true` to see why —
typically a missing env var or a resolver that isn't accepting connections.

### Test flakiness around timing

Tests measure flag-propagation latency. If your machine is under load:

1. Bump the per-call `waitFor` timeout in the test (1.5s → 3s)
2. Make sure no other process is hitting the resolver (`lsof -i :4101`)
3. Confirm Redis isn't stuck swapping (`redis-cli -p 6381 info memory`)

## Performance

- Cold suite: ~15–25s (stack startup dominates)
- Warm suite (stack already running): ~10–15s

## See Also

- [E2E Overview](./E2E-OVERVIEW.md)
- [E2E Stack](./E2E-STACK.md)
- [E2E Web Tests](./E2E-WEB.md)
- [SDK Node Guide](./SDK-Node.md)
