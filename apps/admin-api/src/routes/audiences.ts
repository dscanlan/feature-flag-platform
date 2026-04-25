import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { conflict, notFound, validation } from "../lib/errors.js";
import { isValidKey } from "../lib/keys.js";
import { writeAudit } from "../db/audit.js";
import { getWorkspace, isUniqueViolation } from "./workspaces.js";
import { getStage } from "./stages.js";
import { withStageBump, type Publisher } from "../db/publish.js";
import type { Audience, AudienceMember, AudienceRule } from "@ffp/shared-types";

interface AudienceRow {
  id: string;
  workspace_id: string;
  key: string;
  name: string;
  subject_type: string;
  created_at: Date;
}

interface PayloadRow {
  audience_id: string;
  stage_id: string;
  members: AudienceMember[];
  rules: AudienceRule[];
  updated_at: Date;
}

const attributeOpSchema = z.enum([
  "in",
  "notIn",
  "startsWith",
  "endsWith",
  "contains",
  "matches",
  "lessThan",
  "lessThanOrEqual",
  "greaterThan",
  "greaterThanOrEqual",
  "before",
  "after",
  "semVerEqual",
  "semVerLessThan",
  "semVerGreaterThan",
]);

// Audience rules re-use the same clause shape used by flag rules, so an admin
// can target by subject attribute. Nested audience clauses are intentionally
// forbidden here — see PLAN.md §2.5 — otherwise we'd need cycle detection.
const clauseSchema = z.object({
  kind: z.literal("attribute"),
  subjectType: z.string().min(1),
  attribute: z.string().min(1),
  op: attributeOpSchema,
  values: z.array(z.union([z.string(), z.number(), z.boolean()])),
  negate: z.boolean(),
});

const memberSchema = z.object({
  subjectType: z.string().min(1),
  subjectId: z.string().min(1),
  included: z.boolean(),
});

const ruleSchema = z.object({
  id: z.string().min(1),
  clauses: z.array(clauseSchema),
});

const createBody = z.object({
  key: z.string().refine(isValidKey, "invalid key"),
  name: z.string().min(1).max(120),
  subjectType: z.string().min(1),
});

const putPayloadBody = z.object({
  members: z.array(memberSchema),
  rules: z.array(ruleSchema),
});

