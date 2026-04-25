# SDK for React

The React SDK (`@ffp/sdk/react`) provides a provider and hooks for evaluating feature flags in React 18+ apps. It eliminates the boilerplate of manually managing client subscriptions and re-renders.

## Installation

```bash
npm install @ffp/sdk
# or
pnpm add @ffp/sdk
```

React is a peer dependency and must be installed separately.

## Quick Start

```tsx
import { createClient } from "@ffp/sdk/client";
import { FlagsProvider, useFlags } from "@ffp/sdk/react";

// Create client once at module level
const client = createClient({
  baseUrl: "https://resolver.example.com",
  publicKey: "pub_123",
  subject: { type: "user", id: "user-anon" },
});

// Wrap app with provider
function App() {
  return (
    <FlagsProvider client={client}>
      <Checkout />
    </FlagsProvider>
  );
}

// Use flags inside provider tree
function Checkout() {
  const flags = useFlags();

  if (flags.loading) return <p>Loading flags…</p>;

  return (
    <div>
      {flags.boolFlag("new-checkout", false) ? (
        <NewCheckout />
      ) : (
        <OldCheckout />
      )}
    </div>
  );
}
```

## Provider Setup

### `FlagsProvider`

Wraps your app and manages the SDK client lifecycle. Call `client.ready()` on mount and subscribe to re-renders automatically.

```tsx
interface FlagsProviderProps {
  client: FlagClient;
  children?: ReactNode;
  /** Call client.ready() on mount. Default true. */
  autoReady?: boolean;
  /** Call client.close() on unmount. Default false. */
  closeOnUnmount?: boolean;
}
```

### Examples

```tsx
// Minimal setup
<FlagsProvider client={client}>
  <App />
</FlagsProvider>

// With options
<FlagsProvider
  client={client}
  autoReady={true}
  closeOnUnmount={false}
>
  <App />
</FlagsProvider>

// Singleton client (created once at app startup)
function RootLayout() {
  const [client] = useState(() =>
    createClient({
      baseUrl: "https://resolver.example.com",
      publicKey: "pub_123",
      subject: { type: "user", id: userId },
    })
  );

  return (
    <FlagsProvider client={client} closeOnUnmount={false}>
      <Router />
    </FlagsProvider>
  );
}
```

## Hooks

### `useFlags()`

Read flags and SDK state. Must be called inside a `<FlagsProvider>`.

```ts
interface FlagsContextValue {
  // State
  ready: boolean;                   // true after initial load
  loading: boolean;                 // opposite of ready
  error: unknown | null;            // last SDK error
  connectionState: ConnectionState; // "connecting"|"streaming"|"polling"|"offline"

  // Flag methods
  boolFlag(key: string, defaultValue: boolean): boolean;
  jsonFlag<T>(key: string, defaultValue: T): T;
  allFlags(): Record<string, unknown>;
}
```

```tsx
function Feature() {
  const flags = useFlags();

  // Check state
  if (flags.loading) return <Skeleton />;
  if (flags.error) return <ErrorFallback error={flags.error} />;

  // Use flags
  const isEnabled = flags.boolFlag("feature-x", false);
  const config = flags.jsonFlag("config", {});

  return <Component enabled={isEnabled} config={config} />;
}
```

### `useFlagClient()`

Get the underlying client for write-side operations like changing subject. Must be called inside a `<FlagsProvider>`.

```ts
function ProfileSwitcher() {
  const client = useFlagClient();
  const flags = useFlags();

  return (
    <select onChange={(e) => void client.setSubject({ type: "user", id: e.target.value })}>
      <option>Select user</option>
      {users.map((user) => (
        <option key={user.id} value={user.id}>
          {user.name}
        </option>
      ))}
    </select>
  );
}
```

## Common Patterns

### Loading State

```tsx
function App() {
  const flags = useFlags();

  if (flags.loading) {
    return <LoadingScreen />;
  }

  return <MainApp />;
}
```

