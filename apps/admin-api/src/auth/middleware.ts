import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { COOKIE_NAME, getSession, type Session } from "./sessions.js";

declare module "fastify" {
  interface FastifyRequest {
    session?: Session;
  }
}

export function makeRequireAuth(pool: Pool) {
  return async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const cookie = req.cookies[COOKIE_NAME];
    if (!cookie) {
      reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "missing session" } });
      return;
    }
    const unsigned = req.unsignCookie(cookie);
    if (!unsigned.valid || !unsigned.value) {
      reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "bad session" } });
      return;
    }
    const session = await getSession(pool, unsigned.value);
    if (!session) {
      reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "expired session" } });
      return;
    }
    req.session = session;
  };
}
