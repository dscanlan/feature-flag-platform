# SDK API Reference

Complete API reference for the Feature Flag Platform SDK.

## Shared Types

### `Subject`

The entity for which flags are evaluated.

```ts
interface Subject {
  type: string; // "user", "org", "account", or custom
  id: string; // unique identifier
  [key: string]: unknown; // optional attributes for rule evaluation
}
```

Examples:

```ts
{ type: "user", id: "user-123" }
{ type: "org", id: "org-456", tier: "enterprise" }
{ type: "account", id: "acct-789", region: "us-west" }
```

### `ConnectionState`

The current connection status of the client.

```ts
type ConnectionState = "connecting" | "streaming" | "polling" | "offline";
```

- `connecting`: Initial state, awaiting first successful resolve
- `streaming`: SSE connection established and healthy
- `polling`: SSE unavailable, using periodic polling fallback
- `offline`: All attempts failing, no connectivity

### `ClientSnapshot`

Immutable view of the client's lifecycle state.

```ts
interface ClientSnapshot {
  ready: boolean; // true after first successful resolve
  error: unknown | null; // last SDK error (if any)
  connectionState: ConnectionState; // current connection status
  version: number; // monotonic counter, bumps on state change
}
```

### `SdkEvent`

```ts
type SdkEvent = "ready" | "change" | "error";
```

- `ready`: Emitted after the first successful flag resolve
- `change`: Emitted when a flag value changes
- `error`: Emitted when a fetch/stream fails

### `Logger` & `LogLevel`

```ts
type LogLevel = "debug" | "info" | "warn" | "error";
type Logger = (level: LogLevel, msg: string, meta?: unknown) => void;
```

## Browser Client

### `createClient(options: ClientOptions): FlagClient`

Create a browser client instance.

```ts
interface ClientOptions {
  // Required
  baseUrl: string;
  publicKey: string;
  subject: Subject;

  // Optional
  subjectToken?: string; // signed token (overrides subject for /sdk/resolve)
  pollIntervalMs?: number; // default 30000
  logger?: Logger;
  fetch?: typeof fetch; // for testing
  streaming?: boolean; // default true
}
```

**Returns:** `FlagClient` instance

**Example:**

```ts
import { createClient } from "@ffp/sdk/client";

const client = createClient({
  baseUrl: "https://resolver.example.com",
  publicKey: "pub_abc123",
  subject: { type: "user", id: userId },
});
```

### `FlagClient` Interface

#### `ready(): Promise<void>`

Block until the first successful flag resolve.

```ts
await client.ready();
console.log("Flags loaded");
```

Idempotent — multiple calls return the same promise.

#### `boolFlag(key: string, defaultValue: boolean): boolean`

Evaluate a boolean flag.

```ts
const enabled = client.boolFlag("feature-x", false);
```

**Returns:** flag value or `defaultValue` if not found / wrong type

#### `jsonFlag<T>(key: string, defaultValue: T): T`

Evaluate a JSON flag with type inference.

```ts
interface Config {
  tier: string;
}
const config = client.jsonFlag<Config>("config", { tier: "free" });
```

**Returns:** flag value or `defaultValue` if not found / wrong type

#### `allFlags(): Record<string, unknown>`

Get all cached flags.

```ts
const all = client.allFlags();
```

**Returns:** object mapping flag key → value

#### `getSubject(): Subject`

Get the currently-evaluated subject.

```ts
const subject = client.getSubject();
```

#### `setSubject(next: Subject): Promise<void>`

Change the subject and re-fetch flags.

```ts
await client.setSubject({ type: "user", id: "new-user" });
```

#### `setSubjectToken(token: string | null): Promise<void>`

Set a signed subject token. Pass `null` to clear and revert to raw subject.

```ts
await client.setSubjectToken("sjt_abc123...");
```

#### `on(event: SdkEvent, listener: (info: unknown) => void): () => void`

Subscribe to SDK events. Returns unsubscribe function.

```ts
const unsub = client.on("change", ({ key, value }) => {
  console.log(`${key} changed to`, value);
});

unsub(); // Stop listening
```

#### `subscribe(listener: () => void): () => void`

Framework-neutral subscription. Listener fires on any state version bump.

```ts
const unsub = client.subscribe(() => {
  const state = client.getState();
  console.log("State changed, version:", state.version);
});
```

#### `getState(): ClientSnapshot`

Get the current client state.

```ts
const state = client.getState();
if (state.ready && !state.error) {
  // Flags loaded and no errors
}
```

#### `close(): void`

Stop polling and streaming.

```ts
client.close();
```

---

## Server Client

### `createServerClient(options: ServerClientOptions): FlagClient`

Create a Node.js server client instance.

```ts
interface ServerClientOptions {
  // Required
  baseUrl: string;
  serverKey: string;
  subject: Subject;

  // Optional
  pollIntervalMs?: number; // default 30000
  logger?: Logger;
  fetch?: typeof fetch; // for testing
  streaming?: boolean; // default true
}
```

**Returns:** `FlagClient` instance (same interface as browser client)

**Example:**

```ts
import { createServerClient } from "@ffp/sdk/server";

const client = createServerClient({
  baseUrl: process.env.FFP_RESOLVER_URL,
  serverKey: process.env.FFP_SERVER_KEY,
  subject: { type: "user", id: userId },
});
```

### Server-Specific Behavior

The server client has the same `FlagClient` interface but with these differences:

