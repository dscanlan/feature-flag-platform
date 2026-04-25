import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "./helpers/testApp.js";
import { loginCookie } from "./helpers/login.js";

/**
 * Phase 7 admin API: subjects list + detail. We seed the `subjects` table
 * directly here — the resolver's persistence path is covered separately in
 * apps/resolver/test/subjects.integration.test.ts.
 */
describe("admin API: subjects list + detail", () => {
  let h: TestHarness;
  let cookie: string;
  let stageId: string;

  beforeAll(async () => {
    h = await createTestHarness();
    cookie = await loginCookie(h);

    const ws = await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces",
      headers: { cookie, "content-type": "application/json" },
      payload: { key: "subj-ws", name: "subj-ws" },
    });
    expect(ws.statusCode).toBe(201);
    const stage = await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces/subj-ws/stages",
      headers: { cookie, "content-type": "application/json" },
      payload: { key: "production", name: "Production" },
    });
    expect(stage.statusCode).toBe(201);
    stageId = stage.json<{ id: string }>().id;

    // Seed 5 subjects with descending last_seen_at so we can exercise
    // pagination and ordering deterministically.
    const baseMs = Date.now();
    const seed = async (
      subjectType: string,
      subjectId: string,
      name: string | null,
      attrs: Record<string, unknown>,
      offsetMs: number,
    ): Promise<void> => {
      await h.pool.query(
        `INSERT INTO subjects (workspace_id, stage_id, subject_type, subject_id, name, attributes, first_seen_at, last_seen_at, last_seen_via)
         SELECT $1, $2, $3, $4, $5, $6::jsonb, to_timestamp($7), to_timestamp($7), 'sdk-resolve'
         FROM stages WHERE id = $2 LIMIT 1`,
        [
          (
            await h.pool.query<{ workspace_id: string }>(
              "SELECT workspace_id FROM stages WHERE id = $1",
              [stageId],
            )
          ).rows[0]!.workspace_id,
          stageId,
          subjectType,
          subjectId,
          name,
          JSON.stringify(attrs),
          (baseMs - offsetMs) / 1000,
        ],
      );
    };
    await seed("user", "alice", "Alice", { plan: "pro" }, 0);
    await seed("user", "bob", "Bob", { plan: "free" }, 1000);
    await seed("user", "alfred", "Alfred", { plan: "pro" }, 2000);
    await seed("account", "acc-1", null, { tier: "enterprise" }, 3000);
    await seed("device", "dev-7", null, { os: "iOS" }, 4000);
  });

  afterAll(async () => {
    await h?.close();
  });

  it("lists all subjects for a stage in last_seen_at DESC order", async () => {
    const r = await h.app.inject({
      method: "GET",
      url: "/api/v1/workspaces/subj-ws/stages/production/subjects",
      headers: { cookie },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json<{
      items: { subjectType: string; subjectId: string }[];
      nextCursor: string | null;
    }>();
    expect(body.items.map((s) => `${s.subjectType}:${s.subjectId}`)).toEqual([
      "user:alice",
      "user:bob",
      "user:alfred",
      "account:acc-1",
      "device:dev-7",
    ]);
    expect(body.nextCursor).toBeNull();
  });

  it("filters by subjectType", async () => {
    const r = await h.app.inject({
      method: "GET",
      url: "/api/v1/workspaces/subj-ws/stages/production/subjects?subjectType=user",
      headers: { cookie },
    });
    const body = r.json<{ items: { subjectId: string }[] }>();
    expect(body.items.map((s) => s.subjectId)).toEqual(["alice", "bob", "alfred"]);
  });

  it("filters by q (case-insensitive substring on subject_id)", async () => {
    const r = await h.app.inject({
      method: "GET",
      url: "/api/v1/workspaces/subj-ws/stages/production/subjects?q=AL",
      headers: { cookie },
    });
    const body = r.json<{ items: { subjectId: string }[] }>();
    // "alice" and "alfred" both contain "al"; "bob" doesn't.
    expect(body.items.map((s) => s.subjectId).sort()).toEqual(["alfred", "alice"]);
  });

  it("paginates with a stable keyset cursor", async () => {
    const page1 = await h.app.inject({
      method: "GET",
      url: "/api/v1/workspaces/subj-ws/stages/production/subjects?limit=2",
      headers: { cookie },
    });
    const body1 = page1.json<{
      items: { subjectId: string }[];
      nextCursor: string | null;
    }>();
    expect(body1.items.map((s) => s.subjectId)).toEqual(["alice", "bob"]);
    expect(body1.nextCursor).not.toBeNull();

    const page2 = await h.app.inject({
      method: "GET",
      url: `/api/v1/workspaces/subj-ws/stages/production/subjects?limit=2&cursor=${encodeURIComponent(body1.nextCursor!)}`,
      headers: { cookie },
    });
    const body2 = page2.json<{
      items: { subjectId: string }[];
      nextCursor: string | null;
    }>();
    expect(body2.items.map((s) => s.subjectId)).toEqual(["alfred", "acc-1"]);
    expect(body2.nextCursor).not.toBeNull();

    const page3 = await h.app.inject({
      method: "GET",
      url: `/api/v1/workspaces/subj-ws/stages/production/subjects?limit=2&cursor=${encodeURIComponent(body2.nextCursor!)}`,
      headers: { cookie },
    });
    const body3 = page3.json<{
      items: { subjectId: string }[];
      nextCursor: string | null;
    }>();
    expect(body3.items.map((s) => s.subjectId)).toEqual(["dev-7"]);
    expect(body3.nextCursor).toBeNull();
  });

  it("detail returns the full snapshot on hit", async () => {
    const r = await h.app.inject({
      method: "GET",
      url: "/api/v1/workspaces/subj-ws/stages/production/subjects/user/alice",
      headers: { cookie },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json<{
      subjectType: string;
      subjectId: string;
      name: string | null;
      attributes: Record<string, unknown>;
      firstSeenAt: string;
      lastSeenAt: string;
    }>();
    expect(body.subjectType).toBe("user");
    expect(body.subjectId).toBe("alice");
    expect(body.name).toBe("Alice");
    expect(body.attributes).toEqual({ plan: "pro" });
    expect(typeof body.firstSeenAt).toBe("string");
    expect(typeof body.lastSeenAt).toBe("string");
  });

  it("detail 404s on a miss", async () => {
    const r = await h.app.inject({
      method: "GET",
      url: "/api/v1/workspaces/subj-ws/stages/production/subjects/user/missing",
      headers: { cookie },
    });
    expect(r.statusCode).toBe(404);
    const body = r.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("requires auth", async () => {
    const r = await h.app.inject({
      method: "GET",
      url: "/api/v1/workspaces/subj-ws/stages/production/subjects",
    });
    expect(r.statusCode).toBe(401);
  });
});
