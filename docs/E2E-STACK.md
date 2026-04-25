# E2E Stack Infrastructure

The `@ffp/e2e-stack` workspace package provides shared test infrastructure for
end-to-end testing. It orchestrates Postgres + Redis via docker compose,
spawns admin-api and resolver as Node child processes, seeds a default
workspace + stage, and writes a runtime descriptor that the other e2e suites
read.

## What It Does

When you run `pnpm --filter @ffp/e2e-stack start`, the CLI in
`apps/e2e-stack/src/cli.ts` does the following, in order:

1. **Brings up Docker services** via `docker compose -f docker-compose.e2e.yml
   up -d --wait` — Postgres (host port 5434) and Redis (host port 6381).
2. **Resets the database** by dropping and recreating the `public` schema.
3. **Spawns admin-api** with `pnpm --filter @ffp/admin-api exec node --import
   tsx src/server.ts`, listening on `127.0.0.1:4100`. `MIGRATE_ON_BOOT=true`
   so the schema gets rebuilt.
4. **Spawns resolver** with the equivalent command on `127.0.0.1:4101`.
5. **Seeds** a default workspace (`e2e-web`) and stage (`playwright`) via the
   admin API.
6. **Writes** `apps/e2e-stack/.runtime/stack.json` containing URLs, keys, and
   credentials for the other suites to consume.
7. **Blocks** until SIGINT/SIGTERM, then sends SIGTERM to its admin-api and
   resolver children.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  e2e-stack CLI (foreground process)                     │
│  ├─ admin-api  (Node child process, 127.0.0.1:4100)     │
│  └─ resolver   (Node child process, 127.0.0.1:4101)     │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────────┐
│  Docker Compose (docker-compose.e2e.yml)                │
│  ├─ postgres:16-alpine  (5434 → 5432)                   │
│  └─ redis:7-alpine      (6381 → 6379)                   │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────────┐
│  Library exports (consumed by e2e-node and e2e-web)     │
│  ├─ SeedClient                — admin API helper        │
│  ├─ readRuntime / waitForRuntime — runtime descriptor   │
│  ├─ createSeedClient          — convenience factory     │
│  └─ Constants                 — ports, URLs, creds      │
└─────────────────────────────────────────────────────────┘
```

## Quick Start

### Start the Stack

```bash
pnpm --filter @ffp/e2e-stack start
```

Blocks until ctrl-c. Watch for `[e2e-stack] runtime ready at …/stack.json` in
the output before kicking off tests in another terminal.

### Check Service Status

```bash
docker compose -f apps/e2e-stack/docker-compose.e2e.yml ps
lsof -nP -iTCP:4100,4101 -sTCP:LISTEN
```

### Stop the Stack

```bash
# In the terminal running the CLI
Ctrl+C

# Or, force-stop the docker containers from another terminal
docker compose -f apps/e2e-stack/docker-compose.e2e.yml down
```

The CLI handles SIGINT/SIGTERM by killing its admin-api and resolver children
before exiting. There is no separate `stop` script — the CLI is the lifecycle
owner.

## Exported Utilities

`apps/e2e-stack/src/index.ts` re-exports everything from `constants.ts`,
`runtime.ts`, and `seed.ts`. The most useful entry points:

### `SeedClient`

Authenticated helper for the admin API. Bound to a specific
workspace + stage.

```ts
import { SeedClient } from "@ffp/e2e-stack";

const seed = new SeedClient({
  adminApiUrl: "http://127.0.0.1:4100",
  resolverUrl: "http://127.0.0.1:4101",
  publicKey: "<stage public key>",
  workspaceKey: "my-workspace",
  stageKey: "my-stage",
  adminEmail: "e2e-admin@example.com",
  adminPassword: "e2e-password-123",
});

// Workspace / stage management
await seed.ensureWorkspace("my-workspace", "My Workspace");
await seed.ensureStageForWorkspace("my-workspace", "my-stage", "My Stage");

