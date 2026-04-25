import { runner } from "node-pg-migrate";
import type { Logger } from "pino";
import type { Config } from "../config.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../../migrations");

export async function runMigrations(config: Config, logger: Logger): Promise<void> {
  logger.info({ migrationsDir }, "running migrations");
  await runner({
    databaseUrl: config.DATABASE_URL,
    dir: migrationsDir,
    migrationsTable: "pgmigrations",
    direction: "up",
    count: Infinity,
    log: (msg) => logger.info(msg),
    verbose: false,
  });
  logger.info("migrations complete");
}
