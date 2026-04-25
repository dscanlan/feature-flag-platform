# Feature Flag Platform

Self-hosted feature-flag system. See `PLAN.md` for design and `AGENT.md` for the implementation contract.

## Documentation

Start with the [**Documentation Index**](./docs/INDEX.md) for guides on:
- **SDK Usage**: [Node.js](./docs/SDK-Node.md), [Web/Browser](./docs/SDK-Web.md), [React](./docs/SDK-React.md)
- **E2E Testing**: [Overview](./docs/E2E-OVERVIEW.md), [Stack](./docs/E2E-STACK.md), [Node Tests](./docs/E2E-NODE.md), [Web Tests](./docs/E2E-WEB.md)
- **API Reference**: [Complete SDK API](./docs/SDK-API-Reference.md)

## Local Development

Prerequisites: Node 20+, pnpm 9, Docker.

```bash
pnpm install
docker compose up -d
cp apps/admin-api/.env.example apps/admin-api/.env
pnpm --filter admin-api dev
```

The admin API listens on `http://localhost:4000`.

## Testing

Run end-to-end tests against a live resolver:

```bash
# Terminal 1: Start test infrastructure
pnpm --filter @ffp/e2e-stack start

# Terminal 2: Run Node.js SDK tests
pnpm --filter @ffp/e2e-node test

# Terminal 3: Run Browser SDK tests
pnpm --filter @ffp/e2e-web test
```

See [E2E Testing Overview](./docs/E2E-OVERVIEW.md) for detailed instructions.

## Useful Scripts

```bash
pnpm lint              # Check code style
pnpm typecheck         # TypeScript validation
pnpm test              # Run unit tests
pnpm build             # Build all packages
pnpm graph:deps        # Generate dependency graph
```

## Dependency Graph

Generate the workspace dependency graph as a Mermaid diagram:

```bash
pnpm graph:deps
```

This writes the graph to `docs/dependency-graph.mmd`.

You can also provide a custom output path:

```bash
node scripts/draw-dependency-graph.mjs docs/dependency-graph.mmd
```

## Viewing the Graph

The generated file is Mermaid source, so you need a Mermaid-compatible viewer.

Options:

- Open `docs/dependency-graph.mmd` in the [Mermaid Live Editor](https://mermaid.live) by pasting in the file contents.
- Use the official VS Code Mermaid Chart extension if you want to work with `.mmd` files directly: <https://marketplace.visualstudio.com/items?itemName=MermaidChart.vscode-mermaid-chart>
- If you prefer Markdown previews, copy the diagram into a Markdown file inside a fenced `mermaid` block and use the Markdown Preview Mermaid Support extension: <https://marketplace.visualstudio.com/items?itemName=bierner.markdown-mermaid>
