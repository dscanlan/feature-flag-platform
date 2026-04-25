# SDK for Web (Browser)

Use `@ffp/sdk/client` in browsers to evaluate feature flags with real-time updates via streaming or polling.

## Installation

```bash
npm install @ffp/sdk
# or
pnpm add @ffp/sdk
```

For React apps, see [React Guide](./SDK-React.md) instead — it handles subscription and re-rendering automatically.

## Quick Start

```ts
import { createClient } from "@ffp/sdk/client";

const client = createClient({
  baseUrl: "https://resolver.example.com",
  publicKey: "pub_123",
  subject: { type: "user", id: "user-anonymous" },
});

// Start loading flags (optional — done automatically by React provider)
await client.ready();

// Evaluate flags
const isNewCheckout = client.boolFlag("new-checkout", false);
const config = client.jsonFlag("pricing", { tier: "free" });

console.log(isNewCheckout); // true or false
console.log(config); // { tier: "free" } or custom value

// Subscribe to flag changes
client.on("change", ({ key, value }) => {
  console.log(`Flag updated: ${key} =`, value);
  // Re-render UI
});

// Clean up on page unload
window.addEventListener("beforeunload", () => {
  client.close();
});
```

## Configuration

### `createClient(options)`

```ts
interface ClientOptions {
  // Required
  baseUrl: string; // resolver endpoint
  publicKey: string; // public authentication key
  subject: Subject; // entity to evaluate flags for

  // Optional
  subjectToken?: string; // signed token (overrides subject)
  pollIntervalMs?: number; // default 30000 (30 seconds)
  logger?: Logger; // custom logging function
  fetch?: typeof fetch; // custom fetch (for testing)
  streaming?: boolean; // enable SSE (default true)
}
```

### Examples

```ts
// Minimal setup
const client = createClient({
  baseUrl: "https://resolver.myapp.com",
  publicKey: "pub_abc123",
  subject: { type: "user", id: userId },
});

// With custom polling interval
const client = createClient({
  baseUrl: "https://resolver.myapp.com",
  publicKey: "pub_abc123",
  subject: { type: "user", id: userId },
  pollIntervalMs: 10000, // check every 10 seconds
});

// Force polling (disable streaming)
const client = createClient({
  baseUrl: "https://resolver.myapp.com",
  publicKey: "pub_abc123",
  subject: { type: "user", id: userId },
  streaming: false,
});

// With logging
const client = createClient({
  baseUrl: "https://resolver.myapp.com",
  publicKey: "pub_abc123",
  subject: { type: "user", id: userId },
  logger: (level, msg, meta) => {
    if (level === "error" || level === "warn") {
      console.error(`[ffp:${level}]`, msg, meta);
    }
  },
});
```

## API

### `ready(): Promise<void>`

Wait for the initial flag load. Useful to show a loading screen or splash page until flags are available.

```ts
await client.ready();
console.log("Flags loaded, app ready");
```

This is idempotent — calling it multiple times returns the same promise.

### `boolFlag(key: string, defaultValue: boolean): boolean`

Evaluate a boolean flag. Returns the default if not found or wrong type.

```ts
if (client.boolFlag("new-checkout", false)) {
  showNewCheckout();
} else {
  showOldCheckout();
}
```

### `jsonFlag<T>(key: string, defaultValue: T): T`

Evaluate a JSON flag with TypeScript support.

```ts
interface FeatureConfig {
  enabled: boolean;
  maxRetries: number;
}

const config = client.jsonFlag<FeatureConfig>("feature-config", {
  enabled: false,
  maxRetries: 3,
});

console.log(config.maxRetries); // type-safe
```

### `allFlags(): Record<string, unknown>`

Get all cached flags. Useful for debugging or exporting to logs.

```ts
const flags = client.allFlags();
console.log(flags); // { "new-checkout": true, "pricing": {...}, ... }
```

### `getSubject(): Subject`

