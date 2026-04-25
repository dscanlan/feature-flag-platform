import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(0).max(65535).default(4001),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  SAFETY_POLL_MS: z.coerce.number().int().min(1000).default(60_000),
  RATE_LIMIT_RPS: z.coerce.number().int().min(1).default(100),
  RATE_LIMIT_BURST: z.coerce.number().int().min(1).default(200),
  /**
   * HMAC secret used to sign stream-subscription tokens (sst-). Must be set
   * in production; we generate a per-process random secret if absent so dev
   * still works, at the cost of invalidating live tokens on every restart.
   */
  STREAM_TOKEN_SECRET: z.string().min(32).optional(),
  /** Stream token TTL in seconds. Default 5 minutes. */
  STREAM_TOKEN_TTL_SEC: z.coerce.number().int().min(30).max(3600).default(300),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
