# Node server example

A 30-line HTTP server that uses `@ffp/sdk/server` to evaluate flags locally.
The SDK fetches the full ruleset on boot, keeps it warm via SSE, and re-binds
the subject per request without any extra network calls.

## Run

```sh
# 1. Set the resolver URL and a server key (srv-…) for a stage you've created.
export RESOLVER_URL=http://localhost:4001
export SERVER_KEY=srv-paste-yours-here

# 2. Start the server.
pnpm --filter @ffp/example-node-server start
```

Then `curl http://localhost:3000/?user=user-123` and watch the response shift
as you toggle flags in the admin UI — server-mode resolution updates within
~1s of the change.
