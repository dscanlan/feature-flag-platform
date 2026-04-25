# AWS Architecture (CDK)

The deploy topology lives in [`infra/cdk/src/stack.ts`](../infra/cdk/src/stack.ts)
as a single `FfpStack`. It is **synth-only** in v1 — `pnpm --filter @ffp/cdk synth`
emits CloudFormation, but nothing in CI applies it. Sizing assumes a
single-tenant, single-AZ starting point; bump instance classes and turn on
Multi-AZ once real load exists.

## Topology at a glance

```
                        ┌──────────────── CloudFront ────────────────┐
                        │                                            │
 admin user ──► AdminUiDistribution ──► S3 (private, OAC) ──► SPA   │
                        │                                            │
 SDK client ──► ResolverDistribution ──► public ALB ──► Resolver ──┐ │
                                                          (Fargate)│ │
                                                                   │ │
 admin SPA ─────────────► internal ALB ──► Admin API ──────────────┤ │
                                            (Fargate)              │ │
                                                                   ▼ ▼
                                                       ┌── private subnets ──┐
                                                       │                     │
                                                       │  ┌──────────────┐   │
                                                       │  │  RDS Postgres │  │
                                                       │  └──────────────┘   │
                                                       │  ┌──────────────┐   │
                                                       │  │ ElastiCache  │   │
                                                       │  │   Redis      │   │
                                                       │  └──────────────┘   │
                                                       └─────────────────────┘
```

## Layers

### Networking — `Vpc`

Three subnet tiers across two AZs with a **single** NAT gateway (cost
optimisation for v1):

| Subnet                  | Purpose                                                        |
| ----------------------- | -------------------------------------------------------------- |
| `public`                | ALBs and CloudFront origins                                    |
| `private` (with egress) | Fargate tasks; reach AWS APIs / ECR via NAT                    |
| `isolated`              | RDS and Redis; no internet path, reachable only via SG ingress |

### Secrets — `DbSecret`, `CookieSecret`

Auto-generated in Secrets Manager and injected into ECS tasks as
`ecs.Secret` references, so values never appear in CloudFormation
parameters or task-definition JSON.

- `DbSecret` — Postgres user/password. Wired into RDS via
  `Credentials.fromSecret`.
- `CookieSecret` — admin-api session-cookie HMAC key.

### Data layer

- **RDS Postgres 16.3** on `t4g.micro` in the isolated tier. Single-AZ,
  20 GB, 7-day backups, snapshot-on-destroy. Source of truth for flag
  definitions, environments, API keys, and audit log. Only the admin
  API writes; the resolver reads.
- **ElastiCache Redis 7.1**, single `t4g.micro` node, isolated tier.
  Used as a **pub/sub bus only** — no persistence by design. The admin
  API publishes flag-change events; resolver tasks subscribe and fan
  them out over SSE.

Both have dedicated security groups with no default ingress. Ingress
rules are added once the Fargate services exist, so only those two
services can reach 5432 / 6379.

### Container registry — ECR

Two repos, `ffp/admin-api` and `ffp/resolver`, retained on stack delete
so images survive teardown. CI builds and pushes; the Fargate task
definitions pull `:latest`.

### Compute — single ECS cluster, two Fargate services

Both services share one cluster and inherit `commonEnv`
(`NODE_ENV`, `LOG_LEVEL`, `REDIS_URL`).

**Admin API** — `ApplicationLoadBalancedFargateService`, **internal**
ALB, 1 task, 256 CPU / 512 MB. Health check on `/api/v1/health`.
`MIGRATE_ON_BOOT=true` runs schema migrations as the task starts.
Internal-only because the admin SPA reaches it through a private path,
not the public internet.

**Resolver** — same construct but **public** ALB and **2 tasks** for HA.
SSE-specific tweaks:

- `idleTimeout: 120s` so SSE streams aren't killed mid-flight by the
  ALB.
- `deregistration_delay: 20s` so rolling deploys give clients time to
  reconnect to a surviving task.
- Stickiness intentionally **off** — the SDK reconnects idempotently,
  so spreading load across tasks is preferred.

### Edge — CloudFront

**Admin UI** — private S3 bucket (BLOCK_ALL public access) fronted by a
CloudFront distribution using **Origin Access Control**. SPA routing
handled via `errorResponses` mapping 403/404 → `/index.html`.

**Resolver edge** — CloudFront in front of the public resolver ALB.
Caching is **disabled everywhere** in v1, deliberately, to avoid
correctness foot-guns around per-subject responses. `/sdk/stream` has
its own behaviour pinned to `CACHING_DISABLED`, `compress: false`, and
GET/HEAD only, since SSE must pass through unbuffered.

### Outputs

The stack exports:

- `AdminApiAlb`, `ResolverAlb` — ALB DNS names
- `AdminUiBucket`, `AdminUiCdn` — admin SPA hosting
- `AdminApiRepo`, `ResolverRepo` — ECR URIs
- `DbEndpoint` — RDS hostname

These let an operator wire DNS / ACM / deployment tooling outside CDK,
which v1 leaves out of scope.

## Request flow, end to end

1. **Admin user** → `AdminUiDistribution` → S3 SPA → calls admin API
   over its internal ALB → admin API writes to RDS and publishes the
   change to Redis.
2. **SDK in customer app** → `ResolverDistribution` → public ALB →
   resolver task → reads RDS for the snapshot, subscribes to Redis for
   live updates, streams them back over SSE.

For the punch list of work needed to turn this synth into a running
deployment, see [AWS Getting Started](./AWS-GETTING-STARTED.md).

## Things deliberately deferred

- Multi-AZ on RDS and Redis.
- CDN caching of `/sdk/resolve` (would require keying on
  `Authorization` plus subject hash; not worth the correctness risk in
  v1).
- Custom domains / ACM certificates / Route 53 records.
- CI-driven `cdk deploy` — today it's `cdk synth` only.