export function registerAudienceRoutes(
  app: FastifyInstance,
  pool: Pool,
  publisher: Publisher,
): void {
  app.get<{ Params: { wsKey: string } }>(
    "/api/v1/workspaces/:wsKey/audiences",
    { preHandler: [app.requireAuth] },
    async (req) => {
      const ws = await getWorkspace(pool, req.params.wsKey);
      return listAudiences(pool, ws.id);
    },
  );

  app.get<{ Params: { wsKey: string; audKey: string } }>(
    "/api/v1/workspaces/:wsKey/audiences/:audKey",
    { preHandler: [app.requireAuth] },
    async (req) => {
      const ws = await getWorkspace(pool, req.params.wsKey);
      const row = await getAudience(pool, ws.id, req.params.audKey);
      const payloads = await pool.query<PayloadRow>(
        "SELECT * FROM audience_stage_payloads WHERE audience_id = $1",
        [row.id],
      );
      return toAudience(row, payloads.rows);
    },
  );

  app.post<{ Params: { wsKey: string } }>(
    "/api/v1/workspaces/:wsKey/audiences",
    { preHandler: [app.requireAuth] },
    async (req, reply) => {
      const body = createBody.safeParse(req.body);
      if (!body.success) throw validation("invalid body", body.error.issues);
      const ws = await getWorkspace(pool, req.params.wsKey);

      await assertSubjectTypeExists(pool, ws.id, body.data.subjectType);
      const actorUserId = req.session?.userId ?? null;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        let row: AudienceRow;
        try {
          const res = await client.query<AudienceRow>(
            `INSERT INTO audiences (workspace_id, key, name, subject_type)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [ws.id, body.data.key, body.data.name, body.data.subjectType],
          );
          row = res.rows[0]!;
        } catch (err) {
          if (isUniqueViolation(err))
            throw conflict("audience key already exists in this workspace");
          throw err;
        }
        await writeAudit(client, {
          workspaceId: ws.id,
          actorUserId,
          action: "audience.create",
          target: `audience:${row.key}`,
          after: { key: row.key, name: row.name, subjectType: row.subject_type },
        });
        await client.query("COMMIT");
        return reply.code(201).send(toAudience(row, []));
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  );

  app.put<{ Params: { wsKey: string; audKey: string; stageKey: string } }>(
    "/api/v1/workspaces/:wsKey/audiences/:audKey/stages/:stageKey",
    { preHandler: [app.requireAuth] },
    async (req) => {
      const body = putPayloadBody.safeParse(req.body);
      if (!body.success) throw validation("invalid body", body.error.issues);
      const ws = await getWorkspace(pool, req.params.wsKey);
      const audRow = await getAudience(pool, ws.id, req.params.audKey);
      const stageRow = await getStage(pool, ws.id, req.params.stageKey);

      validateMembers(body.data.members, audRow.subject_type);
      const actorUserId = req.session?.userId ?? null;

      return withStageBump(pool, publisher, async (client) => {
        const before = await client.query<PayloadRow>(
          "SELECT * FROM audience_stage_payloads WHERE audience_id = $1 AND stage_id = $2 FOR UPDATE",
          [audRow.id, stageRow.id],
        );
        const prev = before.rows[0];
        const res = await client.query<PayloadRow>(
          `INSERT INTO audience_stage_payloads (audience_id, stage_id, members, rules, updated_at)
           VALUES ($1, $2, $3::jsonb, $4::jsonb, now())
           ON CONFLICT (audience_id, stage_id) DO UPDATE
             SET members = EXCLUDED.members,
                 rules = EXCLUDED.rules,
                 updated_at = now()
           RETURNING *`,
          [
            audRow.id,
            stageRow.id,
            JSON.stringify(body.data.members),
            JSON.stringify(body.data.rules),
          ],
        );
        const row = res.rows[0]!;
        return {
          result: {
            audienceId: audRow.id,
            stageId: stageRow.id,
            members: row.members,
            rules: row.rules,
            updatedAt: row.updated_at.toISOString(),
          },
          stageIds: [stageRow.id],
          audit: {
            workspaceId: ws.id,
            actorUserId,
            action: "audienceStagePayload.update",
            target: `audience:${audRow.key}/stage:${stageRow.key}`,
            before: prev ? { members: prev.members, rules: prev.rules } : null,
            after: { members: row.members, rules: row.rules },
          },
        };
      });
    },
  );
}

async function listAudiences(pool: Pool, workspaceId: string): Promise<Audience[]> {
  const [audRes, payRes] = await Promise.all([
    pool.query<AudienceRow>("SELECT * FROM audiences WHERE workspace_id = $1 ORDER BY created_at", [
      workspaceId,
    ]),
    pool.query<PayloadRow>(
      `SELECT asp.* FROM audience_stage_payloads asp
       JOIN audiences a ON a.id = asp.audience_id
       WHERE a.workspace_id = $1`,
      [workspaceId],
    ),
  ]);
  const payloadsByAudience = new Map<string, PayloadRow[]>();
  for (const p of payRes.rows) {
    const list = payloadsByAudience.get(p.audience_id) ?? [];
    list.push(p);
    payloadsByAudience.set(p.audience_id, list);
  }
  return audRes.rows.map((r) => toAudience(r, payloadsByAudience.get(r.id) ?? []));
}

async function getAudience(pool: Pool, workspaceId: string, key: string): Promise<AudienceRow> {
  const res = await pool.query<AudienceRow>(
    "SELECT * FROM audiences WHERE workspace_id = $1 AND key = $2",
    [workspaceId, key],
  );
  const row = res.rows[0];
  if (!row) throw notFound("audience", key);
  return row;
}

async function assertSubjectTypeExists(
  pool: Pool,
  workspaceId: string,
  subjectType: string,
): Promise<void> {
  const res = await pool.query<{ id: string }>(
    "SELECT id FROM subject_types WHERE workspace_id = $1 AND key = $2",
    [workspaceId, subjectType],
  );
  if (res.rows.length === 0) {
    throw validation(`subject type '${subjectType}' not found in this workspace`);
  }
}

function validateMembers(members: AudienceMember[], subjectType: string): void {
  const seen = new Set<string>();
  for (const m of members) {
    if (m.subjectType !== subjectType) {
      throw validation(
        `member subjectType '${m.subjectType}' does not match audience subjectType '${subjectType}'`,
      );
    }
    const key = `${m.subjectType}:${m.subjectId}`;
    if (seen.has(key)) {
      throw validation(`duplicate member ${key}`);
    }
    seen.add(key);
  }
}

function toAudience(row: AudienceRow, payloads: PayloadRow[]): Audience {
  const perStage: Audience["perStage"] = {};
  for (const p of payloads) {
    perStage[p.stage_id] = { members: p.members, rules: p.rules };
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    key: row.key,
    name: row.name,
    subjectType: row.subject_type,
    perStage,
  };
}
