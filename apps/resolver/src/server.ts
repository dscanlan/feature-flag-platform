import { Pool } from "pg";
import { Redis } from "ioredis";
import { buildResolver } from "./app.js";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.DATABASE_URL });
  const redisSub = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

  const { app, sync } = await buildResolver({ config, pool, redisSub });
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
  app.log.info({ port: config.PORT }, "resolver listening");

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "shutting down");
    try {
      await sync.stop();
      await app.close();
      await pool.end();
      redisSub.disconnect();
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
