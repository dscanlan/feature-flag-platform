# SDK for Node.js

Use `@ffp/sdk/server` in Node.js backends to evaluate feature flags server-side.

## Installation

```bash
npm install @ffp/sdk
# or
pnpm add @ffp/sdk
```

## Quick Start

```ts
import { createServerClient } from "@ffp/sdk/server";

const client = createServerClient({
  baseUrl: "https://resolver.example.com",
  serverKey: process.env.FFP_SERVER_KEY,
  subject: { type: "user", id: "user-123" },
});

// Wait for initial load
await client.ready();

// Evaluate flags
const isNewCheckout = client.boolFlag("new-checkout", false);
const config = client.jsonFlag("pricing", { tier: "free" });

console.log(isNewCheckout); // true or false
console.log(config); // { tier: "free" } or custom value

// Clean up when shutting down
client.close();
```

## Configuration

### `createServerClient(options)`

```ts
interface ServerClientOptions {
  // Required
  baseUrl: string;              // resolver endpoint
  serverKey: string;            // server-only authentication key
  subject: Subject;             // entity to evaluate flags for

  // Optional
  pollIntervalMs?: number;      // default 30000 (30 seconds)
  logger?: Logger;              // custom logging function
  fetch?: typeof fetch;         // custom fetch (for testing)
  streaming?: boolean;          // enable SSE (default true)
}
```

### Examples

```ts
// Minimal setup
const client = createServerClient({
  baseUrl: "https://resolver.myapp.com",
  serverKey: process.env.FFP_SERVER_KEY!,
  subject: { type: "user", id: userId },
});

// With logging
const client = createServerClient({
  baseUrl: "https://resolver.myapp.com",
  serverKey: process.env.FFP_SERVER_KEY!,
  subject: { type: "user", id: userId },
  logger: (level, msg, meta) => {
    console.log(`[ffp:${level}]`, msg, meta);
  },
});

// Polling only (disable streaming)
const client = createServerClient({
  baseUrl: "https://resolver.myapp.com",
  serverKey: process.env.FFP_SERVER_KEY!,
  subject: { type: "user", id: userId },
  streaming: false,
  pollIntervalMs: 60000, // check every minute
});
```

## API

### `ready(): Promise<void>`

Block until the initial flag set is loaded from the resolver. Useful at startup to ensure flags are available before handling requests.

```ts
await client.ready();
console.log("Flags loaded, ready to serve requests");
```

### `boolFlag(key: string, defaultValue: boolean): boolean`

Evaluate a boolean flag. Returns the default if the flag is not found or is the wrong type.

```ts
const enabled = client.boolFlag("new-checkout", false);
if (enabled) {
  // new code path
}
```

### `jsonFlag<T>(key: string, defaultValue: T): T`

Evaluate a JSON flag with type safety. Returns the default if the flag is not found or is the wrong type.

```ts
interface PricingConfig {
  tier: string;
  markup: number;
}

const pricing = client.jsonFlag<PricingConfig>("pricing", {
  tier: "free",
  markup: 0,
});

console.log(pricing.tier);
```

### `allFlags(): Record<string, unknown>`

Retrieve all cached flags as an object. Useful for debugging or bulk operations.

```ts
const all = client.allFlags();
console.log(Object.keys(all)); // ["new-checkout", "pricing", ...]
```

### `getSubject(): Subject`

Get the currently-evaluated subject.

```ts
const subject = client.getSubject();
console.log(subject); // { type: "user", id: "user-123" }
```

### `setSubject(next: Subject): Promise<void>`

Change the subject and re-evaluate flags. The SDK immediately fetches new flags for the new subject. Awaiting is optional but recommended to know when the fetch completes.

```ts
await client.setSubject({ type: "user", id: "user-456" });
const newFlags = client.boolFlag("feature", false); // evaluated for user-456
```

### `on(event: "ready" | "change" | "error", listener): () => void`

Subscribe to SDK lifecycle events.

```ts
client.on("ready", () => {
  console.log("Initial load complete");
});

client.on("change", ({ key, value }) => {
  console.log(`Flag changed: ${key} =`, value);
});

client.on("error", (info) => {
  console.error("SDK error:", info);
});
```

### `getState(): ClientSnapshot`

Get the current client state (ready, error, connectionState, version).