### Feature Flags

```tsx
function Feature() {
  const flags = useFlags();

  if (flags.boolFlag("show-feature", false)) {
    return <NewFeature />;
  }

  return <OldFeature />;
}
```

### JSON Configuration

```tsx
interface Theme {
  primary: string;
  dark: boolean;
}

function ThemeProvider({ children }) {
  const flags = useFlags();
  const theme = flags.jsonFlag<Theme>("theme", {
    primary: "#3b82f6",
    dark: false,
  });

  return (
    <ThemeContext.Provider value={theme}>
      {children}
    </ThemeContext.Provider>
  );
}
```

### Dynamic Subject Changes

```tsx
function UserSwitcher() {
  const client = useFlagClient();
  const flags = useFlags();

  const handleUserChange = async (userId: string) => {
    await client.setSubject({ type: "user", id: userId });
    // flags automatically re-render with new values
  };

  return (
    <select onChange={(e) => void handleUserChange(e.target.value)}>
      {users.map((user) => (
        <option key={user.id} value={user.id}>
          {user.name}
        </option>
      ))}
    </select>
  );
}
```

### Subject Tokens

```tsx
function LoginHandler() {
  const client = useFlagClient();

  const handleLogin = async (email: string, password: string) => {
    // Authenticate with backend
    const response = await fetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    const { userId, token } = await response.json();

    // Update SDK subject
    await client.setSubject({ type: "user", id: userId });

    // Use signed token for subsequent requests
    if (token) {
      await client.setSubjectToken(token);
    }
  };

  return <LoginForm onSubmit={handleLogin} />;
}
```

### Connection Status Indicator

```tsx
function ConnectionIndicator() {
  const flags = useFlags();

  const status = {
    streaming: { icon: "🟢", label: "Connected" },
    polling: { icon: "🟡", label: "Polling" },
    offline: { icon: "🔴", label: "Offline" },
    connecting: { icon: "⚪", label: "Connecting" },
  }[flags.connectionState] || { icon: "?", label: "Unknown" };

  return (
    <div title={status.label}>
      {status.icon}
    </div>
  );
}
```

### Error Boundaries

```tsx
class FlagsErrorBoundary extends React.Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <div>Failed to load flags. Using defaults.</div>;
    }
    return this.props.children;
  }
}

export function App() {
  return (
    <FlagsErrorBoundary>
      <FlagsProvider client={client}>
        <MainApp />
      </FlagsProvider>
    </FlagsErrorBoundary>
  );
}
```

### Conditional Rendering by Feature

```tsx
function FeatureGate({ flag, children, fallback }) {
  const flags = useFlags();

  if (flags.boolFlag(flag, false)) {
    return children;
  }

  return fallback || null;
}

// Usage
function App() {
  return (
    <FeatureGate
      flag="new-checkout"
      fallback={<OldCheckout />}
    >
      <NewCheckout />
    </FeatureGate>
  );
}
```

## Advanced

### Multiple Providers

For unusual setups with multiple flag systems:

```tsx
const flagsClientA = createClient({...});
const flagsClientB = createClient({...});

function App() {
  return (
    <FlagsProvider client={flagsClientA}>
      <ProviderA>
        <FlagsProvider client={flagsClientB}>
          <ProviderB>
            <MainApp />
          </ProviderB>
        </FlagsProvider>
      </ProviderA>
    </FlagsProvider>
  );
}

// In a component
const flagsA = useFlags(); // gets flagsClientA
```

### Outside the Provider

If you call `useFlags()` or `useFlagClient()` outside a provider, you'll get an error:

```
useFlags() must be called inside a <FlagsProvider>.
```

Solutions:
1. Move the component inside the provider tree
2. Create a different provider higher up
3. Use the low-level client directly (see [Web Guide](./SDK-Web.md))

## Reactivity

The provider uses `useSyncExternalStore` internally to subscribe to SDK state changes. Whenever the SDK version bumps (cache changed, state changed, error occurred), subscribed components re-render.

