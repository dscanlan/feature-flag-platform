import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { notFound, validation } from "../lib/errors.js";
import type { PersistedSubject } from "@ffp/shared-types";
import { getWorkspace } from "./workspaces.js";
import { getStage } from "./stages.js";

interface SubjectRow {
  id: string;
  workspace_id: string;
  stage_id: string;
  subject_type: string;
  subject_id: string;
  name: string | null;
  attributes: Record<string, unknown>;
  first_seen_at: Date;
  last_seen_at: Date;
  last_seen_via: string | null;
}

const toSubject = (r: SubjectRow): PersistedSubject => ({
  id: r.id,
  workspaceId: r.workspace_id,
  stageId: r.stage_id,
  subjectType: r.subject_type,
  subjectId: r.subject_id,
  name: r.name,
  attributes: r.attributes,
  firstSeenAt: r.first_seen_at.toISOString(),
  lastSeenAt: r.last_seen_at.toISOString(),
  lastSeenVia: r.last_seen_via,
});

const listQuery = z.object({
  subjectType: z.string().min(1).max(120).optional(),
  q: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});

interface Cursor {
  /** ISO-8601 last_seen_at of the last row on the previous page. */
  t: string;
  /** UUID id, used as a tiebreaker so paging is stable when timestamps tie. */
  i: string;
}

function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
    if (typeof obj.t !== "string" || typeof obj.i !== "string") return null;
    return obj;
  } catch {
    return null;
  }
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

export function registerSubjectRoutes(app: FastifyInstance, pool: Pool): void {
  // List subjects for a stage.
  // Pagination: keyset on (last_seen_at DESC, id DESC). Stable across inserts.
  // Filters: optional subjectType (exact) and q (case-insensitive prefix on
  // subject_id; falls back to ILIKE %q% on subject_id when no subjectType
  // hint is given so the index is still usable).
  app.get<{
    Params: { wsKey: string; stageKey: string };
    Querystring: { subjectType?: string; q?: string; limit?: string; cursor?: string };
  }>(
    "/api/v1/workspaces/:wsKey/stages/:stageKey/subjects",
    { preHandler: [app.requireAuth] },
    async (req) => {
      const parsed = listQuery.safeParse(req.query);
      if (!parsed.success) throw validation("invalid query", parsed.error.issues);
      const { subjectType, q, limit = 50 } = parsed.data;
      const cursor = decodeCursor(parsed.data.cursor);

      const ws = await getWorkspace(pool, req.params.wsKey);
      const stage = await getStage(pool, ws.id, req.params.stageKey);

      const args: unknown[] = [stage.id];
      const where: string[] = ["stage_id = $1"];
      if (subjectType) {
        args.push(subjectType);
        where.push(`subject_type = $${args.length}`);
      }
      if (q) {
        args.push(`%${q.toLowerCase()}%`);
        where.push(`lower(subject_id) LIKE $${args.length}`);
      }
      if (cursor) {
        args.push(cursor.t);
        const tParam = `$${args.length}`;
        args.push(cursor.i);
        const iParam = `$${args.length}`;
        where.push(`(last_seen_at, id) < (${tParam}::timestamptz, ${iParam}::uuid)`);
      }
      args.push(limit + 1); // fetch one extra to know if there's a next page
      const limitParam = `$${args.length}`;

      const sql = `SELECT * FROM subjects
                   WHERE ${where.join(" AND ")}
                   ORDER BY last_seen_at DESC, id DESC
                   LIMIT ${limitParam}`;
      const res = await pool.query<SubjectRow>(sql, args);

      const rows = res.rows.slice(0, limit);
      const items = rows.map(toSubject);
      let nextCursor: string | null = null;
      if (res.rows.length > limit && rows.length > 0) {
        const last = rows[rows.length - 1]!;
        nextCursor = encodeCursor({
          t: last.last_seen_at.toISOString(),
          i: last.id,
        });
      }
      return { items, nextCursor };
    },
  );

  // Detail by (subjectType, subjectId).
  app.get<{
    Params: { wsKey: string; stageKey: string; subjectType: string; subjectId: string };
  }>(
    "/api/v1/workspaces/:wsKey/stages/:stageKey/subjects/:subjectType/:subjectId",
    { preHandler: [app.requireAuth] },
    async (req) => {
      const ws = await getWorkspace(pool, req.params.wsKey);
      const stage = await getStage(pool, ws.id, req.params.stageKey);
      const res = await pool.query<SubjectRow>(
        `SELECT * FROM subjects
         WHERE stage_id = $1 AND subject_type = $2 AND subject_id = $3`,
        [stage.id, req.params.subjectType, req.params.subjectId],
      );
      const row = res.rows[0];
      if (!row) {
        throw notFound("subject", `${req.params.subjectType}:${req.params.subjectId}`);
      }
      return toSubject(row);
    },
  );
}
