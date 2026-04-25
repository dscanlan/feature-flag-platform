import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { conflict, notFound, validation } from "../lib/errors.js";
import { isValidKey } from "../lib/keys.js";
import { writeAudit } from "../db/audit.js";
import { toFlag, toFlagStageConfig, type FlagRow, type FlagStageConfigRow } from "../db/mappers.js";
import { getWorkspace, isUniqueViolation } from "./workspaces.js";
import { getStage } from "./stages.js";
import { withStageBump, type Publisher } from "../db/publish.js";

const flagValueSchema = z.object({
  value: z.unknown(),
  name: z.string().optional(),
  description: z.string().optional(),
});

const MAX_JSON_VALUE_BYTES = 32 * 1024;

const createBody = z.object({
  key: z.string().refine(isValidKey, "invalid key"),
  name: z.string().min(1).max(120),
  description: z.string().optional(),
  kind: z.enum(["boolean", "json"]),
  values: z.array(flagValueSchema).min(2).optional(),
  tags: z.array(z.string()).optional(),
});

const serveSpecSchema = z.union([
  z.object({ kind: z.literal("value"), valueIndex: z.number().int().nonnegative() }),
  z.object({
    kind: z.literal("split"),
    splitKeySubjectType: z.string(),
    buckets: z
      .array(
        z.object({
          valueIndex: z.number().int().nonnegative(),
          weight: z.number().int().nonnegative(),
        }),
      )
      .min(2),
  }),
]);

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

const clauseSchema = z.union([
  z.object({
    kind: z.literal("attribute"),
    subjectType: z.string().min(1),
    attribute: z.string().min(1),
    op: attributeOpSchema,
    values: z.array(z.union([z.string(), z.number(), z.boolean()])),
    negate: z.boolean(),
  }),
  z.object({
    kind: z.literal("audience"),
    op: z.enum(["inAudience", "notInAudience"]),
    audienceIds: z.array(z.string().uuid()).min(1),
  }),
]);

const ruleSchema = z.object({
  id: z.string().min(1),
  description: z.string().optional(),
  clauses: z.array(clauseSchema),
  serve: serveSpecSchema,
});

const pinnedSchema = z.array(
  z.object({
    subjectType: z.string(),
    subjectId: z.string(),
    valueIndex: z.number().int().nonnegative(),
  }),
);

const putConfigBody = z.object({
  enabled: z.boolean(),
  disabledValueIndex: z.number().int().nonnegative(),
  defaultServe: serveSpecSchema,
  pinned: pinnedSchema,
  rules: z.array(ruleSchema).optional(),
});

const toggleBody = z.object({ enabled: z.boolean() });

