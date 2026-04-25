import type { Pool } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type { Subject } from "@ffp/shared-types";

/**
 * Per PLAN.md §3.2: the resolver upserts every subject it sees on
 * /sdk/resolve into Postgres so the admin UI can later surface "known"
 * subjects (for pinned-subject pickers, audience members, etc.).
 *
 *  - Composite payloads expand to one row per typed sub-subject.
 *  - `name` is a built-in attribute (PLAN.md §2.3); it gets its own column.
 *  - `attributes` is a flat snapshot of every other field — replaced, not
 *    merged, on each call.
 *  - Persistence failures must NOT break flag evaluation (PLAN.md §3.2). We
 *    log them via the fastify logger and return.
 */

interface PersistableSubject {
  subjectType: string;
  subjectId: string;
  name: string | null;
  attributes: Record<string, unknown>;
}

const RESERVED_ATTRS = new Set(["type", "id", "name"]);

function attributesOf(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (RESERVED_ATTRS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

export function expandSubjects(subject: Subject): PersistableSubject[] {
  if (subject.type === "composite") {
    const out: PersistableSubject[] = [];
    // CompositeSubject.subjects is typed Record<string, Omit<SingleSubject, "type">>
    // but the index signature on SingleSubject collapses Omit's narrowing,
    // so TS sees the values as unknown. Cast to a workable shape here.
    const subs = subject.subjects as unknown as Record<string, Record<string, unknown>>;
    for (const [type, sub] of Object.entries(subs)) {
      const id = typeof sub.id === "string" ? sub.id : null;
      if (!id || id.length === 0) continue;
      const name = typeof sub.name === "string" ? sub.name : null;
      out.push({
        subjectType: type,
        subjectId: id,
        name,
        attributes: attributesOf(sub),
      });
    }
    return out;
  }
  // Single subject. SingleSubject guarantees `id` is a string per the type
  // declaration, but the route layer accepts unknown shapes — guard anyway.
  const single = subject as unknown as Record<string, unknown>;
  const id = single.id;
  const type = single.type;
  if (typeof id !== "string" || id.length === 0) return [];
  if (typeof type !== "string") return [];
  return [
    {
      subjectType: type,
      subjectId: id,
      name: typeof single.name === "string" ? single.name : null,
      attributes: attributesOf(single),
    },
  ];
}

export async function persistSubjects(args: {
  pool: Pool;
  workspaceId: string;
  stageId: string;
  subject: Subject;
  source: string;
  log: FastifyBaseLogger;
}): Promise<void> {
  const subjects = expandSubjects(args.subject);
  if (subjects.length === 0) return;

  // Single statement for both single + composite — avoids N round-trips for
  // a multi-subject payload. unnest() lets pg pivot the parallel arrays into
  // rows.
  try {
    await args.pool.query(
      `INSERT INTO subjects
         (workspace_id, stage_id, subject_type, subject_id, name, attributes, last_seen_via)
       SELECT $1, $2, t.subject_type, t.subject_id, t.name, t.attributes::jsonb, $3
       FROM unnest($4::text[], $5::text[], $6::text[], $7::text[])
         AS t(subject_type, subject_id, name, attributes)
       ON CONFLICT (stage_id, subject_type, subject_id) DO UPDATE
         SET name = COALESCE(EXCLUDED.name, subjects.name),
             attributes = EXCLUDED.attributes,
             last_seen_at = now(),
             last_seen_via = EXCLUDED.last_seen_via`,
      [
        args.workspaceId,
        args.stageId,
        args.source,
        subjects.map((s) => s.subjectType),
        subjects.map((s) => s.subjectId),
        subjects.map((s) => s.name),
        subjects.map((s) => JSON.stringify(s.attributes)),
      ],
    );
  } catch (err) {
    args.log.warn(
      { err, stageId: args.stageId, count: subjects.length },
      "subject persistence failed",
    );
  }
}
