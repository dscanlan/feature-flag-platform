# admin-api

Fastify service. Owns Postgres writes for the platform.

## Required env

| Var               | Notes                                                     |
| ----------------- | --------------------------------------------------------- |
| `PORT`            | default 4000                                              |
| `LOG_LEVEL`       | pino level; default `info`                                |
| `DATABASE_URL`    | Postgres connection string                                |
| `REDIS_URL`       | Redis connection string                                   |
| `MIGRATE_ON_BOOT` | `true` to run migrations on startup (dev convenience)     |
| `ADMIN_EMAIL`     | Seeded admin user email                                   |
| `ADMIN_PASSWORD`  | Seeded admin user password (min 8 chars)                  |
| `COOKIE_SECRET`   | 32+ char hex string; generate with `openssl rand -hex 32` |

## Local development

```bash
cp .env.example .env
docker compose up -d            # from repo root
pnpm --filter @ffp/admin-api dev
```

## Tests

Tests need Postgres and Redis. The integration suite drops and re-creates the
`public` schema, so use a dedicated test database (default
`postgres://flags:flags@localhost:5433/flags_test`).

```bash
# from repo root
docker compose up -d
psql postgres://flags:flags@localhost:5433/postgres -c 'CREATE DATABASE flags_test;'
pnpm --filter @ffp/admin-api test
```

Override `TEST_DATABASE_URL` / `TEST_REDIS_URL` if you need to.
