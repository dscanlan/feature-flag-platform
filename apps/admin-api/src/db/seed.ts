import type { Pool } from "pg";
import type { Logger } from "pino";
import { hashPassword } from "../auth/password.js";
import type { Config } from "../config.js";

export async function seedAdminUser(pool: Pool, config: Config, logger: Logger): Promise<void> {
  const existing = await pool.query<{ id: string }>("SELECT id FROM admin_users WHERE email = $1", [
    config.ADMIN_EMAIL,
  ]);

  if (existing.rows.length > 0) {
    logger.debug({ email: config.ADMIN_EMAIL }, "admin user already exists");
    return;
  }

  const hash = await hashPassword(config.ADMIN_PASSWORD);
  await pool.query("INSERT INTO admin_users (email, password_hash) VALUES ($1, $2)", [
    config.ADMIN_EMAIL,
    hash,
  ]);
  logger.info({ email: config.ADMIN_EMAIL }, "seeded admin user");
}
