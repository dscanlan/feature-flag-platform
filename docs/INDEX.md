# Documentation Index

## SDK Documentation

### Getting Started

- **[SDK Overview](./SDK.md)** - Start here for an introduction to the Feature Flag Platform SDK, key concepts, and architecture

### Integration Guides

- **[Node.js Guide](./SDK-Node.md)** - How to use the SDK in Node.js backends with complete examples and patterns
- **[Web Guide](./SDK-Web.md)** - How to use the SDK in browsers with vanilla JS, Vue, Svelte, and jQuery examples
- **[React Guide](./SDK-React.md)** - How to use the SDK in React apps with the provider and hooks

### Reference

- **[API Reference](./SDK-API-Reference.md)** - Complete API documentation for all SDK interfaces, types, and methods

## Platform Documentation

- **[Trust Model](./trust-model.md)** - Security architecture and trust boundaries of the platform
- **[Dependency Graph](./dependency-graph.mmd)** - Visual map of the workspace packages and their dependencies

## Quick Links

### Choose Your Environment

| Environment              | Guide                          | Key Exports                                  |
| ------------------------ | ------------------------------ | -------------------------------------------- |
| **Node.js / Server**     | [SDK-Node.md](./SDK-Node.md)   | `createServerClient`                         |
| **Browser / Vanilla JS** | [SDK-Web.md](./SDK-Web.md)     | `createClient`                               |
| **React**                | [SDK-React.md](./SDK-React.md) | `FlagsProvider`, `useFlags`, `useFlagClient` |

### Common Tasks

- Set up the SDK: [SDK-Node.md](./SDK-Node.md) or [SDK-Web.md](./SDK-Web.md)
- Add to React app: [SDK-React.md](./SDK-React.md)
- Look up an API: [SDK-API-Reference.md](./SDK-API-Reference.md)
- See code examples: [examples/](../examples/)

## Key Concepts

### Subjects

Entity for which flags are evaluated (user, org, account, etc.). Change with `setSubject()` or `setSubjectToken()`.

### Connection States

- **streaming**: Real-time updates via SSE
- **polling**: Periodic fetch fallback
- **offline**: No connectivity
- **connecting**: Initial state

### Flag Types

- **Boolean**: `client.boolFlag("key", false)`
- **JSON**: `client.jsonFlag("key", default)`

### Error Handling

Errors exposed via `ClientSnapshot.error`, never thrown. All flag operations return defaults on failure.

## Examples

- [React App](../examples/react-app/) - Complete React integration example
- [Node Server](../examples/node-server/) - Node.js backend example
- [E2E Web App](../apps/e2e-web/) - Full-featured browser harness with all SDK features

## Support

For issues or questions:

1. Check the relevant guide (Node.js, Web, or React)
2. Review [API Reference](./SDK-API-Reference.md) for complete method signatures
3. See [Examples](../examples/) for working code samples
