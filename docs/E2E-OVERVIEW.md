# End-to-End Testing

The Feature Flag Platform uses end-to-end tests to verify SDK behavior across different environments (Node.js, browser) and features (streaming, polling, tokens, etc.).

## Test Architecture

The e2e test suite consists of three parts:

1. **e2e-stack** — Shared test infrastructure (Docker, database, services)
2. **e2e-node** — Node.js SDK tests (Vitest)
3. **e2e-web** — Browser SDK tests (Playwright)

All tests run against a live resolver and admin API, eliminating mocks and verifying real behavior.

## Getting Started

### Prerequisites

- Docker and Docker Compose (for e2e-stack)
- Node 20+
- pnpm

### Running Tests Locally

```bash
# Terminal 1: Start the test stack (runs until you stop it)
pnpm --filter @ffp/e2e-stack start

# Terminal 2: Run Node.js tests
pnpm --filter @ffp/e2e-node test

# Terminal 3: Run Browser tests
pnpm --filter @ffp/e2e-web test
```

Or in one command:

```bash
# Start stack in background and run all e2e tests
pnpm --filter @ffp/e2e-stack start &
sleep 5
pnpm --filter @ffp/e2e-node test
pnpm --filter @ffp/e2e-web test
```

## Test Categories

| Category | App | Runner | Coverage |
|----------|-----|--------|----------|
| **Node.js SDK** | e2e-node | Vitest | Server-mode SDK |
| **Browser SDK** | e2e-web | Playwright | Real browser + network scenarios |
| **Infrastructure** | e2e-stack | CLI | Stack startup, seeding, cleanup |

## E2E Stack

See [E2E-STACK.md](./E2E-STACK.md) for infrastructure setup details.

## Test Suites

### Node.js Tests (`@ffp/e2e-node`)

See [E2E-NODE.md](./E2E-NODE.md) for details.

**Verifies:**
- Server-mode SDK flag evaluation
- Subject changes
- Subject tokens
- Restart resilience and recovery
- Rate limiting behavior

### Browser Tests (`@ffp/e2e-web`)

See [E2E-WEB.md](./E2E-WEB.md) for details.

**Verifies:**
- Browser client flag evaluation
- Real-time updates (SSE streaming)
- Polling fallback
- Reconnection after network failure
- CORS handling
- Subject tokens
- Connection state tracking

## Development Workflow

### Adding a Test

1. **Node.js test:**
   ```bash
   # Add file: apps/e2e-node/test/my-feature.e2e.ts
   pnpm --filter @ffp/e2e-node test my-feature
   ```

2. **Browser test:**
   ```bash
   # Add file: apps/e2e-web/tests/my-feature.spec.ts
   pnpm --filter @ffp/e2e-web test my-feature
   ```

### Debugging

**Node.js:**
```bash
pnpm --filter @ffp/e2e-node test --inspect-brk my-feature
```

**Browser:**
```bash
pnpm --filter @ffp/e2e-web test --debug my-feature
# Opens Playwright inspector
```

### Viewing Test Results

**Node.js:**
```bash
pnpm --filter @ffp/e2e-node test --reporter=verbose
```

**Browser:**
```bash
pnpm --filter @ffp/e2e-web show-report
```

## CI/CD Integration

In CI environments, the test stack is started before running tests:

```yaml
# Example GitHub Actions workflow
- run: pnpm --filter @ffp/e2e-stack start &
- run: sleep 5
- run: pnpm --filter @ffp/e2e-node test
- run: pnpm --filter @ffp/e2e-web test
```

## Troubleshooting

### "Port already in use"
The stack uses fixed ports (8000, 8080, 5432, 6379). Ensure nothing is running:
```bash
# Kill existing stack
pnpm --filter @ffp/e2e-stack stop
```

### "Connection refused to resolver"
The stack takes a few seconds to start. Increase the sleep:
```bash
pnpm --filter @ffp/e2e-stack start & sleep 10
```

### Tests hanging
Check if the stack is running properly:
```bash
docker compose -f apps/e2e-stack/.runtime/docker-compose.yml ps
```

Restart if needed:
```bash
pnpm --filter @ffp/e2e-stack start
```

### Browser test flakiness
Playwright tests can be sensitive to timing. Increase timeouts in `playwright.config.ts`:
```ts
use: {
  timeout: 30_000,  // increase from default
}
```

## Performance

- **Node.js tests**: ~10-20s for full suite
- **Browser tests**: ~1-2 min for full suite (includes startup)
- **Stack startup**: ~10s for services to be ready

## See Also

- [E2E Stack](./E2E-STACK.md) — Infrastructure setup
- [E2E Node Tests](./E2E-NODE.md) — Node.js SDK tests
- [E2E Web Tests](./E2E-WEB.md) — Browser SDK tests