- Uses `serverKey` instead of `publicKey` for authentication
- No SSE (streaming) support — uses polling only
- No connection state transitions (always `"polling"` or `"offline"`)

---

## React Binding

### `FlagsProvider` Component

Wraps your app and manages the SDK client lifecycle.

```tsx
interface FlagsProviderProps {
  client: FlagClient;
  children?: ReactNode;
  autoReady?: boolean; // default true
  closeOnUnmount?: boolean; // default false
}
```

**Example:**

```tsx
import { FlagsProvider } from "@ffp/sdk/react";

<FlagsProvider client={client}>
  <App />
</FlagsProvider>;
```

**Behavior:**

- On mount: calls `client.ready()` if `autoReady` is true
- On unmount: calls `client.close()` if `closeOnUnmount` is true
- Subscribes to client state changes and re-renders descendants

### `useFlags(): FlagsContextValue`

Read flags and SDK state. Must be inside a `<FlagsProvider>`.

```ts
interface FlagsContextValue {
  ready: boolean;
  loading: boolean; // opposite of ready
  error: unknown | null;
  connectionState: ConnectionState;
  boolFlag(key: string, defaultValue: boolean): boolean;
  jsonFlag<T>(key: string, defaultValue: T): T;
  allFlags(): Record<string, unknown>;
}
```

**Throws:** Error if used outside `<FlagsProvider>`

**Example:**

```tsx
const flags = useFlags();
if (flags.loading) return <Spinner />;
if (flags.boolFlag("feature", false)) {
  return <Feature />;
}
```

### `useFlagClient(): FlagClient`

Get the underlying client for write operations. Must be inside a `<FlagsProvider>`.

```ts
const client = useFlagClient();
await client.setSubject({ type: "user", id: newUserId });
```

**Throws:** Error if used outside `<FlagsProvider>`

---

## Configuration

### Environment Variables

Common patterns (not SDK-specific):

```bash
# Resolver endpoint
FFP_RESOLVER_URL=https://resolver.myapp.com

# Browser client public key
VITE_PUBLIC_KEY=pub_abc123

# Server client key
FFP_SERVER_KEY=key_xyz789
```

### Logging

Pass a custom logger to see SDK activity:

```ts
const client = createClient({
  // ...
  logger: (level, msg, meta) => {
    if (level === "error") {
      console.error(`[FFP Error] ${msg}`, meta);
    } else if (process.env.DEBUG) {
      console.log(`[FFP ${level.toUpperCase()}] ${msg}`, meta);
    }
  },
});
```

### Polling Configuration

Control polling behavior:

```ts
const client = createClient({
  // ...
  pollIntervalMs: 10000, // check every 10 seconds (default 30)
  streaming: false, // disable SSE, polling only
});
```

---

## Error Handling

### Error Types

Errors are exposed in `ClientSnapshot.error`:

```ts
// HTTP error
{ status: 401 }
{ status: 500 }

// Network error
{ err: TypeError("Failed to fetch") }

// Other SDK errors
{ code: "...", message: "..." }
```

### Defensive Coding

All flag operations return defaults on error — no exceptions:

```ts
const state = client.getState();

// Always safe
const enabled = client.boolFlag("feature", false);

// Check state separately
if (state.error) {
  logError(state.error);
}
```

---

## Subscription Patterns

### Event-Based (`on`)

```ts
client.on("ready", () => {
  /* initial load done */
});
client.on("change", ({ key, value }) => {
  /* flag changed */
});
client.on("error", (info) => {
  /* fetch failed */
});
```

Suitable for vanilla JS, custom frameworks.

### State-Based (`subscribe`)

```ts
client.subscribe(() => {
  const state = client.getState();
  // Handle state.ready, state.error, state.version, etc.
});
```

Framework-neutral, works with React's `useSyncExternalStore`, etc.

### React Hooks (`useFlags`, `useFlagClient`)

```tsx
const flags = useFlags(); // reactive
const client = useFlagClient(); // access for writes
```

Built-in re-render wiring via React Context.

---

## Version History

### 0.2.0 (Current)

- Added `@ffp/sdk/react` with `FlagsProvider` and hooks
- Added `ClientSnapshot` and `subscribe()` for React integration
- Added `connectionState` tracking in browser client
- Made `streaming` configurable (default true)

### 0.1.0

- Initial release
- Browser and server clients
- Basic flag evaluation

---

## Constants

### `SDK_VERSION`

Current SDK version string.

```ts
import { SDK_VERSION } from "@ffp/sdk";
console.log(SDK_VERSION); // "0.2.0"
```

Available from all subpaths: `@ffp/sdk/client`, `@ffp/sdk/server`, `@ffp/sdk/react`.

---

## TypeScript Support

All exports include full TypeScript types. Use `import type` for types:

```ts
import { createClient } from "@ffp/sdk/client";
import type { FlagClient, ClientOptions, Subject } from "@ffp/sdk/client";

const client: FlagClient = createClient({...});
```

---

## Size Reference

Approximate bundle sizes (minified + gzipped):

- `@ffp/sdk/client`: ~8 KB
- `@ffp/sdk/server`: ~8 KB
- `@ffp/sdk/react`: ~1 KB
- Total (all subpaths): ~10 KB

(Sizes may vary; check with `pnpm --filter @ffp/sdk size`)

---

## See Also

- [Overview](./SDK.md)
- [Node.js Guide](./SDK-Node.md)
- [Web Guide](./SDK-Web.md)
- [React Guide](./SDK-React.md)