```tsx
function Component() {
  const flags = useFlags(); // Re-renders when flags.version changes

  const isEnabled = flags.boolFlag("feature", false); // Reactive
  return <div>{isEnabled ? "On" : "Off"}</div>;
}
```

## Testing

### Mock the Client

```tsx
import { render, screen } from "@testing-library/react";
import { FlagsProvider } from "@ffp/sdk/react";
import { test, expect, vi } from "vitest";

test("renders with feature enabled", async () => {
  const mockClient = {
    ready: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    boolFlag: (key, defaultValue) =>
      key === "feature" ? true : defaultValue,
    jsonFlag: (key, defaultValue) => defaultValue,
    allFlags: () => ({ feature: true }),
    getSubject: () => ({ type: "user", id: "test" }),
    setSubject: vi.fn(),
    setSubjectToken: vi.fn(),
    on: vi.fn(() => () => {}),
    subscribe: vi.fn(() => () => {}),
    getState: () => ({
      ready: true,
      error: null,
      connectionState: "streaming",
      version: 1,
    }),
  };

  render(
    <FlagsProvider client={mockClient}>
      <Feature />
    </FlagsProvider>
  );

  expect(screen.getByText("New feature")).toBeInTheDocument();
});
```

### Testing Hooks

```tsx
import { renderHook } from "@testing-library/react";
import { useFlags } from "@ffp/sdk/react";
import { createClient } from "@ffp/sdk/client";

test("hook returns flags", async () => {
  const mockFetch = async () =>
    new Response(
      JSON.stringify({
        results: { feature: { value: true, kind: "boolean" } },
      })
    );

  const client = createClient({
    baseUrl: "http://test",
    publicKey: "test",
    subject: { type: "user", id: "test" },
    fetch: mockFetch,
  });

  const wrapper = ({ children }) => (
    <FlagsProvider client={client}>{children}</FlagsProvider>
  );

  const { result } = renderHook(() => useFlags(), { wrapper });

  await waitFor(() => {
    expect(result.current.ready).toBe(true);
  });

  expect(result.current.boolFlag("feature", false)).toBe(true);
});
```

## TypeScript

Fully typed flag operations:

```tsx
interface AppFlags {
  "new-checkout": boolean;
  "pricing-config": { tier: string; markup: number };
}

function Feature() {
  const flags = useFlags();

  // Type-safe JSON flag
  const config = flags.jsonFlag<AppFlags["pricing-config"]>(
    "pricing-config",
    { tier: "free", markup: 0 }
  );

  console.log(config.tier); // ✅ type-safe
  console.log(config.unknown); // ❌ TypeScript error
}
```

## Performance

The provider is optimized for:
- **One allocation per mount**: Client is passed in, not created
- **Minimal re-renders**: Only components calling `useFlags()` re-render on state changes
- **No context thrashing**: useSyncExternalStore prevents unnecessary provider re-renders

For very large flag sets or thousands of components, consider:
1. Splitting flags by feature area (multiple providers)
2. Creating selector hooks to prevent unnecessary renders
3. Memoizing derived values in components

## Migration from Manual Subscriptions

If you're managing client subscriptions manually:

**Before:**
```tsx
function Feature() {
  const [flags, setFlags] = useState({});

  useEffect(() => {
    const client = createClient({...});
    client.ready().then(() => setFlags(client.allFlags()));
    client.on("change", () => setFlags(client.allFlags()));
    return () => client.close();
  }, []);

  return <div>{flags["feature"] ? "on" : "off"}</div>;
}
```

**After:**
```tsx
function Feature() {
  const flags = useFlags();
  return <div>{flags.boolFlag("feature", false) ? "on" : "off"}</div>;
}
```

## See Also

- [SDK Overview](./SDK.md)
- [Web Guide](./SDK-Web.md)
- [API Reference](./SDK-API-Reference.md)
- [Examples](../examples/react-app/)
