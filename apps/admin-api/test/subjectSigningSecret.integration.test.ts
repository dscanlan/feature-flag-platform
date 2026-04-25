import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "./helpers/testApp.js";
import { loginCookie } from "./helpers/login.js";

/**
 * Phase 9 — admin-side subject-signing-secret lifecycle:
 *  - Auto-generated on stage create + revealed in the create response.
 *  - Hidden from list/get responses (you can't fetch it back later).
 *  - Reset endpoint returns a new secret, bumps stage.version, audits the
 *    rotation without leaking the value.
 */
describe("stage subject-signing-secret", () => {
  let h: TestHarness;
  let cookie: string;

  beforeAll(async () => {
    h = await createTestHarness();
    cookie = await loginCookie(h);
    const ws = await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces",
      headers: { cookie, "content-type": "application/json" },
      payload: { key: "trust-ws", name: "trust-ws" },
    });
    expect(ws.statusCode).toBe(201);
  });

  afterAll(async () => {
    await h?.close();
  });

  it("create returns the new secret once; list does NOT echo it", async () => {
    const create = await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces/trust-ws/stages",
      headers: { cookie, "content-type": "application/json" },
      payload: { key: "production", name: "Production" },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json<{ subjectSigningSecret?: string }>();
    expect(typeof created.subjectSigningSecret).toBe("string");
    expect(created.subjectSigningSecret!.length).toBeGreaterThanOrEqual(32);

    const list = await h.app.inject({
      method: "GET",
      url: "/api/v1/workspaces/trust-ws/stages",
      headers: { cookie },
    });
    const stages = list.json<{ subjectSigningSecret?: string }[]>();
    expect(stages[0]!.subjectSigningSecret).toBeUndefined();
  });

  it("reset endpoint rotates the secret + audits without leaking it", async () => {
    const before = await h.pool.query<{ subject_signing_secret: string; version: string }>(
      `SELECT s.subject_signing_secret, s.version FROM stages s
       JOIN workspaces w ON w.id = s.workspace_id
       WHERE w.key = 'trust-ws' AND s.key = 'production'`,
    );
    const prev = before.rows[0]!;

    const reset = await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces/trust-ws/stages/production/subject-signing-secret/reset",
      headers: { cookie },
    });
    expect(reset.statusCode).toBe(200);
    const { subjectSigningSecret: next } = reset.json<{ subjectSigningSecret: string }>();
    expect(next).not.toBe(prev.subject_signing_secret);
    expect(next.length).toBeGreaterThanOrEqual(32);

    const after = await h.pool.query<{ subject_signing_secret: string; version: string }>(
      `SELECT s.subject_signing_secret, s.version FROM stages s
       JOIN workspaces w ON w.id = s.workspace_id
       WHERE w.key = 'trust-ws' AND s.key = 'production'`,
    );
    const updated = after.rows[0]!;
    expect(updated.subject_signing_secret).toBe(next);
    expect(Number(updated.version)).toBeGreaterThan(Number(prev.version));

    const audits = await h.pool.query<{ after: unknown }>(
      `SELECT after FROM audit_log WHERE action = 'stage.subjectSigningSecretReset'
       ORDER BY at DESC LIMIT 1`,
    );
    const logged = JSON.stringify(audits.rows[0]!.after);
    expect(logged).toContain("rotated");
    expect(logged).not.toContain(next);
    expect(logged).not.toContain(prev.subject_signing_secret);
  });

  it("reset on an unknown stage → 404", async () => {
    const r = await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces/trust-ws/stages/nope/subject-signing-secret/reset",
      headers: { cookie },
    });
    expect(r.statusCode).toBe(404);
  });
});
