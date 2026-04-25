import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import type { Pool } from "pg";
import type { Redis } from "ioredis";
import type { Config } from "./config.js";
import { makeRequireAuth } from "./auth/middleware.js";
import { AppError } from "./lib/errors.js";
import { loggerOptions } from "./lib/logger.js";
import { createPublisher } from "./db/publish.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerWorkspaceRoutes } from "./routes/workspaces.js";
import { registerStageRoutes } from "./routes/stages.js";
import { registerFlagRoutes } from "./routes/flags.js";
import { registerSubjectTypeRoutes } from "./routes/subjectTypes.js";
import { registerSubjectRoutes } from "./routes/subjects.js";
import { registerAudienceRoutes } from "./routes/audiences.js";

declare module "fastify" {
  interface FastifyInstance {
    requireAuth: ReturnType<typeof makeRequireAuth>;
  }
}

export interface BuildAppArgs {
  config: Config;
  pool: Pool;
  redis: Redis;
}

export async function buildApp({ config, pool, redis }: BuildAppArgs): Promise<FastifyInstance> {
  const app = Fastify({ logger: loggerOptions(config) });

  await app.register(cookie, { secret: config.COOKIE_SECRET });
  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  app.decorate("requireAuth", makeRequireAuth(pool));

  const publisher = createPublisher(redis, (msg, err) => app.log.warn({ err }, msg));

  registerAuthRoutes(app, pool);
  registerHealthRoutes(app, pool, redis);
  registerWorkspaceRoutes(app, pool);
  registerStageRoutes(app, pool, publisher);
  registerSubjectTypeRoutes(app, pool, publisher);
  registerSubjectRoutes(app, pool);
  registerAudienceRoutes(app, pool, publisher);
  registerFlagRoutes(app, pool, publisher);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply
        .code(err.httpStatus)
        .send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "internal server error" } });
  });

  return app;
}
