# E2E Stack Infrastructure

The `@ffp/e2e-stack` provides shared test infrastructure for end-to-end testing. It orchestrates Docker services, seeds test data, and provides utilities for other e2e test suites.

## What It Does

The e2e stack:

1. **Starts Docker services** — admin API, resolver, Postgres, Redis via `docker-compose`
2. **Seeds the database** — creates workspaces, stages, flags, and test data
3. **Exposes test utilities** — `SeedClient`, `HostHandle`, and constants for other tests
4. **Manages lifecycle** — startup, shutdown, and cleanup

## Architecture

```
┌─────────────────────────────────────────────┐
│        e2e-stack CLI (Start/Stop)           │
├─────────────────────────────────────────────┤
│  Docker Compose (PostgreSQL, Redis, etc.)   │
│  Admin API (workspace, stage, flag mgmt)    │
│  Resolver (flag evaluation engine)          │
├─────────────────────────────────────────────┤
│  SeedClient (admin API helper)              │
│  Constants (ports, URLs, credentials)       │
│  Runtime Management (.runtime/stack.json)   │
└─────────────────────────────────────────────┘
         ↓ consumed by
    e2e-node (Node SDK tests)
    e2e-web (Browser SDK tests)
```

## Quick Start

### Start the Stack

```bash
pnpm --filter @ffp/e2e-stack start
```

This will:
1. Start Docker services (visible via `docker ps`)
2. Create `.runtime/stack.json` with service URLs and credentials
3. Create a default workspace and stage
4. Block until services are ready (timeout: 30s)

### Check Service Status

```bash
docker compose -f apps/e2e-stack/.runtime/docker-compose.yml ps
```

### Stop the Stack

```bash
# In the terminal where the stack is running
Ctrl+C

# Or from another terminal
docker compose -f apps/e2e-stack/.runtime/docker-compose.yml down
```

## Exported Utilities

### `SeedClient`

Helper for interacting with the admin API.

```ts
import { SeedClient } from "@ffp/e2e-stack";

const seed = new SeedClient({
  adminApiUrl: "http://localhost:4100",
  adminEmail: "e2e-admin@example.com",
  adminPassword: "e2e-password-123",
});

// Create a workspace
const workspace = await seed.createWorkspace("my-key", "My Workspace");

// Create a stage
const stage = await seed.createStage("my-key", "staging", "Staging");

// Create a flag
const flag = await seed.ensureBooleanFlag("feature-x");

// Configure flag for a stage
await seed.setFlagConfig("feature-x", {
  enabled: true,
  disabledValueIndex: 0,
  defaultServe: { kind: "value", valueIndex: 1 },
  pinned: [],
  rules: [],
});

// Toggle flag
await seed.toggleFlag("feature-x", true);

// Set CORS origins (for browser tests)
await seed.setCorsOrigins(["http://localhost:5180"]);
```

### Constants

Pre-defined URLs and credentials for the test stack.

```ts
import {
  adminApiUrl,      // "http://127.0.0.1:4100"
  resolverUrl,      // "http://127.0.0.1:4101"
  appOrigin,        // "http://127.0.0.1:5180"
  sidecarUrl,       // "http://127.0.0.1:5181"
  databaseUrl,      // "postgres://flags:flags@127.0.0.1:5434/flags"
  redisUrl,         // "redis://127.0.0.1:6381/15"
  adminEmail,       // "e2e-admin@example.com"
  adminPassword,    // "e2e-password-123"
  defaultWorkspaceKey,
  defaultStageKey,
  users,            // ["user-anon", "user-pinned", "user-vip"]
} from "@ffp/e2e-stack";
```

### Runtime Management

The stack writes runtime info to `.runtime/stack.json`:

```json
{
  "adminApiUrl": "http://127.0.0.1:4100",
  "resolverUrl": "http://127.0.0.1:4101",
  "publicKey": "...",
  "serverKey": "...",
  "workspace": { "id": "...", "key": "...", "name": "..." },
  "stage": { "id": "...", "key": "...", "name": "..." }
}
```

Tests can read this to discover service locations:

```ts
import { readRuntime, waitForRuntime } from "@ffp/e2e-stack";

// Wait for stack to be ready
const runtime = await waitForRuntime();
console.log("Resolver at:", runtime.resolverUrl);
```

## Service Details

### Admin API (Port 4100)

Manages workspaces, stages, and flags. Requires authentication via email/password.

