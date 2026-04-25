# Feature Flag Platform

Self-hosted feature-flag system.

## Documentation

Start with the [**Documentation Index**](./docs/INDEX.md) for guides on:

- **SDK Usage**: [Node.js](./docs/SDK-Node.md), [Web/Browser](./docs/SDK-Web.md), [React](./docs/SDK-React.md)
- **E2E Testing**: [Overview](./docs/E2E-OVERVIEW.md), [Stack](./docs/E2E-STACK.md), [Node Tests](./docs/E2E-NODE.md), [Web Tests](./docs/E2E-WEB.md)
- **API Reference**: [Complete SDK API](./docs/SDK-API-Reference.md)

## Local Development

Prerequisites: Node 23.6+ (the build relies on Node's default-on TypeScript type stripping), pnpm 9, Docker.

```bash
pnpm install
docker compose up -d
cp apps/admin-api/.env.example apps/admin-api/.env
pnpm --filter admin-api dev
```

The admin API listens on `http://localhost:4000` and the resolver on `http://localhost:4001`.

### Git pre-commit hook

`pnpm install` runs the repo's `prepare` script, which points `core.hooksPath`
at `.githooks/`. The committed `pre-commit` hook runs `pnpm format:check`,
`pnpm lint`, and `pnpm typecheck` before each commit. If any step fails, fix
the underlying issue (or run `pnpm fix` for auto-fixable formatting/lint
problems) and re-stage — don't bypass with `--no-verify`.

## Testing

Run end-to-end tests against a live resolver. Each suite manages its own
e2e-stack (Postgres + Redis via docker compose, plus admin-api and resolver as
child processes), so you can run them independently:

```bash
# Node.js SDK tests (Vitest)
pnpm --filter @ffp/e2e-node test

# Browser SDK tests (Playwright)
pnpm --filter @ffp/e2e-web test
```

To skip the auto-managed lifecycle and reuse a long-running stack, start it in
a separate terminal first — both runners detect a healthy stack and reuse it
when `CI` isn't set:

```bash
pnpm --filter @ffp/e2e-stack start
```

See [E2E Testing Overview](./docs/E2E-OVERVIEW.md) for detailed instructions.

## Useful Scripts

```bash
pnpm lint              # Check code style
pnpm lint:fix          # Auto-fix lint problems where possible
pnpm format            # Apply prettier formatting
pnpm fix               # format + lint:fix (covers everything pre-commit checks)
pnpm typecheck         # TypeScript validation
pnpm test              # Run unit + integration tests (excludes e2e-node/e2e-web)
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
