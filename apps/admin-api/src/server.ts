import pino from "pino";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { createPool } from "./db/pool.js";
import { createRedis } from "./db/redis.js";
import { seedAdminUser, seedDevSampleData } from "./db/seed.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const bootLogger = pino({ level: config.LOG_LEVEL });

  const pool = createPool(config);
  const redis = createRedis(config);

  if (config.MIGRATE_ON_BOOT) {
    await runMigrations(config, bootLogger);
  }
  await seedAdminUser(pool, config, bootLogger);
  await seedDevSampleData(pool, config, bootLogger);

  const app = await buildApp({ config, pool, redis });
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
  app.log.info({ port: config.PORT }, "admin-api listening");

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "shutting down");
    try {
      await app.close();
      await pool.end();
      redis.disconnect();
    } catch (err) {
      app.log.error({ err }, "error during shutdown");
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("fatal:", err);
  process.exit(1);
});
