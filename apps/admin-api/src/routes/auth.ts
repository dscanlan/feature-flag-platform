import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { verifyPassword } from "../auth/password.js";
import { COOKIE_NAME, COOKIE_TTL_SECONDS, createSession, deleteSession } from "../auth/sessions.js";

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export function registerAuthRoutes(app: FastifyInstance, pool: Pool): void {
  app.post("/api/v1/auth/login", async (req, reply) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "invalid request body",
          details: parsed.error.issues,
        },
      });
    }
    const { email, password } = parsed.data;

    const res = await pool.query<{ id: string; password_hash: string }>(
      "SELECT id, password_hash FROM admin_users WHERE email = $1",
      [email],
    );
    const row = res.rows[0];
    const ok = row ? await verifyPassword(password, row.password_hash) : false;
    if (!ok || !row) {
      return reply
        .code(401)
        .send({ error: { code: "INVALID_CREDENTIALS", message: "invalid email or password" } });
    }

    const session = await createSession(pool, row.id);
    reply.setCookie(COOKIE_NAME, session.id, {
      path: "/",
      httpOnly: true,
      secure: req.protocol === "https",
      sameSite: "lax",
      signed: true,
      maxAge: COOKIE_TTL_SECONDS,
    });
    return reply.send({ ok: true });
  });

  app.post("/api/v1/auth/logout", async (req, reply) => {
    const cookie = req.cookies[COOKIE_NAME];
    if (cookie) {
      const unsigned = req.unsignCookie(cookie);
      if (unsigned.valid && unsigned.value) {
        await deleteSession(pool, unsigned.value);
      }
    }
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return reply.send({ ok: true });
  });
}
