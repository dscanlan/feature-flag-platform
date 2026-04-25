import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "./helpers/testApp.js";
import { loginCookie } from "./helpers/login.js";

describe("admin-api: subject types & rules", () => {
  let h: TestHarness;
  let cookie: string;

  beforeAll(async () => {
    h = await createTestHarness();
    cookie = await loginCookie(h);

    // Set up workspace + stage + flag once.
    await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces",
      headers: { cookie },
      payload: { key: "ws", name: "WS" },
    });
    await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces/ws/stages",
      headers: { cookie },
      payload: { key: "production", name: "Production" },
    });
    await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces/ws/flags",
      headers: { cookie },
      payload: { key: "f", name: "F", kind: "boolean" },
    });
  });

  afterAll(async () => {
    await h?.close();
  });

  it("creates and updates subject types; only one is the default split key", async () => {
    const u = await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces/ws/subject-types",
      headers: { cookie },
      payload: { key: "user", name: "User", isDefaultSplitKey: true },
    });
    expect(u.statusCode).toBe(201);
    expect(u.json().isDefaultSplitKey).toBe(true);

    const a = await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces/ws/subject-types",
      headers: { cookie },
      payload: { key: "account", name: "Account", isDefaultSplitKey: true },
    });
    expect(a.statusCode).toBe(201);

    const list = await h.app.inject({
      method: "GET",
      url: "/api/v1/workspaces/ws/subject-types",
      headers: { cookie },
    });
    const types = list.json() as { key: string; isDefaultSplitKey: boolean }[];
    const u2 = types.find((t) => t.key === "user")!;
    const a2 = types.find((t) => t.key === "account")!;
    expect(a2.isDefaultSplitKey).toBe(true);
    expect(u2.isDefaultSplitKey).toBe(false);
  });

  it("PUT accepts rules and persists them", async () => {
    const put = await h.app.inject({
      method: "PUT",
      url: "/api/v1/workspaces/ws/flags/f/stages/production",
      headers: { cookie },
      payload: {
        enabled: true,
        disabledValueIndex: 0,
        defaultServe: { kind: "value", valueIndex: 0 },
        pinned: [],
        rules: [
          {
            id: "rule-pro",
            description: "pro and enterprise users",
            clauses: [
              {
                kind: "attribute",
                subjectType: "user",
                attribute: "plan",
                op: "in",
                values: ["pro", "enterprise"],
                negate: false,
              },
            ],
            serve: { kind: "value", valueIndex: 1 },
          },
        ],
      },
    });
    expect(put.statusCode).toBe(200);
    const cfg = put.json();
    expect(cfg.rules).toHaveLength(1);
    expect(cfg.rules[0].clauses[0].op).toBe("in");
  });

  it("rejects rule with unknown operator", async () => {
    const put = await h.app.inject({
      method: "PUT",
      url: "/api/v1/workspaces/ws/flags/f/stages/production",
      headers: { cookie },
      payload: {
        enabled: true,
        disabledValueIndex: 0,
        defaultServe: { kind: "value", valueIndex: 0 },
        pinned: [],
        rules: [
          {
            id: "bad",
            clauses: [
              {
                kind: "attribute",
                subjectType: "user",
                attribute: "plan",
                op: "isExactly",
                values: ["pro"],
                negate: false,
              },
            ],
            serve: { kind: "value", valueIndex: 1 },
          },
        ],
      },
    });
    expect(put.statusCode).toBe(400);
    expect(put.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects split with weights that don't sum to 100000", async () => {
    const put = await h.app.inject({
      method: "PUT",
      url: "/api/v1/workspaces/ws/flags/f/stages/production",
      headers: { cookie },
      payload: {
        enabled: true,
        disabledValueIndex: 0,
        defaultServe: {
          kind: "split",
          splitKeySubjectType: "user",
          buckets: [
            { valueIndex: 0, weight: 50 },
            { valueIndex: 1, weight: 50 },
          ],
        },
        pinned: [],
      },
    });
    expect(put.statusCode).toBe(400);
    expect(put.json().error.message).toMatch(/sum to 100000/);
  });

  it("accepts a 50/50 split as defaultServe", async () => {
    const put = await h.app.inject({
      method: "PUT",
      url: "/api/v1/workspaces/ws/flags/f/stages/production",
      headers: { cookie },
      payload: {
        enabled: true,
        disabledValueIndex: 0,
        defaultServe: {
          kind: "split",
          splitKeySubjectType: "user",
          buckets: [
            { valueIndex: 0, weight: 50000 },
            { valueIndex: 1, weight: 50000 },
          ],
        },
        pinned: [],
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().defaultServe.kind).toBe("split");
  });
});
