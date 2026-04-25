import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "./helpers/testApp.js";
import { loginCookie } from "./helpers/login.js";

describe("admin-api flags integration", () => {
  let h: TestHarness;
  let cookie: string;

  beforeAll(async () => {
    h = await createTestHarness();
    cookie = await loginCookie(h);
  });

  afterAll(async () => {
    await h?.close();
  });

  it("creates workspace, stage, flag and toggles enabled, bumping stage version", async () => {
    // Workspace
    const ws = await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces",
      headers: { cookie },
      payload: { key: "demo", name: "Demo" },
    });
    expect(ws.statusCode).toBe(201);
    expect(ws.json().key).toBe("demo");

    // Stage
    const stage = await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces/demo/stages",
      headers: { cookie },
      payload: { key: "production", name: "Production" },
    });
    expect(stage.statusCode).toBe(201);
    const stageBody = stage.json();
    expect(stageBody.key).toBe("production");
    expect(stageBody.serverKey).toMatch(/^srv-/);
    expect(stageBody.publicKey).toMatch(/^pub-/);
    expect(stageBody.version).toBe(0);

    // Flag (boolean)
    const flag = await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces/demo/flags",
      headers: { cookie },
      payload: { key: "new-checkout", name: "New checkout", kind: "boolean" },
    });
    expect(flag.statusCode).toBe(201);
    const flagBody = flag.json();
    expect(flagBody.kind).toBe("boolean");
    expect(flagBody.values).toEqual([{ value: false }, { value: true }]);

    // Detail call returns the per-stage config row that was auto-created
    const detail = await h.app.inject({
      method: "GET",
      url: "/api/v1/workspaces/demo/flags/new-checkout",
      headers: { cookie },
    });
    expect(detail.statusCode).toBe(200);
    const detailBody = detail.json();
    expect(detailBody.configs).toHaveLength(1);
    expect(detailBody.configs[0].enabled).toBe(false);
    expect(detailBody.configs[0].defaultServe).toEqual({ kind: "value", valueIndex: 0 });

    // Subscribe to the publish channel before toggling.
    const sub = h.redis.duplicate();
    await sub.subscribe(`ff:stage:${stageBody.id}`);
    const messagePromise = new Promise<string>((resolve) => {
      sub.on("message", (_chan, msg) => resolve(msg));
    });

    // Toggle on.
    const toggled = await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces/demo/flags/new-checkout/stages/production/toggle",
      headers: { cookie },
      payload: { enabled: true },
    });
    expect(toggled.statusCode).toBe(200);
    const toggledBody = toggled.json();
    expect(toggledBody.enabled).toBe(true);
    // both the per-stage config and the parent stage version bumped
    expect(toggledBody.version).toBeGreaterThan(0);

    // Stage row's version bumped via Redis publish payload.
    const msg = await Promise.race([
      messagePromise,
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error("no publish")), 5000)),
    ]);
    const parsed = JSON.parse(msg);
    expect(parsed.kind).toBe("config-changed");
    expect(parsed.version).toBeGreaterThan(0);

    sub.disconnect();
  });

  it("updates per-stage config: defaultServe + pinned + disabledValueIndex", async () => {
    const put = await h.app.inject({
      method: "PUT",
      url: "/api/v1/workspaces/demo/flags/new-checkout/stages/production",
      headers: { cookie },
      payload: {
        enabled: true,
        disabledValueIndex: 0,
        defaultServe: { kind: "value", valueIndex: 1 },
        pinned: [{ subjectType: "user", subjectId: "user-123", valueIndex: 0 }],
      },
    });
    expect(put.statusCode).toBe(200);
    const body = put.json();
    expect(body.defaultServe).toEqual({ kind: "value", valueIndex: 1 });
    expect(body.pinned).toEqual([{ subjectType: "user", subjectId: "user-123", valueIndex: 0 }]);
  });

  it("rejects defaultServe out of range", async () => {
    const put = await h.app.inject({
      method: "PUT",
      url: "/api/v1/workspaces/demo/flags/new-checkout/stages/production",
      headers: { cookie },
      payload: {
        enabled: true,
        disabledValueIndex: 0,
        defaultServe: { kind: "value", valueIndex: 99 },
        pinned: [],
      },
    });
    expect(put.statusCode).toBe(400);
    expect(put.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects duplicate workspace key", async () => {
    const dup = await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces",
      headers: { cookie },
      payload: { key: "demo", name: "Demo again" },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe("CONFLICT");
  });

  it("resets a Server Key", async () => {
    const before = (
      await h.app.inject({
        method: "GET",
        url: "/api/v1/workspaces/demo/stages",
        headers: { cookie },
      })
    ).json()[0].serverKey;

    const reset = await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces/demo/stages/production/server-key/reset",
      headers: { cookie },
    });
    expect(reset.statusCode).toBe(200);
    const after = reset.json().serverKey;
    expect(after).toMatch(/^srv-/);
    expect(after).not.toBe(before);
  });
});
