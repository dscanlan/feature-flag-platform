# AWS Deployment Runbook

How to build, deploy, and tear down the platform on AWS. The topology itself is
described in [ARCHITECTURE.md](./ARCHITECTURE.md); this doc is the operational
side — the container images, the env wiring, and the scripted runbook.

> **TL;DR**
>
> ```bash
> AWS_PROFILE=ffp AWS_REGION=eu-north-1 \
>   ADMIN_EMAIL=you@example.com scripts/aws-deploy.sh     # build + deploy
> scripts/aws-teardown.sh                                  # delete (keep bootstrap)
> scripts/aws-teardown.sh --bootstrap                      # delete everything
> ```

## Prerequisites

- **AWS CLI v2**, authenticated. Create an IAM user (or SSO) with
  `AdministratorAccess` for the bring-up, then `aws configure --profile ffp`
  (region `eu-north-1`, output `json`).
- **Docker** running locally (images are built for `linux/amd64`).
- **pnpm** + Node 23.6+.

The scripts read `AWS_PROFILE` (default `ffp`), `AWS_REGION`
(default `eu-north-1`), and `ADMIN_EMAIL` (default `admin@example.com`).

## Container images

Both services ship as Docker images built from the **repo root** (this is a
pnpm workspace; each app depends on packages under `packages/*`):

- [`apps/admin-api/Dockerfile`](../apps/admin-api/Dockerfile)
- [`apps/resolver/Dockerfile`](../apps/resolver/Dockerfile)
- [`infra/docker/entrypoint.sh`](../infra/docker/entrypoint.sh) — shared entrypoint

Three things about these images are non-obvious and worth understanding:

1. **They run under `tsx`, not `node dist/server.js`.** The workspace packages
   (`@ffp/shared-types`, `@ffp/resolver-engine`) export raw TypeScript
   (`packages/*/src/index.ts`) whose internal imports use `.js` specifiers that
   only exist on disk as `.ts`. Node's native type-stripping does **not** remap
   `.js`→`.ts`, so `node dist/...` fails to resolve them. `tsx` (already used in
   dev/e2e) does the remap, so the images run `pnpm exec tsx src/server.ts`.

2. **`pnpm install` uses `--ignore-scripts`.** The repo's root `prepare` script
   runs `git config core.hooksPath` for the committed git hooks, which has no
   meaning inside the image (no git, no `.git`) and would fail the build. No
   runtime dependency needs an install script.

3. **`DATABASE_URL` is assembled at container start.** The apps read a single
   `DATABASE_URL` (see `apps/*/src/config.ts`), but on AWS the Postgres password
   arrives as an injected ECS **secret** (`DB_PASSWORD`) while the non-sensitive
   coordinates arrive as plain env (`DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`). The
   entrypoint composes `DATABASE_URL` from those parts so the password never
   lands in the plaintext task definition. If `DATABASE_URL` is already set
   (local dev, docker-compose), the entrypoint leaves it alone.

### Smoke-testing an image locally

A container with throwaway DB coordinates should validate its config, load all
modules, and then fail only on the DB connection — that proves the image is
sound:

```bash
docker run --rm --platform linux/amd64 \
  -e DB_HOST=127.0.0.1 -e DB_PORT=5432 -e DB_NAME=flags -e DB_USER=flags \
  -e DB_PASSWORD=pw -e REDIS_URL=redis://127.0.0.1:6379 ffp/resolver
# expect: ... Error: connect ECONNREFUSED 127.0.0.1:5432
```

## Deploy

`scripts/aws-deploy.sh` does the whole thing: bootstraps the account if needed,
builds both images, runs `cdk deploy`, and pushes the images to ECR **the moment
the repos appear** mid-deploy.

### Why the timing matters (the chicken-and-egg)

The stack creates both the ECR repos _and_ the ECS services that pull
`:latest`. On a first deploy the repos start empty, so if ECS tries to pull
before the images exist, the services never reach steady state and `cdk deploy`
hangs until it times out. The script wins the race by pushing while RDS/NAT are
still being created (~10 min of slack). If you deploy by hand, push the images
in that same window.

### After deploy: log in

The stack generates a bootstrap admin password in Secrets Manager (admin-api
requires `ADMIN_EMAIL` + `ADMIN_PASSWORD` and has no defaults). Retrieve it:

```bash
SECRET_ID=$(aws cloudformation describe-stack-resources --stack-name FfpStack \
  --query "StackResources[?contains(LogicalResourceId,'AdminPassword')].PhysicalResourceId" \
  --output text)
aws secretsmanager get-secret-value --secret-id "$SECRET_ID" \
  --query SecretString --output text
```

Log in at the admin-UI CloudFront URL (stack output `AdminUiCdn`) with
`ADMIN_EMAIL` and that password.

> **Note:** the admin-UI bucket starts empty and the admin-API ALB is internal.
> Serving the SPA (`aws s3 sync apps/admin-ui/dist ...`) and giving your browser
> a path to the internal ALB are tracked as Phase-1 items in
> [AWS-GETTING-STARTED.md](./AWS-GETTING-STARTED.md).

## Teardown

`scripts/aws-teardown.sh` deletes `FfpStack`, then removes the resources the
stack **RETAINs** on delete — the two ECR repos and the admin-UI S3 bucket.
These survive a plain `cdk destroy`; left behind they keep costing money and
will collide with a future deploy as "already exists". Pass `--bootstrap` to
also remove the `CDKToolkit` bootstrap stack and its (versioned) staging bucket.

## Gotchas hit during bring-up

These are baked into the scripts/stack now, but worth knowing:

| Symptom                                                    | Cause                                              | Fix (already applied)                                 |
| ---------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| `Cannot find version 16.3 for postgres`                    | RDS retired that minor in-region                   | `PostgresEngineVersion.of("16.9","16")` in `stack.ts` |
| `Invalid environment configuration: DATABASE_URL Required` | apps read `DATABASE_URL`, stack passed only `DB_*` | entrypoint assembles `DATABASE_URL`                   |
| `ERR_MODULE_NOT_FOUND … resolve.js`                        | Node can't `.js`→`.ts` remap workspace src         | run via `tsx`                                         |
| `git: not found` during `pnpm install`                     | root `prepare` runs `git config`                   | `--ignore-scripts`                                    |
| `Resource ... ffp/admin-api already exists`                | RETAINed ECR/S3 orphaned by a prior failed deploy  | teardown script removes RETAINed resources            |
| `tag does not exist … ffp/admin-apiatest`                  | zsh `:l` modifier mangled `$s:latest`              | scripts use bash + `${s}:latest`                      |

## See also

- [ARCHITECTURE.md](./ARCHITECTURE.md) — the resource topology
- [AWS-GETTING-STARTED.md](./AWS-GETTING-STARTED.md) — remaining Phase 1–3 punch list
