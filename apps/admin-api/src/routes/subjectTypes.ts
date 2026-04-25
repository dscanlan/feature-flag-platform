import type { FastifyInstance } from "fastify";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { conflict, notFound, validation } from "../lib/errors.js";
import { isValidKey } from "../lib/keys.js";
import { getWorkspace, isUniqueViolation } from "./workspaces.js";
import { withStageBump, type Publisher } from "../db/publish.js";
import type { SubjectType } from "@ffp/shared-types";

interface SubjectTypeRow {
  id: string;
  workspace_id: string;
  key: string;
  name: string;
  is_default_split_key: boolean;
}

const toSubjectType = (r: SubjectTypeRow): SubjectType => ({
  id: r.id,
  workspaceId: r.workspace_id,
  key: r.key,
  name: r.name,
  isDefaultSplitKey: r.is_default_split_key,
});

const createBody = z.object({
  key: z.string().refine(isValidKey, "invalid key"),
  name: z.string().min(1).max(120),
  isDefaultSplitKey: z.boolean().optional(),
});

const updateBody = z.object({
  name: z.string().min(1).max(120).optional(),
  isDefaultSplitKey: z.boolean().optional(),
});

export function registerSubjectTypeRoutes(
  app: FastifyInstance,
  pool: Pool,
  publisher: Publisher,
): void {
  app.get<{ Params: { wsKey: string } }>(
    "/api/v1/workspaces/:wsKey/subject-types",
    { preHandler: [app.requireAuth] },
    async (req) => {
      const ws = await getWorkspace(pool, req.params.wsKey);
      const res = await pool.query<SubjectTypeRow>(
        "SELECT * FROM subject_types WHERE workspace_id = $1 ORDER BY key",
        [ws.id],
      );
      return res.rows.map(toSubjectType);
    },
  );

  app.post<{ Params: { wsKey: string } }>(
    "/api/v1/workspaces/:wsKey/subject-types",
    { preHandler: [app.requireAuth] },
    async (req, reply) => {
      const body = createBody.safeParse(req.body);
      if (!body.success) throw validation("invalid body", body.error.issues);
      const ws = await getWorkspace(pool, req.params.wsKey);
      const actorUserId = req.session?.userId ?? null;
      const row = await withStageBump(pool, publisher, async (client) => {
        if (body.data.isDefaultSplitKey) {
          await client.query(
            "UPDATE subject_types SET is_default_split_key = false WHERE workspace_id = $1",
            [ws.id],
          );
        }
        let row: SubjectTypeRow;
        try {
          const res = await client.query<SubjectTypeRow>(
            `INSERT INTO subject_types (workspace_id, key, name, is_default_split_key)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [ws.id, body.data.key, body.data.name, body.data.isDefaultSplitKey ?? false],
          );
          row = res.rows[0]!;
        } catch (err) {
          if (isUniqueViolation(err)) throw conflict("subject type key already exists");
          throw err;
        }
        const stageIds = await stageIdsForWorkspace(client, ws.id);
        return {
          result: row,
          stageIds,
          audit: {
            workspaceId: ws.id,
            actorUserId,
            action: "subjectType.create",
            target: `subjectType:${row.key}`,
            after: toSubjectType(row),
          },
        };
      });
      return reply.code(201).send(toSubjectType(row));
    },
  );

  app.patch<{ Params: { wsKey: string; stKey: string } }>(
    "/api/v1/workspaces/:wsKey/subject-types/:stKey",
    { preHandler: [app.requireAuth] },
    async (req) => {
      const body = updateBody.safeParse(req.body);
      if (!body.success) throw validation("invalid body", body.error.issues);
      const ws = await getWorkspace(pool, req.params.wsKey);
      const actorUserId = req.session?.userId ?? null;
      return withStageBump(pool, publisher, async (client) => {
        const before = await client.query<SubjectTypeRow>(
          "SELECT * FROM subject_types WHERE workspace_id = $1 AND key = $2 FOR UPDATE",
          [ws.id, req.params.stKey],
        );
        const prev = before.rows[0];
        if (!prev) throw notFound("subject_type", req.params.stKey);

        if (body.data.isDefaultSplitKey === true) {
          await client.query(
            "UPDATE subject_types SET is_default_split_key = false WHERE workspace_id = $1",
            [ws.id],
          );
        }
        const res = await client.query<SubjectTypeRow>(
          `UPDATE subject_types
           SET name = COALESCE($1, name),
               is_default_split_key = COALESCE($2, is_default_split_key)
           WHERE workspace_id = $3 AND key = $4 RETURNING *`,
          [body.data.name ?? null, body.data.isDefaultSplitKey ?? null, ws.id, req.params.stKey],
        );
        const row = res.rows[0]!;
        const stageIds = await stageIdsForWorkspace(client, ws.id);
        return {
          result: toSubjectType(row),
          stageIds,
          audit: {
            workspaceId: ws.id,
            actorUserId,
            action: "subjectType.update",
            target: `subjectType:${prev.key}`,
            before: toSubjectType(prev),
            after: toSubjectType(row),
          },
        };
      });
    },
  );
}

async function stageIdsForWorkspace(client: PoolClient, workspaceId: string): Promise<string[]> {
  const res = await client.query<{ id: string }>("SELECT id FROM stages WHERE workspace_id = $1", [
    workspaceId,
  ]);
  return res.rows.map((r) => r.id);
}
