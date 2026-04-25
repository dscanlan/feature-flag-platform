import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "./helpers/testApp.js";
import { loginCookie } from "./helpers/login.js";

/**
 * Phase 6 — admin-side hardening. Exercises:
 *  - audit_log rows on workspace/stage/flag writes,
 *  - stage CORS allow-list PATCH, including validation of origin format,
 *  - Server Key rotation via the existing endpoint, including that the
 *    audit row does NOT contain the secret value.
 */
describe("Phase 6 admin: audit, CORS, server-key rotation", () => {
  let h: TestHarness;
  let cookie: string;

  beforeAll(async () => {
    h = await createTestHarness();
    cookie = await loginCookie(h);
  });

  afterAll(async () => {
    await h?.close();
  });

  async function createWorkspaceAndStage(
    wsKey: string,
  ): Promise<{ wsId: string; stageKey: string }> {
    const ws = await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces",
      headers: { cookie, "content-type": "application/json" },
      payload: { key: wsKey, name: wsKey },
    });
    expect(ws.statusCode).toBe(201);
    const wsBody = ws.json() as { id: string };

    const stage = await h.app.inject({
      method: "POST",
      url: `/api/v1/workspaces/${wsKey}/stages`,
      headers: { cookie, "content-type": "application/json" },
      payload: { key: "production", name: "Production" },
    });
    expect(stage.statusCode).toBe(201);

    return { wsId: wsBody.id, stageKey: "production" };
  }

  it("stages are seeded with corsOrigins=['*'] and audit_log records the create", async () => {
    const { wsId } = await createWorkspaceAndStage("audit-ws-1");
    const list = await h.app.inject({
      method: "GET",
      url: "/api/v1/workspaces/audit-ws-1/stages",
      headers: { cookie },
    });
    const stages = list.json() as { corsOrigins: string[] }[];
    expect(stages[0]!.corsOrigins).toEqual(["*"]);

    const audits = await h.pool.query<{ action: string; target: string; after: unknown }>(
      "SELECT action, target, after FROM audit_log WHERE workspace_id = $1 ORDER BY at",
      [wsId],
    );
    const actions = audits.rows.map((r) => r.action);
    expect(actions).toContain("workspace.create");
    expect(actions).toContain("stage.create");
  });

  it("PATCH stage cors_origins validates + round-trips", async () => {
    await createWorkspaceAndStage("audit-ws-2");

    // Bad origin → 400.
    const bad = await h.app.inject({
      method: "PATCH",
      url: "/api/v1/workspaces/audit-ws-2/stages/production",
      headers: { cookie, "content-type": "application/json" },
      payload: { corsOrigins: ["not-a-url/foo"] },
    });
    expect(bad.statusCode).toBe(400);

    // Good → 200 and reflected in GET.
    const ok = await h.app.inject({
      method: "PATCH",
      url: "/api/v1/workspaces/audit-ws-2/stages/production",
      headers: { cookie, "content-type": "application/json" },
      payload: { corsOrigins: ["https://app.example.com"] },
    });
    expect(ok.statusCode).toBe(200);
    const after = ok.json() as { corsOrigins: string[] };
    expect(after.corsOrigins).toEqual(["https://app.example.com"]);

    const audits = await h.pool.query<{ before: unknown; after: unknown }>(
      "SELECT before, after FROM audit_log WHERE action = 'stage.update' ORDER BY at DESC LIMIT 1",
    );
    expect(audits.rows[0]!.before).toEqual({ corsOrigins: ["*"] });
    expect(audits.rows[0]!.after).toEqual({ corsOrigins: ["https://app.example.com"] });
  });

  it("server-key reset changes the key, bumps stage.version, and logs without leaking the key", async () => {
    await createWorkspaceAndStage("audit-ws-3");
    const before = await h.app.inject({
      method: "GET",
      url: "/api/v1/workspaces/audit-ws-3/stages",
      headers: { cookie },
    });
    const [stageBefore] = before.json() as {
      serverKey: string;
      version: number;
    }[];

    const reset = await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces/audit-ws-3/stages/production/server-key/reset",
      headers: { cookie },
    });
    expect(reset.statusCode).toBe(200);
    const { serverKey: newKey } = reset.json() as { serverKey: string };
    expect(newKey).not.toBe(stageBefore!.serverKey);
    expect(newKey.startsWith("srv-")).toBe(true);

    const after = await h.app.inject({
      method: "GET",
      url: "/api/v1/workspaces/audit-ws-3/stages",
      headers: { cookie },
    });
    const [stageAfter] = after.json() as { serverKey: string; version: number }[];
    expect(stageAfter!.serverKey).toBe(newKey);
    expect(stageAfter!.version).toBeGreaterThan(stageBefore!.version);

    const audits = await h.pool.query<{ after: unknown }>(
      "SELECT after FROM audit_log WHERE action = 'stage.serverKeyReset' ORDER BY at DESC LIMIT 1",
    );
    const logged = JSON.stringify(audits.rows[0]!.after);
    expect(logged).toContain("rotated");
    // Critical: the rotated key must NOT be in the audit payload (AGENT.md §12.2).
    expect(logged).not.toContain(newKey);
    expect(logged).not.toContain(stageBefore!.serverKey);
  });

  it("flag create + toggle produce audit rows with before/after", async () => {
    await createWorkspaceAndStage("audit-ws-4");
    const createFlag = await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces/audit-ws-4/flags",
      headers: { cookie, "content-type": "application/json" },
      payload: { key: "gate", name: "Gate", kind: "boolean" },
    });
    expect(createFlag.statusCode).toBe(201);

    const toggle = await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces/audit-ws-4/flags/gate/stages/production/toggle",
      headers: { cookie, "content-type": "application/json" },
      payload: { enabled: true },
    });
    expect(toggle.statusCode).toBe(200);

    const audits = await h.pool.query<{ action: string; before: unknown; after: unknown }>(
      `SELECT action, before, after FROM audit_log
       WHERE action IN ('flag.create', 'flagStageConfig.toggle')
       ORDER BY at`,
    );
    expect(audits.rows.map((r) => r.action)).toEqual(["flag.create", "flagStageConfig.toggle"]);
    expect(audits.rows[1]!.before).toEqual({ enabled: false });
    expect(audits.rows[1]!.after).toEqual({ enabled: true });
  });
});
