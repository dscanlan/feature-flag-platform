import type { FastifyServerOptions } from "fastify";
import type { Config } from "../config.js";

export function loggerOptions(config: Config): FastifyServerOptions["logger"] {
  return {
    level: config.LOG_LEVEL,
    redact: {
      paths: ["req.headers.authorization", "req.headers.cookie", "password", "*.password"],
      remove: true,
    },
  };
}