// Flag management (operates on the bound workspace + stage)
await seed.ensureBooleanFlag("new-checkout");
await seed.ensureJsonFlag("pricing", [{ value: { tier: "free" } }, { value: { tier: "pro" } }]);
await seed.setFlagConfig("new-checkout", {
  enabled: true,
  disabledValueIndex: 0,
  defaultServe: { kind: "value", valueIndex: 1 },
  pinned: [],
  rules: [],
});
await seed.toggleFlag("new-checkout", true);

// CORS allow-list (used by browser tests)
await seed.setCorsOrigins(["http://127.0.0.1:5180"]);

// Wait for a value to propagate
await seed.waitForBooleanFlagValue("new-checkout", true);
```

### `createSeedClient(options?)`

Convenience factory that reads `stack.json` and constructs a `SeedClient`
preconfigured with the runtime defaults.

```ts
import { createSeedClient } from "@ffp/e2e-stack";

const { runtime, seed } = await createSeedClient();
await seed.ensureBooleanFlag("new-checkout");
```

### Runtime descriptor

```ts
import { readRuntime, waitForRuntime, type StackRuntime } from "@ffp/e2e-stack";

// Wait for stack.json to appear (default 30s)
const runtime: StackRuntime = await waitForRuntime();
console.log("Resolver at:", runtime.resolverUrl);

// Or read it without waiting
const r = await readRuntime();
```

`StackRuntime` shape (see `apps/e2e-stack/src/runtime.ts`):

```ts
interface StackRuntime {
  adminApiUrl: string;
  resolverUrl: string;
  appOrigin: string;
  sidecarUrl: string;
  adminEmail: string;
  adminPassword: string;
  workspaceKey: string;
  stageKey: string;
  publicKey: string;
  serverKey: string;
  subjectSigningSecret: string;
  pollIntervalMs: number;
  users: string[];
}
```

### Constants

```ts
import {
  adminApiUrl,        // "http://127.0.0.1:4100"
  resolverUrl,        // "http://127.0.0.1:4101"
  appOrigin,          // "http://127.0.0.1:5180"
  sidecarUrl,         // "http://127.0.0.1:5181"
  databaseUrl,        // "postgres://flags:flags@127.0.0.1:5434/flags"
  redisUrl,           // "redis://127.0.0.1:6381/15"
  adminEmail,         // "e2e-admin@example.com"
  adminPassword,      // "e2e-password-123"
  defaultWorkspaceKey,// "e2e-web"
  defaultStageKey,    // "playwright"
  users,              // ["user-anon", "user-pinned", "user-vip"]
  stackTimeoutMs,     // 30_000
} from "@ffp/e2e-stack";
```

## Service Details

### Admin API (4100)

Fastify service that owns Postgres writes. Email/password auth via cookie.

- Base URL: `http://127.0.0.1:4100`
- Login: `POST /api/v1/auth/login`
- Workspaces: `POST/GET /api/v1/workspaces`, `POST /api/v1/workspaces/:wsKey/stages`
- Flags: `POST/GET /api/v1/workspaces/:wsKey/flags`
- Stage config: `PUT /api/v1/workspaces/:wsKey/flags/:flagKey/stages/:stageKey`
- Toggle: `POST /api/v1/workspaces/:wsKey/flags/:flagKey/stages/:stageKey/toggle`

Spawned by the CLI with `MIGRATE_ON_BOOT=true`, `ADMIN_EMAIL`/`ADMIN_PASSWORD`
seeded from the constants above.

### Resolver (4101)

Fastify service that evaluates flags and streams updates. Authenticated by
`pub-` (browser) or `srv-` (server) keys at the SDK boundary.

- Base URL: `http://127.0.0.1:4101`
- `POST /sdk/resolve` — flag evaluation (Bearer pub- or srv-)
- `GET /sdk/stream` — SSE updates (Bearer with stream subscription token)

