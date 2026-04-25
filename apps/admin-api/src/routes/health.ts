import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { Redis } from "ioredis";
import { checkDb } from "../db/pool.js";
import { checkRedis } from "../db/redis.js";

export function registerHealthRoutes(app: FastifyInstance, pool: Pool, redis: Redis): void {
  app.get("/api/v1/health", async (_req, reply) => {
    const [dbOk, redisOk] = await Promise.all([checkDb(pool), checkRedis(redis)]);
    const ok = dbOk && redisOk;
    return reply.code(ok ? 200 : 503).send({ ok, dbOk, redisOk });
  });

  // Simple liveness for the admin-protected route in tests.
  app.get("/api/v1/me", { preHandler: [app.requireAuth] }, async (req, _reply) => ({
    userId: req.session?.userId ?? null,
  }));
}