Get the currently-evaluated subject.

```ts
const subject = client.getSubject();
console.log(subject.id); // "user-abc123"
```

### `setSubject(next: Subject): Promise<void>`

Change the subject (e.g., when a user logs in). All flags are re-evaluated for the new subject immediately.

```ts
// User logs in
await client.setSubject({ type: "user", id: "user-456" });

// Flags are now evaluated for user-456
const isEnabled = client.boolFlag("premium-feature", false);
```

### `setSubjectToken(token: string | null): Promise<void>`

Set a signed subject token (preferred for production). Pass `null` to clear it and revert to raw subject.

```ts
// Backend issues a signed token
const response = await fetch("/api/auth/token", { method: "POST" });
const { token } = await response.json();

// Frontend sends token instead of raw subject
await client.setSubjectToken(token);

// To revert to raw subject
await client.setSubjectToken(null);
```

### `on(event: "ready" | "change" | "error", listener): () => void`

Subscribe to SDK lifecycle events. Returns an unsubscribe function.

```ts
const unsubReady = client.on("ready", () => {
  console.log("Initial flags loaded");
});

const unsubChange = client.on("change", ({ key, value }) => {
  console.log(`${key} changed to`, value);
  // Re-render UI
});

const unsubError = client.on("error", (info) => {
  console.error("Flag resolution failed:", info);
});

// Later, unsubscribe
unsubReady();
unsubChange();
unsubError();
```

### `getState(): ClientSnapshot`

Get the current SDK state including ready, error, and connection state.

```ts
const state = client.getState();

console.log(state.ready); // true/false
console.log(state.error); // null or error object
console.log(state.connectionState); // "connecting"|"streaming"|"polling"|"offline"
console.log(state.version); // version counter
```

### `subscribe(listener: () => void): () => void`

Framework-neutral subscription. The listener fires whenever state changes. Returns an unsubscribe function.

```ts
const unsub = client.subscribe(() => {
  const state = client.getState();
  if (state.ready) {
    console.log("Ready!");
  }
});

// Unsubscribe
unsub();
```

### `close(): void`

Stop polling and streaming. Call on page unload or cleanup.

```ts
window.addEventListener("beforeunload", () => {
  client.close();
});
```

## Patterns

### Vanilla JS / jQuery

```js
import { createClient } from "@ffp/sdk/client";

const client = createClient({
  baseUrl: "/api/resolver",
  publicKey: "pub_123",
  subject: { type: "user", id: currentUserId },
});

// Subscribe to changes
client.on("change", () => {
  renderUI();
});

function renderUI() {
  const isNewCheckout = client.boolFlag("new-checkout", false);
  document.getElementById("checkout-btn").href = isNewCheckout ? "/checkout/v2" : "/checkout/v1";
}

// Initial render
await client.ready();
renderUI();
```

### Svelte

```svelte
<script>
  import { createClient } from "@ffp/sdk/client";

  let flags = {};

  onMount(async () => {
    const client = createClient({
      baseUrl: "/api/resolver",
      publicKey: "pub_123",
      subject: { type: "user", id: userId },
    });

    await client.ready();
    flags = client.allFlags();

    client.on("change", () => {
      flags = { ...client.allFlags() };
    });

    return () => client.close();
  });
</script>

{#if flags["new-checkout"]}
  <NewCheckout />
{:else}
  <OldCheckout />
{/if}
```

### Vue 3

```vue
<script setup>
import { ref, onMounted, onBeforeUnmount } from "vue";
import { createClient } from "@ffp/sdk/client";

const flags = ref({});
let client;

onMounted(async () => {
  client = createClient({
    baseUrl: "/api/resolver",
    publicKey: "pub_123",
    subject: { type: "user", id: userId },
  });

  await client.ready();
  flags.value = client.allFlags();

  client.on("change", () => {
    flags.value = client.allFlags();
  });
});

onBeforeUnmount(() => {
  client?.close();
});
</script>

<template>
  <div>
    <NewCheckout v-if="flags['new-checkout']" />
    <OldCheckout v-else />
  </div>
</template>
```

