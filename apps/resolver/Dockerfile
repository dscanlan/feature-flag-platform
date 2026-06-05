# syntax=docker/dockerfile:1
#
# Build context is the REPO ROOT (pnpm workspace). Build with:
#   docker build -f apps/resolver/Dockerfile -t ffp/resolver .
#
# Node 23 is required: workspace packages (e.g. @ffp/resolver-engine) export
# TypeScript source that is type-stripped at runtime, so the source must be in
# the image and the runtime must be >= 23.6.
FROM node:23-slim

RUN corepack enable
WORKDIR /repo

# --ignore-scripts: the repo's root `prepare` script runs `git config` (for the
# committed hooks), which would fail in the image (no git / no .git). None of the
# runtime deps need install scripts.
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @ffp/resolver... \
 && chmod +x /repo/infra/docker/entrypoint.sh

ENV NODE_ENV=production
WORKDIR /repo/apps/resolver
EXPOSE 4001

# Run via tsx, not `node dist/server.js`. The workspace packages (e.g.
# @ffp/resolver-engine) export raw TS whose internal `.js` import specifiers
# only exist as `.ts`; Node's type-stripping does not remap those, but tsx does.
ENTRYPOINT ["/repo/infra/docker/entrypoint.sh"]
CMD ["pnpm", "exec", "tsx", "src/server.ts"]