- **Base URL**: `http://127.0.0.1:4100`
- **Login endpoint**: `POST /api/v1/auth/login`
- **Workspaces**: `POST /api/v1/workspaces`
- **Stages**: `POST /api/v1/workspaces/:wsKey/stages`
- **Flags**: `POST /api/v1/workspaces/:wsKey/flags`
- **Configs**: `POST /api/v1/workspaces/:wsKey/stages/:stageKey/config`

### Resolver (Port 4101)

Evaluates flags and streams updates. No authentication required for clients.

- **Base URL**: `http://127.0.0.1:4101`
- **Resolve endpoint**: `POST /sdk/resolve` (public key or server key)
- **Stream endpoint**: `GET /sdk/stream` (Bearer token)

### PostgreSQL (Port 5434)

Stores workspaces, stages, flags, rules, and configuration.

- **Connection**: `postgres://flags:flags@127.0.0.1:5434/flags`
- **User**: `flags`
- **Password**: `flags`
- **Database**: `flags`

### Redis (Port 6381)

Caches flag evaluations for performance.

- **Connection**: `redis://127.0.0.1:6381/15`
- **Database**: 15

## Configuration

### Environment Variables

Customize the stack via environment variables (used in `cli.ts`):

```bash
# Service ports
E2E_ADMIN_API_PORT=4100
E2E_RESOLVER_PORT=4101
E2E_APP_PORT=5180

# Database and cache
E2E_DATABASE_URL="postgres://flags:flags@127.0.0.1:5434/flags"
E2E_REDIS_URL="redis://127.0.0.1:6381/15"

# Admin credentials
E2E_ADMIN_EMAIL="e2e-admin@example.com"
E2E_ADMIN_PASSWORD="e2e-password-123"

# Secrets (must be 32 chars)
E2E_COOKIE_SECRET="must-be-32-chars-long-exactly-00"
E2E_STREAM_TOKEN_SECRET="must-be-32-chars-long-exactly-01"
```

### Docker Compose

The stack uses `docker-compose.e2e.yml` to define services:

```yaml
version: "3.9"
services:
  postgres:
    image: postgres:16
    ports:
      - "5434:5432"
    # ...

  redis:
    image: redis:7
    ports:
      - "6381:6379"
    # ...
```

## Debugging

### View Docker Logs

```bash
docker compose -f apps/e2e-stack/.runtime/docker-compose.yml logs -f admin-api
docker compose -f apps/e2e-stack/.runtime/docker-compose.yml logs -f resolver
docker compose -f apps/e2e-stack/.runtime/docker-compose.yml logs -f postgres
```

### Connect to PostgreSQL

```bash
psql "postgres://flags:flags@127.0.0.1:5434/flags"
```

Query flags:
```sql
SELECT id, name, type FROM flags LIMIT 10;
SELECT * FROM flag_values;
SELECT * FROM flag_configs;
```

### Query Redis

```bash
redis-cli -n 15
```

### Inspect Runtime

```bash
cat apps/e2e-stack/.runtime/stack.json
```

## Cleanup

### Stop Services

```bash
pnpm --filter @ffp/e2e-stack stop
# or
docker compose -f apps/e2e-stack/.runtime/docker-compose.yml down
```

### Remove Runtime

```bash
rm -rf apps/e2e-stack/.runtime
```

### Full Clean (including Docker volumes)

```bash
docker compose -f apps/e2e-stack/.runtime/docker-compose.yml down -v
rm -rf apps/e2e-stack/.runtime
```

## Troubleshooting

### "Port already in use"

```bash
# Find what's using the port
lsof -i :4100
# Kill it
kill -9 <PID>

# Or just change the port in constants.ts
```

### "Connection refused" to resolver

1. Check Docker containers are running: `docker ps`
2. Check logs: `docker compose ... logs resolver`
3. Wait a few more seconds (startup can be slow)
4. Increase `stackTimeoutMs` in constants

### "Database migration failed"

1. Check PostgreSQL is running: `docker compose ... logs postgres`
2. Clear the database: `docker compose ... down -v`
3. Restart the stack

### "Stack didn't write runtime.json"

This means the stack failed to start. Check:
1. Docker is running
2. Ports are available
3. Logs have useful errors: `docker compose ... logs`

## Source Code

- `src/cli.ts` — Main CLI entry point, orchestrates startup
- `src/constants.ts` — Configuration and port mappings
- `src/seed.ts` — `SeedClient` class for admin API interaction
- `src/runtime.ts` — Runtime file management and waiting
- `src/index.ts` — Exports utilities for other e2e tests

## See Also

- [E2E Overview](./E2E-OVERVIEW.md)
- [E2E Node Tests](./E2E-NODE.md)
- [E2E Web Tests](./E2E-WEB.md)