### Authentication Flow

```ts
let client;

async function login(email, password) {
  // Authenticate
  const res = await fetch("/api/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

  const { userId, token } = await res.json();

  // Initialize SDK for this user
  if (!client) {
    client = createClient({
      baseUrl: "https://resolver.myapp.com",
      publicKey: "pub_123",
      subject: { type: "user", id: userId },
    });
    await client.ready();
  } else {
    // Update existing client to new user
    await client.setSubject({ type: "user", id: userId });
  }

  // Use signed token for subsequent requests
  if (token) {
    await client.setSubjectToken(token);
  }

  showApp();
}

async function logout() {
  await client.setSubject({ type: "user", id: "anonymous" });
  client.setSubjectToken(null);
  showLoginForm();
}
```

## Connection States

The browser client tracks its connection state:

- **connecting**: Initial state, awaiting first successful resolve
- **streaming**: SSE connection is healthy and receiving real-time updates
- **polling**: SSE unavailable (5xx threshold), falling back to periodic fetches
- **offline**: All attempts failing, no connectivity

Monitor state changes:

```ts
client.on("change", () => {
  const state = client.getState();
  updateConnectionIndicator(state.connectionState);
});

function updateConnectionIndicator(state) {
  const icon = {
    streaming: "🟢",
    polling: "🟡",
    offline: "🔴",
    connecting: "⚪",
  }[state];

  document.getElementById("status").textContent = icon;
}
```

## Error Handling

Errors are exposed via state, not thrown:

```ts
const state = client.getState();

if (state.error) {
  console.error("Last error:", state.error);
  // Could be { status: 401 }, { status: 500 }, { err: NetworkError }, etc.
}

// Always safe to call — returns default if error occurs
const enabled = client.boolFlag("feature", false);
```

Subscribe to errors specifically:

```ts
client.on("error", (info) => {
  // info might be { status: 500 }, { err: TypeError }, etc.
  logToSentry(info);
});
```

## Testing

### Mock the Fetch

```ts
import { createClient } from "@ffp/sdk/client";
import { test, expect } from "vitest";

test("returns default for missing flags", async () => {
  const mockFetch = async () =>
    new Response(
      JSON.stringify({
        results: {},
        streamToken: "token",
      }),
    );

  const client = createClient({
    baseUrl: "http://localhost",
    publicKey: "test-key",
    subject: { type: "user", id: "test-user" },
    fetch: mockFetch,
  });

  await client.ready();

  const result = client.boolFlag("missing", true);
  expect(result).toBe(true);
});
```

## Performance Tips

1. **Reuse client**: Create one client per app, not per component
2. **Wait for ready**: Show a skeleton or loading screen until `ready()` completes
3. **Polling interval**: Default 30s is good for most apps; adjust based on flag update frequency
4. **Streaming**: Enabled by default; keeps flags in sync without polling overhead
5. **Subject changes**: Batching multiple subject changes into one `setSubject` call saves requests

## Troubleshooting

### Flags always return default

1. Check `publicKey` is correct
2. Verify resolver is reachable: check network tab in DevTools
3. Confirm subject exists in resolver admin UI
4. Check `client.getState().error` for clues

### High latency in updates

1. Verify SSE is connected: `state.connectionState === "streaming"`
2. If polling, adjust `pollIntervalMs` if latency is acceptable
3. Check resolver server response times

### Memory leaks

1. Always call `client.close()` when done
2. Unsubscribe from `on()` listeners when component unmounts
3. In SPAs, close client on route change if creating per-route clients

## See Also

- [SDK Overview](./SDK.md)
- [React Guide](./SDK-React.md)
- [API Reference](./SDK-API-Reference.md)
- [Examples](../examples/react-app/)
