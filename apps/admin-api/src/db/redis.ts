import { Redis } from "ioredis";
import type { Config } from "../config.js";

export type { Redis } from "ioredis";

export function createRedis(config: Config): Redis {
  return new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
  });
}

export async function checkRedis(client: Redis): Promise<boolean> {
  try {
    const reply = await client.ping();
    return reply === "PONG";
  } catch {
    return false;
  }
}
