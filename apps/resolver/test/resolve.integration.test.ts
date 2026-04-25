import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { config, resetDb, startResolver, type ResolverHarness } from "./helpers/setup.js";

describe("resolver: load + serve + redis subscribe", () => {
  let h: ResolverHarness;
  let serverKey: string;
  let publicKey: string;
  let stageId: string;

  beforeAll(async () => {
    const setup = new Pool({ connectionString: config.DATABASE_URL });
    await resetDb(setup);

    // Seed: workspace, stage, flag, flag_stage_config (enabled=true, default=index 1).
    const { rows: wsRows } = await setup.query<{ id: string }>(
      "INSERT INTO workspaces (key, name) VALUES ('demo','Demo') RETURNING id",
    );
    const wsId = wsRows[0]!.id;
    const { rows: stRows } = await setup.query<{
      id: string;
      server_key: string;
      public_key: string;
    }>(
      `INSERT INTO stages (workspace_id, key, name, server_key, public_key)
       VALUES ($1,'production','Production','srv-test-001','pub-test-001') RETURNING id, server_key, public_key`,
      [wsId],
    );
    stageId = stRows[0]!.id;
    serverKey = stRows[0]!.server_key;
    publicKey = stRows[0]!.public_key;
    const { rows: fRows } = await setup.query<{ id: string }>(
      `INSERT INTO flags (workspace_id, key, name, kind, values)
       VALUES ($1, 'new-checkout', 'New checkout', 'boolean',
               '[{"value":false},{"value":true}]'::jsonb) RETURNING id`,
      [wsId],
    );
    const flagId = fRows[0]!.id;
    await setup.query(
      `INSERT INTO flag_stage_configs (flag_id, stage_id, enabled, disabled_value_index, default_serve, pinned, rules)
       VALUES ($1, $2, true, 0, '{"kind":"value","valueIndex":1}'::jsonb,
               '[{"subjectType":"user","subjectId":"user-pinned","valueIndex":0}]'::jsonb,
               '[]'::jsonb)`,
      [flagId, stageId],
    );
    await setup.end();

    h = await startResolver();
  });

  afterAll(async () => {
    await h?.close();
  });

  it("rejects requests without a bearer", async () => {
    const r = await fetch(`${h.baseUrl}/sdk/resolve`, { method: "POST", body: "{}" });
    expect(r.status).toBe(401);
  });

  it("rejects a server key on /sdk/resolve (forbidden)", async () => {
    const r = await fetch(`${h.baseUrl}/sdk/resolve`, {
      method: "POST",
      headers: { authorization: `Bearer ${serverKey}`, "content-type": "application/json" },
      body: JSON.stringify({ subject: { type: "user", id: "x" } }),
    });
    expect(r.status).toBe(403);
  });

  it("returns the default value for an unpinned subject", async () => {
    const r = await fetch(`${h.baseUrl}/sdk/resolve`, {
      method: "POST",
      headers: { authorization: `Bearer ${publicKey}`, "content-type": "application/json" },
      body: JSON.stringify({ subject: { type: "user", id: "user-anon" } }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      results: Record<string, { value: unknown; reason: { kind: string } }>;
    };
    expect(body.results["new-checkout"]!.value).toBe(true);
    expect(body.results["new-checkout"]!.reason.kind).toBe("default");
  });

  it("returns the pinned value for a pinned subject", async () => {
    const r = await fetch(`${h.baseUrl}/sdk/resolve`, {
      method: "POST",
      headers: { authorization: `Bearer ${publicKey}`, "content-type": "application/json" },
      body: JSON.stringify({ subject: { type: "user", id: "user-pinned" } }),
    });
    const body = (await r.json()) as {
      results: Record<string, { value: unknown; reason: { kind: string } }>;
    };
    expect(body.results["new-checkout"]!.value).toBe(false);
    expect(body.results["new-checkout"]!.reason.kind).toBe("pinned");
  });

  it("re-fetches the ruleset when a publish is received on the stage channel", async () => {
    // Publish a config-changed and update the DB to disabled, then verify next call returns disabled value.
    const setup = new Pool({ connectionString: config.DATABASE_URL });
    await setup.query("UPDATE flag_stage_configs SET enabled = false");
    await setup.query("UPDATE stages SET version = version + 1 WHERE id = $1", [stageId]);
    await setup.end();
    await h.redisPub.publish(
      `ff:stage:${stageId}`,
      JSON.stringify({ kind: "config-changed", version: 1 }),
    );

    // Wait briefly for the resolver to refetch.
    await new Promise((r) => setTimeout(r, 200));

    const r = await fetch(`${h.baseUrl}/sdk/resolve`, {
      method: "POST",
      headers: { authorization: `Bearer ${publicKey}`, "content-type": "application/json" },
      body: JSON.stringify({ subject: { type: "user", id: "user-anon" } }),
    });
    const body = (await r.json()) as {
      results: Record<string, { value: unknown; reason: { kind: string } }>;
    };
    expect(body.results["new-checkout"]!.reason.kind).toBe("disabled");
  });

  it("/sdk/flags returns the full ruleset for server keys", async () => {
    const r = await fetch(`${h.baseUrl}/sdk/flags`, {
      headers: { authorization: `Bearer ${serverKey}` },
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      stage: { key: string };
      flags: { key: string }[];
      configs: { enabled: boolean }[];
      audiences: unknown[];
    };
    expect(body.stage.key).toBe("production");
    expect(body.flags.map((f) => f.key)).toContain("new-checkout");
    expect(body.configs).toHaveLength(1);
    expect(Array.isArray(body.audiences)).toBe(true);
  });

  it("audience membership changes flip flag resolution after a publish", async () => {
    // Re-enable the flag (earlier test disabled it), add an audience with
    // user-in-audience, and a rule that serves `true` only to that audience.
    const setup = new Pool({ connectionString: config.DATABASE_URL });
    const { rows: wsRows } = await setup.query<{ id: string }>(
      "SELECT id FROM workspaces WHERE key = 'demo'",
    );
    const wsId = wsRows[0]!.id;
    const { rows: flagRows } = await setup.query<{ id: string }>(
      "SELECT id FROM flags WHERE workspace_id = $1 AND key = 'new-checkout'",
      [wsId],
    );
    const flagId = flagRows[0]!.id;
    const { rows: audRows } = await setup.query<{ id: string }>(
      `INSERT INTO audiences (workspace_id, key, name, subject_type)
       VALUES ($1, 'beta', 'Beta', 'user') RETURNING id`,
      [wsId],
    );
    const audId = audRows[0]!.id;
    await setup.query(
      `INSERT INTO audience_stage_payloads (audience_id, stage_id, members, rules)
       VALUES ($1, $2,
               '[{"subjectType":"user","subjectId":"user-beta","included":true}]'::jsonb,
               '[]'::jsonb)`,
      [audId, stageId],
    );
    await setup.query(
      `UPDATE flag_stage_configs
         SET enabled = true,
             default_serve = '{"kind":"value","valueIndex":0}'::jsonb,
             rules = $1::jsonb,
             version = version + 1
       WHERE flag_id = $2 AND stage_id = $3`,
      [
        JSON.stringify([
          {
            id: "r1",
            clauses: [{ kind: "audience", op: "inAudience", audienceIds: [audId] }],
            serve: { kind: "value", valueIndex: 1 },
          },
        ]),
        flagId,
        stageId,
      ],
    );
    await setup.query("UPDATE stages SET version = version + 1 WHERE id = $1", [stageId]);
    await setup.end();
    await h.redisPub.publish(
      `ff:stage:${stageId}`,
      JSON.stringify({ kind: "config-changed", version: 2 }),
    );
    await new Promise((r) => setTimeout(r, 200));

    // In the audience → rule fires → true.
    const inAud = await fetch(`${h.baseUrl}/sdk/resolve`, {
      method: "POST",
      headers: { authorization: `Bearer ${publicKey}`, "content-type": "application/json" },
      body: JSON.stringify({ subject: { type: "user", id: "user-beta" } }),
    });
    const inBody = (await inAud.json()) as {
      results: Record<string, { value: unknown; reason: { kind: string } }>;
    };
    expect(inBody.results["new-checkout"]!.value).toBe(true);
    expect(inBody.results["new-checkout"]!.reason.kind).toBe("rule");

    // Not in the audience → default false.
    const outAud = await fetch(`${h.baseUrl}/sdk/resolve`, {
      method: "POST",
      headers: { authorization: `Bearer ${publicKey}`, "content-type": "application/json" },
      body: JSON.stringify({ subject: { type: "user", id: "stranger" } }),
    });
    const outBody = (await outAud.json()) as {
      results: Record<string, { value: unknown; reason: { kind: string } }>;
    };
    expect(outBody.results["new-checkout"]!.value).toBe(false);
    expect(outBody.results["new-checkout"]!.reason.kind).toBe("default");

    // Now exclude user-beta — they should fall out of the audience even though
    // they were explicitly included — excluded wins.
    const update = new Pool({ connectionString: config.DATABASE_URL });
    await update.query(
      `UPDATE audience_stage_payloads
         SET members = '[{"subjectType":"user","subjectId":"user-beta","included":false}]'::jsonb
       WHERE audience_id = $1 AND stage_id = $2`,
      [audId, stageId],
    );
    await update.query("UPDATE stages SET version = version + 1 WHERE id = $1", [stageId]);
    await update.end();
    await h.redisPub.publish(
      `ff:stage:${stageId}`,
      JSON.stringify({ kind: "config-changed", version: 3 }),
    );
    await new Promise((r) => setTimeout(r, 200));

    const afterExclude = await fetch(`${h.baseUrl}/sdk/resolve`, {
      method: "POST",
      headers: { authorization: `Bearer ${publicKey}`, "content-type": "application/json" },
      body: JSON.stringify({ subject: { type: "user", id: "user-beta" } }),
    });
    const afterBody = (await afterExclude.json()) as {
      results: Record<string, { value: unknown; reason: { kind: string } }>;
    };
    expect(afterBody.results["new-checkout"]!.value).toBe(false);
    expect(afterBody.results["new-checkout"]!.reason.kind).toBe("default");
  });

  it("serves a json flag end-to-end and tags results with kind", async () => {
    const setup = new Pool({ connectionString: config.DATABASE_URL });
    const { rows: wsRows } = await setup.query<{ id: string }>(
      "SELECT id FROM workspaces WHERE key = 'demo'",
    );
    const wsId = wsRows[0]!.id;
    const { rows: fRows } = await setup.query<{ id: string }>(
      `INSERT INTO flags (workspace_id, key, name, kind, values)
       VALUES ($1, 'pricing-table', 'Pricing table', 'json',
               '[{"name":"free","value":{"tier":"free","price":0}},
                 {"name":"pro","value":{"tier":"pro","price":12}},
                 {"name":"enterprise","value":{"tier":"enterprise","price":null}}]'::jsonb)
       RETURNING id`,
      [wsId],
    );
    const flagId = fRows[0]!.id;
    await setup.query(
      `INSERT INTO flag_stage_configs (flag_id, stage_id, enabled, disabled_value_index, default_serve, pinned, rules)
       VALUES ($1, $2, true, 0, '{"kind":"value","valueIndex":1}'::jsonb,
               '[{"subjectType":"user","subjectId":"vip","valueIndex":2}]'::jsonb,
               '[]'::jsonb)`,
      [flagId, stageId],
    );
    await setup.query("UPDATE stages SET version = version + 1 WHERE id = $1", [stageId]);
    await setup.end();
    await h.redisPub.publish(
      `ff:stage:${stageId}`,
      JSON.stringify({ kind: "config-changed", version: 4 }),
    );
    await new Promise((r) => setTimeout(r, 200));

    // Default value (index 1: pro)
    const def = await fetch(`${h.baseUrl}/sdk/resolve`, {
      method: "POST",
      headers: { authorization: `Bearer ${publicKey}`, "content-type": "application/json" },
      body: JSON.stringify({ subject: { type: "user", id: "anon" } }),
    });
    const defBody = (await def.json()) as {
      results: Record<
        string,
        { value: unknown; valueIndex: number | null; reason: { kind: string }; kind: string }
      >;
    };
    expect(defBody.results["pricing-table"]!.kind).toBe("json");
    expect(defBody.results["pricing-table"]!.value).toEqual({ tier: "pro", price: 12 });
    expect(defBody.results["pricing-table"]!.valueIndex).toBe(1);

    // Pinned subject gets index 2 (enterprise)
    const vip = await fetch(`${h.baseUrl}/sdk/resolve`, {
      method: "POST",
      headers: { authorization: `Bearer ${publicKey}`, "content-type": "application/json" },
      body: JSON.stringify({ subject: { type: "user", id: "vip" } }),
    });
    const vipBody = (await vip.json()) as {
      results: Record<string, { value: unknown; reason: { kind: string }; kind: string }>;
    };
    expect(vipBody.results["pricing-table"]!.value).toEqual({ tier: "enterprise", price: null });
    expect(vipBody.results["pricing-table"]!.reason.kind).toBe("pinned");

    // Switch the default to free (index 0) via DB + publish; the SDK-shaped
    // response should reflect the new default within one tick.
    const update = new Pool({ connectionString: config.DATABASE_URL });
    await update.query(
      `UPDATE flag_stage_configs SET default_serve = '{"kind":"value","valueIndex":0}'::jsonb,
                                     version = version + 1
       WHERE flag_id = $1 AND stage_id = $2`,
      [flagId, stageId],
    );
    await update.query("UPDATE stages SET version = version + 1 WHERE id = $1", [stageId]);
    await update.end();
    await h.redisPub.publish(
      `ff:stage:${stageId}`,
      JSON.stringify({ kind: "config-changed", version: 5 }),
    );
    await new Promise((r) => setTimeout(r, 200));

    const after = await fetch(`${h.baseUrl}/sdk/resolve`, {
      method: "POST",
      headers: { authorization: `Bearer ${publicKey}`, "content-type": "application/json" },
      body: JSON.stringify({ subject: { type: "user", id: "anon" } }),
    });
    const afterBody = (await after.json()) as {
      results: Record<string, { value: unknown }>;
    };
    expect(afterBody.results["pricing-table"]!.value).toEqual({ tier: "free", price: 0 });
  });
});
