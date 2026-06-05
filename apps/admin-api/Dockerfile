# syntax=docker/dockerfile:1
#
# Build context is the REPO ROOT (this is a pnpm workspace; the app depends on
# workspace packages under packages/*). Build with:
#   docker build -f apps/admin-api/Dockerfile -t ffp/admin-api .
#
# Node 23 is required: the workspace packages export TypeScript source
# (packages/*/src/index.ts) that is type-stripped at runtime, so the source
# must be present in the image and the runtime must be >= 23.6.
FROM node:23-slim

RUN corepack enable
WORKDIR /repo

# Install only this app's subtree (and its workspace deps) from the frozen
# lockfile. node_modules is .dockerignore'd so this builds linux-native binaries.
# --ignore-scripts: the repo's root `prepare` script runs `git config` (for the
# committed hooks), which isn't applicable in the image and would fail (no git /
# no .git). None of the runtime deps need install scripts.
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @ffp/admin-api... \
 && chmod +x /repo/infra/docker/entrypoint.sh

ENV NODE_ENV=production
WORKDIR /repo/apps/admin-api
EXPOSE 4000

# Run via tsx, not `node dist/server.js`. The workspace packages export raw TS
# (packages/*/src/index.ts) whose internal imports use `.js` specifiers that
# only exist as `.ts`; Node's native type-stripping does not remap those, but
# tsx does. tsx is what dev/e2e already use.
ENTRYPOINT ["/repo/infra/docker/entrypoint.sh"]
CMD ["pnpm", "exec", "tsx", "src/server.ts"]