```ts
const state = client.getState();
console.log(state.ready);            // boolean
console.log(state.error);            // unknown | null
console.log(state.connectionState);  // "connecting" | "streaming" | "polling" | "offline"
```

### `subscribe(listener: () => void): () => void`

Framework-neutral subscription. The listener fires whenever the state version bumps. Returns an unsubscribe function.

```ts
const unsub = client.subscribe(() => {
  const state = client.getState();
  console.log("State changed, version:", state.version);
});

// Later, unsubscribe
unsub();
```

### `close(): void`

Stop polling and streaming. Call when the server shuts down.

```ts
process.on("SIGTERM", () => {
  client.close();
});
```

## Patterns

### Express Middleware

```ts
import express from "express";
import { createServerClient } from "@ffp/sdk/server";

const app = express();
const client = createServerClient({
  baseUrl: process.env.FFP_RESOLVER_URL!,
  serverKey: process.env.FFP_SERVER_KEY!,
  subject: { type: "user", id: "anonymous" }, // default
});

// Startup
await client.ready();

// Middleware to set subject per request
app.use((req, res, next) => {
  const userId = req.user?.id || "anonymous";
  void client.setSubject({ type: "user", id: userId });
  next();
});

// Route using flags
app.get("/api/checkout", (req, res) => {
  const isEnabled = client.boolFlag("new-checkout", false);
  res.json({
    checkoutUrl: isEnabled ? "/checkout-v2" : "/checkout-v1",
  });
});

// Shutdown
process.on("SIGTERM", () => {
  client.close();
});
```

### Multi-Tenant Resolution

For systems with multiple orgs, resolve flags per org:

```ts
async function getOrgFlags(orgId: string) {
  await client.setSubject({ type: "org", id: orgId });
  return {
    newCheckout: client.boolFlag("new-checkout", false),
    config: client.jsonFlag("config", {}),
  };
}

const flags = await getOrgFlags("org-123");
```

### Startup Health Check

```ts
async function startup() {
  try {
    await Promise.race([
      client.ready(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), 5000)
      ),
    ]);
    console.log("Flags loaded");
  } catch (err) {
    console.error("Failed to load flags:", err);
    process.exit(1);
  }
}
```

## Error Handling

The SDK does not throw on flag evaluation. Instead:

1. **Missing flag**: returns the provided default value
2. **Wrong type**: logs a warning, returns the default
3. **Network error**: `getState().error` is set, polling/streaming continues
4. **No ready yet**: all flags return defaults until the first successful fetch

```ts
// Safe to call even before ready()
const safe = client.boolFlag("unknown-flag", true); // always true

// Check state if you need to know about errors
const state = client.getState();
if (!state.ready) {
  console.log("Waiting for initial load...");
}
if (state.error) {
  console.error("Last error:", state.error);
}
```

## Testing

### Mock the Fetch

```ts
import { createServerClient } from "@ffp/sdk/server";
import { test, expect } from "vitest";

test("handles missing flags", async () => {
  const mockFetch = async () =>
    new Response(JSON.stringify({ results: {} }));

  const client = createServerClient({
    baseUrl: "http://localhost",
    serverKey: "test-key",
    subject: { type: "user", id: "test-user" },
    fetch: mockFetch,
  });

  await client.ready();

  // Missing flag returns default
  const result = client.boolFlag("missing", true);
  expect(result).toBe(true);
});
```

## Performance

- **First flag call**: If `ready()` hasn't been called, returns the default (no blocking)
- **Polling**: Low overhead, default 30s interval (configurable)
- **Streaming**: Requires SSE support; falls back to polling if unavailable
- **Memory**: Cache is only as large as the resolved flag set

## Troubleshooting

### Flags not updating
1. Verify `serverKey` is correct
2. Check resolver connectivity: `client.getState().error`
3. Confirm subject changes with `client.getSubject()`
4. Review logs: pass a `logger` function to see SDK activity

### High latency
1. Try `streaming: false` to disable SSE overhead
2. Increase `pollIntervalMs` if immediate updates aren't needed
3. Move resolver closer (geographically or via CDN)

### Memory leaks
1. Always call `client.close()` on shutdown
2. Unsubscribe from `on(...)` listeners when done
3. For short-lived clients (per-request), create and destroy per request or use a singleton

## See Also

- [SDK Overview](./SDK.md)
- [API Reference](./SDK-API-Reference.md)
- [Examples](../examples/node-server/)
