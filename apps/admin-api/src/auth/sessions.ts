import type { Pool } from "pg";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface Session {
  id: string;
  userId: string;
  expiresAt: Date;
}

export async function createSession(pool: Pool, userId: string): Promise<Session> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const res = await pool.query<{ id: string }>(
    "INSERT INTO admin_sessions (user_id, expires_at) VALUES ($1, $2) RETURNING id",
    [userId, expiresAt],
  );
  const id = res.rows[0]!.id;
  return { id, userId, expiresAt };
}

export async function getSession(pool: Pool, sessionId: string): Promise<Session | null> {
  const res = await pool.query<{ id: string; user_id: string; expires_at: Date }>(
    "SELECT id, user_id, expires_at FROM admin_sessions WHERE id = $1",
    [sessionId],
  );
  const row = res.rows[0];
  if (!row) return null;
  if (row.expires_at.getTime() <= Date.now()) {
    await deleteSession(pool, sessionId);
    return null;
  }
  return { id: row.id, userId: row.user_id, expiresAt: row.expires_at };
}

export async function deleteSession(pool: Pool, sessionId: string): Promise<void> {
  await pool.query("DELETE FROM admin_sessions WHERE id = $1", [sessionId]);
}

export const COOKIE_NAME = "ffp_session";
export const COOKIE_TTL_SECONDS = SESSION_TTL_MS / 1000;
