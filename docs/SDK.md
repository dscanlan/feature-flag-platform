# Feature Flag Platform SDK

The Feature Flag Platform (FFP) SDK provides a lightweight, framework-agnostic interface for evaluating feature flags in Node.js, browsers, and React applications.

## Quick Start

### Installation

```bash
npm install @ffp/sdk
# or
pnpm add @ffp/sdk
```

## Choose Your Environment

- **Node.js / Server-side**: See [Node.js Guide](./SDK-Node.md)
- **Browser / Vanilla JS**: See [Web Guide](./SDK-Web.md)
- **React**: See [React Guide](./SDK-React.md)

## Key Concepts

### Flags

The SDK evaluates two types of flags:

- **Boolean flags**: `enabled = client.boolFlag("feature-name", false)`
- **JSON flags**: `config = client.jsonFlag("config-key", defaultValue)`

### Subjects

A **subject** is the entity for which flags are evaluated (typically a user, org, or account). Subjects have:

- `type`: "user", "org", "account", or custom string
- `id`: unique identifier within that type
- Custom attributes (e.g., tier, region) for rule evaluation

### Connection States

The browser SDK tracks connection state as it connects:

- `"connecting"`: initial state, awaiting first successful resolve
- `"streaming"`: SSE connection healthy and receiving updates
- `"polling"`: SSE unavailable, falling back to periodic fetches
- `"offline"`: all fetches failing

### Error Handling

Errors are exposed via snapshot state, not exceptions:

```ts
const state = client.getState();
console.log(state.error); // null or { status, err, ... }
```

The SDK never throws on flag operations — always returns the default fallback value on cache miss.

## Common Patterns

### Changing the Subject

```ts
// All subsequent flag evaluations use the new subject
await client.setSubject({ type: "user", id: "user-123" });
```

### Subject Tokens

For production systems, send signed subject tokens instead of raw subjects:

```ts
// Backend signs and issues a token
const token = issueSubjectToken({ userId: "user-123", tier: "premium" });

// Frontend sends token instead of raw subject
await client.setSubjectToken(token);
```

### Monitoring

```ts
client.on("ready", () => console.log("Flags loaded"));
client.on("change", ({ key, value }) => console.log(`${key} changed to`, value));
client.on("error", (info) => console.error("SDK error:", info));

// Or use subscribe (React-compatible):
const unsub = client.subscribe(() => {
  const state = client.getState();
  console.log("State changed:", state);
});
```

## Architecture

The SDK is split into subpaths for size and dependency isolation:

- `@ffp/sdk/client`: low-level browser client (no React)
- `@ffp/sdk/server`: Node.js server client
- `@ffp/sdk/react`: React Provider and hooks (requires React 18+)

This design ensures:
- Server code doesn't bundle React
- Browser code doesn't bundle Node dependencies
- React apps opt-in to the provider pattern

## Version

Current SDK version: **0.2.0**

See `CHANGELOG.md` (coming soon) for migration guides between major versions.

## Learn More

- [API Reference](./SDK-API-Reference.md)
- [Examples](../examples/)
