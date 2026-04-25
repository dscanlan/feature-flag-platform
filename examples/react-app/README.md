# React example

A minimal Vite + React app that uses `@ffp/sdk/client` to fetch flags via the
resolver's `/sdk/resolve` endpoint and live-updates over SSE.

## Run

```sh
# 1. Set the resolver URL and a public key (pub-…) for a stage you've created.
export VITE_RESOLVER_URL=http://localhost:4001
export VITE_PUBLIC_KEY=pub-paste-yours-here

# 2. Start Vite.
pnpm --filter @ffp/example-react-app dev
```

Open http://localhost:5174 and toggle a flag in the admin UI — the page will
flip within ~1 second courtesy of the SSE stream. Type into the user-id box to
re-bind the SDK subject and watch pinned overrides take effect.
