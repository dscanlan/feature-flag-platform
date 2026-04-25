import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { config, resetDb, startResolver, type ResolverHarness } from "./helpers/setup.js";

/**
 * Phase 7: subject persistence on /sdk/resolve.
 *  - Single subject upserts one row.
 *  - Composite subject upserts one row per typed sub-subject.
 *  - Re-resolves bump last_seen_at and replace the attribute snapshot
 *    (PLAN.md §4: "stores the latest" — no merge).
 *  - The resolve response shape is unchanged when persistence is happening.
 */
describe("resolver: subject persistence", () => {
  let h: ResolverHarness;
  let publicKey: string;
  let stageId: string;

  beforeAll(async () => {
    const setup = new Pool({ connectionString: config.DATABASE_URL });
    await resetDb(setup);
    const { rows: wsRows } = await setup.query<{ id: string }>(
      "INSERT INTO workspaces (key, name) VALUES ('demo','Demo') RETURNING id",
    );
    const wsId = wsRows[0]!.id;
    const { rows: stRows } = await setup.query<{ id: string; public_key: string }>(
      `INSERT INTO stages (workspace_id, key, name, server_key, public_key)
       VALUES ($1,'production','Production','srv-subj-001','pub-subj-001')
       RETURNING id, public_key`,
      [wsId],
    );
    stageId = stRows[0]!.id;
    publicKey = stRows[0]!.public_key;
    const { rows: fRows } = await setup.query<{ id: string }>(
      `INSERT INTO flags (workspace_id, key, name, kind, values)
       VALUES ($1, 'gate', 'Gate', 'boolean', '[{"value":false},{"value":true}]'::jsonb)
       RETURNING id`,
      [wsId],
    );
    await setup.query(
      `INSERT INTO flag_stage_configs (flag_id, stage_id, enabled, disabled_value_index, default_serve, pinned, rules)
       VALUES ($1, $2, true, 0, '{"kind":"value","valueIndex":1}'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
      [fRows[0]!.id, stageId],
    );
    await setup.end();
    h = await startResolver();
  });

  afterAll(async () => {
    await h?.close();
  });

  async function resolveOnce(subject: unknown): Promise<Response> {
    return fetch(`${h.baseUrl}/sdk/resolve`, {
      method: "POST",
      headers: { authorization: `Bearer ${publicKey}`, "content-type": "application/json" },
      body: JSON.stringify({ subject }),
    });
  }

  async function row(
    subjectType: string,
    subjectId: string,
  ): Promise<{
    name: string | null;
    attributes: Record<string, unknown>;
    first_seen_at: Date;
    last_seen_at: Date;
    last_seen_via: string | null;
  } | null> {
    const r = await h.pool.query<{
      name: string | null;
      attributes: Record<string, unknown>;
      first_seen_at: Date;
      last_seen_at: Date;
      last_seen_via: string | null;
    }>(
      `SELECT name, attributes, first_seen_at, last_seen_at, last_seen_via
       FROM subjects WHERE stage_id = $1 AND subject_type = $2 AND subject_id = $3`,
      [stageId, subjectType, subjectId],
    );
    return r.rows[0] ?? null;
  }

  it("upserts a single subject and the flag resolution still works", async () => {
    const r = await resolveOnce({
      type: "user",
      id: "user-A",
      name: "Alice",
      plan: "pro",
      seats: 7,
    });
    expect(r.status).toBe(200);
    // Persistence runs in parallel with resolution — give it a moment.
    await new Promise((r) => setTimeout(r, 100));

    const row1 = await row("user", "user-A");
    expect(row1).not.toBeNull();
    expect(row1!.name).toBe("Alice");
    expect(row1!.attributes).toEqual({ plan: "pro", seats: 7 });
    expect(row1!.last_seen_via).toBe("sdk-resolve");
    expect(row1!.first_seen_at.getTime()).toBe(row1!.last_seen_at.getTime());
  });

  it("re-resolve bumps last_seen_at and replaces the attribute snapshot", async () => {
    const before = await row("user", "user-A");
    expect(before).not.toBeNull();
    // Tiny pause so timestamps definitely differ.
    await new Promise((r) => setTimeout(r, 50));

    await resolveOnce({ type: "user", id: "user-A", plan: "enterprise" });
    await new Promise((r) => setTimeout(r, 100));

    const after = await row("user", "user-A");
    expect(after).not.toBeNull();
    // Replace, not merge: `seats` from the first call is gone; `name` is
    // preserved via COALESCE because the second call omitted it.
    expect(after!.attributes).toEqual({ plan: "enterprise" });
    expect(after!.name).toBe("Alice");
    expect(after!.last_seen_at.getTime()).toBeGreaterThan(before!.last_seen_at.getTime());
    expect(after!.first_seen_at.getTime()).toBe(before!.first_seen_at.getTime());
  });

  it("composite subject expands to one row per typed sub-subject", async () => {
    const r = await resolveOnce({
      type: "composite",
      subjects: {
        user: { id: "user-B", name: "Bob", plan: "free" },
        account: { id: "acc-42", tier: "enterprise" },
        device: { id: "dev-x", os: "iOS" },
      },
    });
    expect(r.status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));

    expect((await row("user", "user-B"))!.attributes).toEqual({ plan: "free" });
    expect((await row("account", "acc-42"))!.attributes).toEqual({ tier: "enterprise" });
    expect((await row("device", "dev-x"))!.attributes).toEqual({ os: "iOS" });
    expect((await row("user", "user-B"))!.name).toBe("Bob");
  });

  it("malformed subjects (no id) don't crash and don't persist anything", async () => {
    // No id at all — admin-api/zod won't accept this on the SDK path because
    // the route validates with subjectSchema. Sanity-check that the test
    // harness still gets a clean 400 and no rows leak in.
    const r = await resolveOnce({ type: "user" });
    expect(r.status).toBe(400);
    const stale = await h.pool.query<{ count: string }>(
      "SELECT count(*)::text FROM subjects WHERE stage_id = $1 AND subject_type = 'user' AND subject_id = ''",
      [stageId],
    );
    expect(stale.rows[0]!.count).toBe("0");
  });
});
