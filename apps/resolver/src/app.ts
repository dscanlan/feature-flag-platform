import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { Redis } from "ioredis";
import type { Config } from "./config.js";
import { loadAllStages, type RulesetStore } from "./store.js";
import { StreamHub } from "./streamHub.js";
import { createSynchronizer, type Synchronizer } from "./sync.js";
import { registerSdkRoutes } from "./routes.js";
import { createRateLimit, type RateLimit } from "./rateLimit.js";

export interface BuildArgs {
  config: Config;
  pool: Pool;
  redisSub: Redis;
}

export interface ResolverApp {
  app: FastifyInstance;
  store: RulesetStore;
  sync: Synchronizer;
  hub: StreamHub;
  rateLimit: RateLimit;
  /** Effective stream-token signing secret (env-supplied or per-process random). */
  streamTokenSecret: string;
}

/**
 * The CORS allow-list is per stage but a preflight (OPTIONS) doesn't carry
 * the Authorization key, so we can't pin the origin to a specific stage at
 * preflight time. Pragmatic v1: allow the origin if ANY known stage permits
 * it. The actual GET/POST is still gated by the Authorization key, so a
 * cross-stage origin can only call its own stage's data.
 */
function isOriginAllowed(store: RulesetStore, origin: string): boolean {
  for (const ruleset of store.byStageId.values()) {
    for (const o of ruleset.stage.corsOrigins) {
      if (o === "*" || o === origin) return true;
    }
  }
  return false;
}

export async function buildResolver({ config, pool, redisSub }: BuildArgs): Promise<ResolverApp> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: { paths: ["req.headers.authorization", "req.headers.cookie"], remove: true },
    },
  });

  const store = await loadAllStages(pool);

  await app.register(cors, {
    origin: (origin, cb) => {
      // Same-origin / non-browser requests have no Origin header — allow.
      if (!origin) return cb(null, true);
      if (isOriginAllowed(store, origin)) return cb(null, true);
      // Reject without throwing — @fastify/cors converts this to a 403-like
      // missing-ACAO response, which is the standard way to deny cross-origin.
      return cb(null, false);
    },
    credentials: false,
  });

  const hub = new StreamHub();
  const sync = createSynchronizer({
    pool,
    redisSub,
    store,
    hub,
    log: app.log,
    safetyPollMs: config.SAFETY_POLL_MS,
  });
  await sync.start();

  const rateLimit = createRateLimit({
    rate: config.RATE_LIMIT_RPS,
    burst: config.RATE_LIMIT_BURST,
  });

  // PLAN.md §7.6: stream tokens are HMAC-signed by the resolver. In prod the
  // operator MUST supply STREAM_TOKEN_SECRET (32+ chars) so tokens issued by
  // one task are accepted by every other task; in dev we generate a random
  // secret per process so things work out of the box.
  const streamTokenSecret = config.STREAM_TOKEN_SECRET ?? randomBytes(32).toString("base64");
  if (!config.STREAM_TOKEN_SECRET) {
    app.log.warn(
      "STREAM_TOKEN_SECRET not set; using a per-process random secret. " +
        "Set this in production so tokens survive restarts and load-balance.",
    );
  }

  registerSdkRoutes(app, store, hub, rateLimit, pool, {
    streamTokenSecret,
    streamTokenTtlSec: config.STREAM_TOKEN_TTL_SEC,
  });

  app.setErrorHandler((err, req, reply) => {
    req.log.error({ err }, "unhandled");
    reply.code(500).send({ error: { code: "INTERNAL", message: "internal error" } });
  });

  return { app, store, sync, hub, rateLimit, streamTokenSecret };
}
