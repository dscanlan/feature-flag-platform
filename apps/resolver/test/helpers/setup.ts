import { Pool } from "pg";
import { Redis } from "ioredis";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";
import pino from "pino";
import { buildResolver, type ResolverApp } from "../../src/app.js";
import type { Config } from "../../src/config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../../../admin-api/migrations");

const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://flags:flags@localhost:5433/flags_test";
const TEST_REDIS = process.env.TEST_REDIS_URL ?? "redis://localhost:6380/14";

export interface ResolverHarness extends ResolverApp {
  pool: Pool;
  redisPub: Redis;
  redisSub: Redis;
  baseUrl: string;
  close: () => Promise<void>;
}

export const config: Config = {
  NODE_ENV: "test",
  PORT: 0,
  LOG_LEVEL: "warn",
  DATABASE_URL: TEST_DB,
  REDIS_URL: TEST_REDIS,
  SAFETY_POLL_MS: 60_000,
  RATE_LIMIT_RPS: 10_000,
  RATE_LIMIT_BURST: 10_000,
  STREAM_TOKEN_SECRET: "test-stream-token-secret-must-be-32-chars-long-aaaaa",
  STREAM_TOKEN_TTL_SEC: 300,
};

export async function resetDb(pool: Pool): Promise<void> {
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await runner({
    databaseUrl: TEST_DB,
    dir: migrationsDir,
    migrationsTable: "pgmigrations",
    direction: "up",
    count: Infinity,
    log: () => undefined,
    verbose: false,
    logger: pino({ level: "silent" }),
  });
}

export async function startResolver(port: number = 0): Promise<ResolverHarness> {
  const pool = new Pool({ connectionString: TEST_DB });
  const redisSub = new Redis(TEST_REDIS, { maxRetriesPerRequest: null });
  const redisPub = new Redis(TEST_REDIS, { maxRetriesPerRequest: 3 });
  const built = await buildResolver({ config, pool, redisSub });
  await built.app.listen({ port, host: "127.0.0.1" });
  const addr = built.app.server.address();
  if (typeof addr !== "object" || !addr) throw new Error("no address");
  return {
    ...built,
    pool,
    redisPub,
    redisSub,
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: async () => {
      await built.sync.stop();
      // Force-close any held SSE sockets so close() resolves promptly. Without
      // this, fastify will wait for SSE clients to disconnect themselves.
      built.app.server.closeAllConnections?.();
      await built.app.close();
      await pool.end();
      redisSub.disconnect();
      redisPub.disconnect();
    },
  };
}