export function registerFlagRoutes(app: FastifyInstance, pool: Pool, publisher: Publisher): void {
  app.get<{ Params: { wsKey: string } }>(
    "/api/v1/workspaces/:wsKey/flags",
    { preHandler: [app.requireAuth] },
    async (req) => {
      const ws = await getWorkspace(pool, req.params.wsKey);
      const res = await pool.query<FlagRow>(
        "SELECT * FROM flags WHERE workspace_id = $1 ORDER BY created_at",
        [ws.id],
      );
      return res.rows.map(toFlag);
    },
  );

  app.post<{ Params: { wsKey: string } }>(
    "/api/v1/workspaces/:wsKey/flags",
    { preHandler: [app.requireAuth] },
    async (req, reply) => {
      const body = createBody.safeParse(req.body);
      if (!body.success) throw validation("invalid body", body.error.issues);
      const ws = await getWorkspace(pool, req.params.wsKey);

      const values =
        body.data.kind === "boolean" ? [{ value: false }, { value: true }] : body.data.values;
      if (!values || values.length < 2) {
        throw validation("json flags require at least 2 values");
      }
      if (body.data.kind === "boolean") {
        const ok = values.length === 2 && values[0]!.value === false && values[1]!.value === true;
        if (!ok) throw validation("boolean flags must use [false, true] values");
      } else {
        validateJsonValues(values);
      }

      const actorUserId = req.session?.userId ?? null;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        let flagRow: FlagRow;
        try {
          const res = await client.query<FlagRow>(
            `INSERT INTO flags (workspace_id, key, name, description, kind, values, tags)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *`,
            [
              ws.id,
              body.data.key,
              body.data.name,
              body.data.description ?? null,
              body.data.kind,
              JSON.stringify(values),
              body.data.tags ?? [],
            ],
          );
          flagRow = res.rows[0]!;
        } catch (err) {
          if (isUniqueViolation(err)) throw conflict("flag key already exists in this workspace");
          throw err;
        }
        await client.query(
          `INSERT INTO flag_stage_configs (flag_id, stage_id, enabled, disabled_value_index, default_serve, pinned, rules)
           SELECT $1, s.id, false, 0, '{"kind":"value","valueIndex":0}'::jsonb, '[]'::jsonb, '[]'::jsonb
           FROM stages s WHERE s.workspace_id = $2`,
          [flagRow.id, ws.id],
        );
        await writeAudit(client, {
          workspaceId: ws.id,
          actorUserId,
          action: "flag.create",
          target: `flag:${flagRow.key}`,
          after: {
            key: flagRow.key,
            name: flagRow.name,
            kind: flagRow.kind,
            tags: flagRow.tags,
          },
        });
        await client.query("COMMIT");
        return reply.code(201).send(toFlag(flagRow));
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  );

  app.get<{ Params: { wsKey: string; flagKey: string } }>(
    "/api/v1/workspaces/:wsKey/flags/:flagKey",
    { preHandler: [app.requireAuth] },
    async (req) => {
      const ws = await getWorkspace(pool, req.params.wsKey);
      const flagRow = await getFlagOrThrow(pool, ws.id, req.params.flagKey);
      const cfgRes = await pool.query<FlagStageConfigRow>(
        `SELECT * FROM flag_stage_configs WHERE flag_id = $1`,
        [flagRow.id],
      );
      return {
        flag: toFlag(flagRow),
        configs: cfgRes.rows.map(toFlagStageConfig),
      };
    },
  );

  app.put<{ Params: { wsKey: string; flagKey: string; stageKey: string } }>(
    "/api/v1/workspaces/:wsKey/flags/:flagKey/stages/:stageKey",
    { preHandler: [app.requireAuth] },
    async (req) => {
      const body = putConfigBody.safeParse(req.body);
      if (!body.success) throw validation("invalid body", body.error.issues);
      const ws = await getWorkspace(pool, req.params.wsKey);
      const flagRow = await getFlagOrThrow(pool, ws.id, req.params.flagKey);
      const stageRow = await getStage(pool, ws.id, req.params.stageKey);
      const rules = body.data.rules ?? [];
      validateConfig(
        flagRow,
        body.data.disabledValueIndex,
        body.data.defaultServe,
        body.data.pinned,
        rules,
      );
      await validateAudienceReferences(pool, ws.id, rules);
      const actorUserId = req.session?.userId ?? null;

      return withStageBump(pool, publisher, async (client) => {
        const before = await client.query<FlagStageConfigRow>(
          `SELECT * FROM flag_stage_configs WHERE flag_id = $1 AND stage_id = $2 FOR UPDATE`,
          [flagRow.id, stageRow.id],
        );
        const prev = before.rows[0];
        if (!prev) throw notFound("flag_stage_config", `${flagRow.key}/${stageRow.key}`);

        const res = await client.query<FlagStageConfigRow>(
          `UPDATE flag_stage_configs SET
             enabled = $1,
             disabled_value_index = $2,
             default_serve = $3::jsonb,
             pinned = $4::jsonb,
             rules = $5::jsonb,
             version = version + 1,
             updated_at = now()
           WHERE flag_id = $6 AND stage_id = $7
           RETURNING *`,
          [
            body.data.enabled,
            body.data.disabledValueIndex,
            JSON.stringify(body.data.defaultServe),
            JSON.stringify(body.data.pinned),
            JSON.stringify(rules),
            flagRow.id,
            stageRow.id,
          ],
        );
        const row = res.rows[0]!;
        return {
          result: toFlagStageConfig(row),
          stageIds: [stageRow.id],
          audit: {
            workspaceId: ws.id,
            actorUserId,
            action: "flagStageConfig.update",
            target: `flag:${flagRow.key}/stage:${stageRow.key}`,
            before: toFlagStageConfig(prev),
            after: toFlagStageConfig(row),
          },
        };
      });
    },
  );

  app.post<{ Params: { wsKey: string; flagKey: string; stageKey: string } }>(
    "/api/v1/workspaces/:wsKey/flags/:flagKey/stages/:stageKey/toggle",
    { preHandler: [app.requireAuth] },
    async (req) => {
      const body = toggleBody.safeParse(req.body);
      if (!body.success) throw validation("invalid body", body.error.issues);
      const ws = await getWorkspace(pool, req.params.wsKey);
      const flagRow = await getFlagOrThrow(pool, ws.id, req.params.flagKey);
      const stageRow = await getStage(pool, ws.id, req.params.stageKey);
      const actorUserId = req.session?.userId ?? null;
      return withStageBump(pool, publisher, async (client) => {
        const before = await client.query<{ enabled: boolean }>(
          "SELECT enabled FROM flag_stage_configs WHERE flag_id = $1 AND stage_id = $2 FOR UPDATE",
          [flagRow.id, stageRow.id],
        );
        const prev = before.rows[0];
        if (!prev) throw notFound("flag_stage_config", `${flagRow.key}/${stageRow.key}`);
        const res = await client.query<FlagStageConfigRow>(
          `UPDATE flag_stage_configs SET enabled = $1, version = version + 1, updated_at = now()
           WHERE flag_id = $2 AND stage_id = $3 RETURNING *`,
          [body.data.enabled, flagRow.id, stageRow.id],
        );
        const row = res.rows[0]!;
        return {
          result: toFlagStageConfig(row),
          stageIds: [stageRow.id],
          audit: {
            workspaceId: ws.id,
            actorUserId,
            action: "flagStageConfig.toggle",
            target: `flag:${flagRow.key}/stage:${stageRow.key}`,
            before: { enabled: prev.enabled },
            after: { enabled: body.data.enabled },
          },
        };
      });
    },
  );
}

async function getFlagOrThrow(pool: Pool, workspaceId: string, key: string): Promise<FlagRow> {
  const res = await pool.query<FlagRow>(
    "SELECT * FROM flags WHERE workspace_id = $1 AND key = $2",
    [workspaceId, key],
  );
  const row = res.rows[0];
  if (!row) throw notFound("flag", key);
  return row;
}

type ServeSpecLite =
  | { kind: "value"; valueIndex: number }
  | { kind: "split"; buckets: { valueIndex: number; weight: number }[] };

interface RuleLite {
  serve: ServeSpecLite;
}

function validateConfig(
  flag: FlagRow,
  disabledValueIndex: number,
  defaultServe: ServeSpecLite,
  pinned: { valueIndex: number }[],
  rules: RuleLite[],
): void {
  const max = flag.values.length - 1;
  if (disabledValueIndex < 0 || disabledValueIndex > max) {
    throw validation(`disabledValueIndex out of range (0..${max})`);
  }
  validateServe(defaultServe, max, "defaultServe");
  for (const p of pinned) {
    if (p.valueIndex < 0 || p.valueIndex > max) {
      throw validation(`pinned.valueIndex out of range (0..${max})`);
    }
  }
  for (let i = 0; i < rules.length; i++) {
    validateServe(rules[i]!.serve, max, `rules[${i}].serve`);
  }
}

async function validateAudienceReferences(
  pool: Pool,
  workspaceId: string,
  rules: { clauses: { kind: string; audienceIds?: string[] }[] }[],
): Promise<void> {
  const referenced = new Set<string>();
  for (const rule of rules) {
    for (const c of rule.clauses) {
      if (c.kind === "audience" && c.audienceIds) {
        for (const id of c.audienceIds) referenced.add(id);
      }
    }
  }
  if (referenced.size === 0) return;
  const res = await pool.query<{ id: string }>(
    "SELECT id FROM audiences WHERE workspace_id = $1 AND id = ANY($2::uuid[])",
    [workspaceId, [...referenced]],
  );
  const known = new Set(res.rows.map((r) => r.id));
  for (const id of referenced) {
    if (!known.has(id)) {
      throw validation(`audience ${id} not found in this workspace`);
    }
  }
}

function validateJsonValues(values: { value?: unknown }[]): void {
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!.value;
    if (v === undefined) {
      throw validation(`values[${i}].value is required for json flags`);
    }
    let serialized: string;
    try {
      serialized = JSON.stringify(v);
    } catch {
      throw validation(`values[${i}].value is not JSON-serialisable`);
    }
    if (serialized === undefined) {
      throw validation(`values[${i}].value is not JSON-serialisable`);
    }
    const bytes = Buffer.byteLength(serialized, "utf8");
    if (bytes > MAX_JSON_VALUE_BYTES) {
      throw validation(`values[${i}].value is ${bytes} bytes, exceeds ${MAX_JSON_VALUE_BYTES}`);
    }
  }
}

function validateServe(spec: ServeSpecLite, max: number, label: string): void {
  if (spec.kind === "value") {
    if (spec.valueIndex < 0 || spec.valueIndex > max) {
      throw validation(`${label}.valueIndex out of range (0..${max})`);
    }
    return;
  }
  const sum = spec.buckets.reduce((a, b) => a + b.weight, 0);
  if (sum !== 100000) throw validation(`${label} bucket weights must sum to 100000 (got ${sum})`);
  for (const b of spec.buckets) {
    if (b.valueIndex < 0 || b.valueIndex > max) {
      throw validation(`${label} bucket valueIndex out of range (0..${max})`);
    }
  }
}
