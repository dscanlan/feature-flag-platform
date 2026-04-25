import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { AppError, conflict, notFound, validation } from "../lib/errors.js";
import { isValidKey } from "../lib/keys.js";
import { writeAudit } from "../db/audit.js";
import { toWorkspace, type WorkspaceRow } from "../db/mappers.js";

const createBody = z.object({
  key: z.string().refine(isValidKey, "key must match ^[a-z0-9][a-z0-9-]{0,63}$"),
  name: z.string().min(1).max(120),
});

export function registerWorkspaceRoutes(app: FastifyInstance, pool: Pool): void {
  app.post("/api/v1/workspaces", { preHandler: [app.requireAuth] }, async (req, reply) => {
    const body = createBody.safeParse(req.body);
    if (!body.success) throw validation("invalid body", body.error.issues);
    const actorUserId = req.session?.userId ?? null;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let row: WorkspaceRow;
      try {
        const res = await client.query<WorkspaceRow>(
          "INSERT INTO workspaces (key, name) VALUES ($1, $2) RETURNING *",
          [body.data.key, body.data.name],
        );
        row = res.rows[0]!;
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict("workspace key already exists");
        throw err;
      }
      await writeAudit(client, {
        workspaceId: row.id,
        actorUserId,
        action: "workspace.create",
        target: `workspace:${row.key}`,
        after: { key: row.key, name: row.name },
      });
      await client.query("COMMIT");
      return reply.code(201).send(toWorkspace(row));
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });

  app.get("/api/v1/workspaces", { preHandler: [app.requireAuth] }, async () => {
    const res = await pool.query<WorkspaceRow>("SELECT * FROM workspaces ORDER BY created_at");
    return res.rows.map(toWorkspace);
  });

  app.get<{ Params: { wsKey: string } }>(
    "/api/v1/workspaces/:wsKey",
    { preHandler: [app.requireAuth] },
    async (req) => {
      const ws = await getWorkspace(pool, req.params.wsKey);
      return toWorkspace(ws);
    },
  );
}

export async function getWorkspace(pool: Pool, key: string): Promise<WorkspaceRow> {
  const res = await pool.query<WorkspaceRow>("SELECT * FROM workspaces WHERE key = $1", [key]);
  const row = res.rows[0];
  if (!row) throw notFound("workspace", key);
  return row;
}

export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "23505"
  );
}

export { AppError };
