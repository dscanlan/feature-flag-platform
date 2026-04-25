import { Pool } from "pg";
import { Redis } from "ioredis";
import pino from "pino";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { runMigrations } from "../../src/db/migrate.js";
import { seedAdminUser } from "../../src/db/seed.js";

export interface TestHarness {
  app: FastifyInstance;
  pool: Pool;
  redis: Redis;
  close: () => Promise<void>;
  config: ReturnType<typeof loadConfig>;
}

const TEST_ENV = {
  NODE_ENV: "test",
  PORT: "0",
  LOG_LEVEL: "warn",
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://flags:flags@localhost:5433/flags_test",
  REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://localhost:6380/15",
  MIGRATE_ON_BOOT: "true",
  ADMIN_EMAIL: "admin@example.com",
  ADMIN_PASSWORD: "test-password-1234",
  COOKIE_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
};

export async function createTestHarness(): Promise<TestHarness> {
  const config = loadConfig({ ...process.env, ...TEST_ENV });
  const logger = pino({ level: "warn" });

  const pool = new Pool({ connectionString: config.DATABASE_URL });
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: false });

  await resetSchema(pool);
  await runMigrations(config, logger);
  await seedAdminUser(pool, config, logger);

  void logger;
  const app = await buildApp({ config, pool, redis });
  await app.ready();

  return {
    app,
    pool,
    redis,
    config,
    close: async () => {
      await app.close();
      await pool.end();
      redis.disconnect();
    },
  };
}

async function resetSchema(pool: Pool): Promise<void> {
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("CREATE SCHEMA public");
}
