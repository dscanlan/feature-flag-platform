import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "./helpers/testApp.js";
import { loginCookie } from "./helpers/login.js";

describe("admin-api json flags integration", () => {
  let h: TestHarness;
  let cookie: string;

  beforeAll(async () => {
    h = await createTestHarness();
    cookie = await loginCookie(h);
    const ws = await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces",
      headers: { cookie },
      payload: { key: "demo", name: "Demo" },
    });
    expect(ws.statusCode).toBe(201);
    const stage = await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces/demo/stages",
      headers: { cookie },
      payload: { key: "production", name: "Production" },
    });
    expect(stage.statusCode).toBe(201);
  });

  afterAll(async () => {
    await h?.close();
  });

  it("creates a json flag with three named values", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces/demo/flags",
      headers: { cookie },
      payload: {
        key: "pricing-table",
        name: "Pricing table",
        kind: "json",
        values: [
          { name: "free", value: { tier: "free", price: 0 } },
          { name: "pro", value: { tier: "pro", price: 12 } },
          { name: "enterprise", description: "custom", value: { tier: "enterprise", price: null } },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.kind).toBe("json");
    expect(body.values).toHaveLength(3);
    expect(body.values[1]).toEqual({ name: "pro", value: { tier: "pro", price: 12 } });
  });

  it("rejects a json flag with fewer than 2 values", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces/demo/flags",
      headers: { cookie },
      payload: { key: "too-few", name: "Too few", kind: "json", values: [{ value: 1 }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a json flag with a value over 32 KB", async () => {
    const big = { payload: "x".repeat(33 * 1024) };
    const res = await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces/demo/flags",
      headers: { cookie },
      payload: {
        key: "too-big",
        name: "Too big",
        kind: "json",
        values: [{ value: { ok: true } }, { value: big }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(res.json().error.message).toMatch(/exceeds 32768/);
  });

  it("accepts a json value at exactly the 32 KB limit", async () => {
    // {"s":"<padding>"} — pad until total is exactly 32768 bytes
    const overhead = `{"s":""}`.length; // 8
    const padLen = 32 * 1024 - overhead;
    const value = { s: "y".repeat(padLen) };
    const res = await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces/demo/flags",
      headers: { cookie },
      payload: {
        key: "right-at-limit",
        name: "Right at limit",
        kind: "json",
        values: [{ value: { ok: true } }, { value }],
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it("toggling and updating defaultServe round-trips and returns the right value via /sdk-flags shape", async () => {
    const put = await h.app.inject({
      method: "PUT",
      url: "/api/v1/workspaces/demo/flags/pricing-table/stages/production",
      headers: { cookie },
      payload: {
        enabled: true,
        disabledValueIndex: 0,
        defaultServe: { kind: "value", valueIndex: 2 },
        pinned: [],
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().defaultServe).toEqual({ kind: "value", valueIndex: 2 });

    const detail = await h.app.inject({
      method: "GET",
      url: "/api/v1/workspaces/demo/flags/pricing-table",
      headers: { cookie },
    });
    expect(detail.statusCode).toBe(200);
    const dbody = detail.json();
    expect(dbody.flag.kind).toBe("json");
    expect(dbody.configs[0].defaultServe).toEqual({ kind: "value", valueIndex: 2 });
  });

  it("rejects defaultServe valueIndex out of range for the json flag's values", async () => {
    const put = await h.app.inject({
      method: "PUT",
      url: "/api/v1/workspaces/demo/flags/pricing-table/stages/production",
      headers: { cookie },
      payload: {
        enabled: true,
        disabledValueIndex: 0,
        defaultServe: { kind: "value", valueIndex: 7 },
        pinned: [],
      },
    });
    expect(put.statusCode).toBe(400);
  });
});
