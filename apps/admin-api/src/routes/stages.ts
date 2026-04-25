import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { conflict, notFound, validation } from "../lib/errors.js";
import {
  generatePublicKey,
  generateServerKey,
  generateSubjectSigningSecret,
  isValidKey,
} from "../lib/keys.js";
import { writeAudit } from "../db/audit.js";
import { toStage, type StageRow } from "../db/mappers.js";
import { getWorkspace, isUniqueViolation } from "./workspaces.js";
import { withStageBump, type Publisher } from "../db/publish.js";

const createBody = z.object({
  key: z.string().refine(isValidKey, "invalid key"),
  name: z.string().min(1).max(120),
  critical: z.boolean().optional(),
});

// "*" is allowed as a single-entry wildcard. Otherwise every entry must be a
// concrete origin like "https://example.com". We reject paths / trailing
// slashes / query to avoid drift between what the admin typed and what
// @fastify/cors returns in the Access-Control-Allow-Origin header.
const originPattern = /^https?:\/\/[^/\s?#]+$/;
const updateBody = z.object({
  corsOrigins: z
    .array(z.string().refine((o) => o === "*" || originPattern.test(o), "invalid origin"))
    .min(1)
    .max(64),
});

export function registerStageRoutes(app: FastifyInstance, pool: Pool, publisher: Publisher): void {
  app.get<{ Params: { wsKey: string } }>(
    "/api/v1/workspaces/:wsKey/stages",
    { preHandler: [app.requireAuth] },
    async (req) => {
      const ws = await getWorkspace(pool, req.params.wsKey);
      const res = await pool.query<StageRow>(
        "SELECT * FROM stages WHERE workspace_id = $1 ORDER BY created_at",
        [ws.id],
      );
      return res.rows.map((r) => toStage(r));
    },
  );

  app.post<{ Params: { wsKey: string } }>(
    "/api/v1/workspaces/:wsKey/stages",
    { preHandler: [app.requireAuth] },
    async (req, reply) => {
      const body = createBody.safeParse(req.body);
      if (!body.success) throw validation("invalid body", body.error.issues);
      const ws = await getWorkspace(pool, req.params.wsKey);
      const actorUserId = req.session?.userId ?? null;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        let stageRow: StageRow;
        try {
          const res = await client.query<StageRow>(
            `INSERT INTO stages
               (workspace_id, key, name, server_key, public_key, critical, subject_signing_secret)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [
              ws.id,
              body.data.key,
              body.data.name,
              generateServerKey(),
              generatePublicKey(),
              body.data.critical ?? false,
              generateSubjectSigningSecret(),
            ],
          );
          stageRow = res.rows[0]!;
        } catch (err) {
          if (isUniqueViolation(err)) throw conflict("stage key already exists in this workspace");
          throw err;
        }

        await client.query(
          `INSERT INTO flag_stage_configs (flag_id, stage_id, enabled, disabled_value_index, default_serve, pinned, rules)
           SELECT f.id, $1, false, 0, '{"kind":"value","valueIndex":0}'::jsonb, '[]'::jsonb, '[]'::jsonb
           FROM flags f WHERE f.workspace_id = $2`,
          [stageRow.id, ws.id],
        );

        await writeAudit(client, {
          workspaceId: ws.id,
          actorUserId,
          action: "stage.create",
          target: `stage:${body.data.key}`,
          after: {
            key: stageRow.key,
            name: stageRow.name,
            critical: stageRow.critical,
            corsOrigins: stageRow.cors_origins,
          },
        });

        await client.query("COMMIT");
        // Reveal the subject-signing secret on create — same pattern as the
        // server key (admin gets one chance to copy it).
        return reply.code(201).send(toStage(stageRow, true));
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  );

  app.patch<{ Params: { wsKey: string; stageKey: string } }>(
    "/api/v1/workspaces/:wsKey/stages/:stageKey",
    { preHandler: [app.requireAuth] },
    async (req) => {
      const body = updateBody.safeParse(req.body);
      if (!body.success) throw validation("invalid body", body.error.issues);
      const ws = await getWorkspace(pool, req.params.wsKey);
      const actorUserId = req.session?.userId ?? null;

      return withStageBump(pool, publisher, async (client) => {
        const before = await client.query<StageRow>(
          "SELECT * FROM stages WHERE workspace_id = $1 AND key = $2 FOR UPDATE",
          [ws.id, req.params.stageKey],
        );
        const prev = before.rows[0];
        if (!prev) throw notFound("stage", req.params.stageKey);

        const updated = await client.query<StageRow>(
          "UPDATE stages SET cors_origins = $1 WHERE id = $2 RETURNING *",
          [body.data.corsOrigins, prev.id],
        );
        const next = updated.rows[0]!;
        return {
          result: toStage(next),
          stageIds: [next.id],
          audit: {
            workspaceId: ws.id,
            actorUserId,
            action: "stage.update",
            target: `stage:${prev.key}`,
            before: { corsOrigins: prev.cors_origins },
            after: { corsOrigins: next.cors_origins },
          },
        };
      });
    },
  );

  app.post<{ Params: { wsKey: string; stageKey: string } }>(
    "/api/v1/workspaces/:wsKey/stages/:stageKey/server-key/reset",
    { preHandler: [app.requireAuth] },
    async (req) => {
      const ws = await getWorkspace(pool, req.params.wsKey);
      const newKey = generateServerKey();
      const actorUserId = req.session?.userId ?? null;

      return withStageBump(pool, publisher, async (client) => {
        const res = await client.query<{ id: string; key: string; server_key: string }>(
          `UPDATE stages SET server_key = $1 WHERE workspace_id = $2 AND key = $3
           RETURNING id, key, server_key`,
          [newKey, ws.id, req.params.stageKey],
        );
        const row = res.rows[0];
        if (!row) throw notFound("stage", req.params.stageKey);
        return {
          result: { serverKey: row.server_key },
          stageIds: [row.id],
          audit: {
            workspaceId: ws.id,
            actorUserId,
            action: "stage.serverKeyReset",
            target: `stage:${row.key}`,
            // Do NOT log the key itself — AGENT.md §12.2 forbids it.
            after: { rotated: true },
          },
        };
      });
    },
  );

  // Rotate the per-stage subject-signing secret. The host application's
  // backend signs `subjectToken`s with this; the resolver verifies them.
  // Returns the new secret ONCE — admin must copy it now.
  app.post<{ Params: { wsKey: string; stageKey: string } }>(
    "/api/v1/workspaces/:wsKey/stages/:stageKey/subject-signing-secret/reset",
    { preHandler: [app.requireAuth] },
    async (req) => {
      const ws = await getWorkspace(pool, req.params.wsKey);
      const newSecret = generateSubjectSigningSecret();
      const actorUserId = req.session?.userId ?? null;

      return withStageBump(pool, publisher, async (client) => {
        const res = await client.query<{ id: string; key: string; subject_signing_secret: string }>(
          `UPDATE stages SET subject_signing_secret = $1
           WHERE workspace_id = $2 AND key = $3
           RETURNING id, key, subject_signing_secret`,
          [newSecret, ws.id, req.params.stageKey],
        );
        const row = res.rows[0];
        if (!row) throw notFound("stage", req.params.stageKey);
        return {
          result: { subjectSigningSecret: row.subject_signing_secret },
          stageIds: [row.id],
          audit: {
            workspaceId: ws.id,
            actorUserId,
            action: "stage.subjectSigningSecretReset",
            target: `stage:${row.key}`,
            // Same rule as server keys: never write the secret to the audit row.
            after: { rotated: true },
          },
        };
      });
    },
  );
}

export async function getStage(
  pool: Pool,
  workspaceId: string,
  stageKey: string,
): Promise<StageRow> {
  const res = await pool.query<StageRow>(
    "SELECT * FROM stages WHERE workspace_id = $1 AND key = $2",
    [workspaceId, stageKey],
  );
  const row = res.rows[0];
  if (!row) throw notFound("stage", stageKey);
  return row;
}