Spawned with hardcoded `RATE_LIMIT_RPS=10000`, `RATE_LIMIT_BURST=10000` so
tests don't get throttled, plus `STREAM_TOKEN_SECRET` from the constants.

### PostgreSQL (5434)

```
postgres://flags:flags@127.0.0.1:5434/flags
```

Runs `postgres:16-alpine` from `docker-compose.e2e.yml`. The CLI drops and
recreates `public` on every start so each run gets a clean schema.

### Redis (6381)

```
redis://127.0.0.1:6381/15
```

Runs `redis:7-alpine`. Used by resolver for caching / fan-out.

## Configuration

The stack constants are **hardcoded** in `apps/e2e-stack/src/constants.ts`.
There are no `E2E_*` env vars — overriding ports or credentials means editing
that file. The intent is that e2e tests are reproducible and don't depend on
the developer's local environment.

The docker compose definition lives at
`apps/e2e-stack/docker-compose.e2e.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: flags
      POSTGRES_PASSWORD: flags
      POSTGRES_DB: flags
    ports: ["5434:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U flags -d flags"]
      interval: 2s
      timeout: 3s
      retries: 20
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    ports: ["6381:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 2s
      timeout: 3s
      retries: 20
```

## Debugging

### View Docker Logs

```bash
docker compose -f apps/e2e-stack/docker-compose.e2e.yml logs -f postgres
docker compose -f apps/e2e-stack/docker-compose.e2e.yml logs -f redis
```

admin-api and resolver logs come through the foreground CLI's stdout/stderr
(prefixed `[admin-api]` and `[resolver]`).

### Connect to Postgres

```bash
psql "postgres://flags:flags@127.0.0.1:5434/flags"
```

```sql
SELECT id, key, name FROM flags LIMIT 10;
SELECT * FROM flag_stage_configs;
```

### Query Redis

```bash
redis-cli -p 6381 -n 15
```

### Inspect Runtime

```bash
cat apps/e2e-stack/.runtime/stack.json
```

## Cleanup

```bash
# Containers
docker compose -f apps/e2e-stack/docker-compose.e2e.yml down

# Containers + volumes (full clean)
docker compose -f apps/e2e-stack/docker-compose.e2e.yml down -v

# Runtime descriptor
rm -rf apps/e2e-stack/.runtime
```

## Troubleshooting

### "Port already in use"

```bash
lsof -nP -iTCP:4100,4101,5434,6381 -sTCP:LISTEN
```

If admin-api or resolver from a previous crashed run is still bound,
SIGTERM/SIGKILL it. The Node-process group hardening in
`apps/e2e-node/test/helpers/global-setup.ts` should prevent this in normal
test runs.

### "Connection refused" to resolver

1. Confirm Postgres + Redis are healthy: `docker compose -f apps/e2e-stack/docker-compose.e2e.yml ps`
2. Confirm admin-api booted: it must finish migrations before resolver answers requests
3. Tail the foreground CLI output — admin-api / resolver crashes surface there

### "Database migration failed"

```bash
docker compose -f apps/e2e-stack/docker-compose.e2e.yml down -v
pnpm --filter @ffp/e2e-stack start
```

### "Stack didn't write `stack.json`"

The CLI failed before reaching `writeRuntime`. Check the foreground output for
admin-api / resolver boot errors.

## Source Code

- `src/cli.ts` — CLI entry point; orchestrates startup + teardown
- `src/constants.ts` — Hardcoded ports, URLs, credentials
- `src/runtime.ts` — `writeRuntime` / `readRuntime` / `waitForRuntime`
- `src/seed.ts` — `SeedClient` and `createSeedClient`
- `src/index.ts` — Re-exports the public surface

## See Also

- [E2E Overview](./E2E-OVERVIEW.md)
- [E2E Node Tests](./E2E-NODE.md)
- [E2E Web Tests](./E2E-WEB.md)
