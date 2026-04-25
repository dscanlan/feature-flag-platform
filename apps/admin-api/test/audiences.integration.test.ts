import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "./helpers/testApp.js";
import { loginCookie } from "./helpers/login.js";

describe("admin-api: audiences", () => {
  let h: TestHarness;
  let cookie: string;

  beforeAll(async () => {
    h = await createTestHarness();
    cookie = await loginCookie(h);

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
      url: "/api/v1/workspaces/ws/stages",
      headers: { cookie },
      payload: { key: "test", name: "Test" },
    });
    await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces/ws/subject-types",
      headers: { cookie },
      payload: { key: "user", name: "User", isDefaultSplitKey: true },
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

  it("rejects audience create with unknown subject type", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces/ws/audiences",
      headers: { cookie },
      payload: { key: "beta", name: "Beta", subjectType: "nope" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("creates, lists, and gets audiences", async () => {
    const created = await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces/ws/audiences",
      headers: { cookie },
      payload: { key: "beta", name: "Beta testers", subjectType: "user" },
    });
    expect(created.statusCode).toBe(201);
    const audience = created.json();
    expect(audience.key).toBe("beta");
    expect(audience.subjectType).toBe("user");
    expect(audience.perStage).toEqual({});

    const list = await h.app.inject({
      method: "GET",
      url: "/api/v1/workspaces/ws/audiences",
      headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);

    const one = await h.app.inject({
      method: "GET",
      url: "/api/v1/workspaces/ws/audiences/beta",
      headers: { cookie },
    });
    expect(one.statusCode).toBe(200);
    expect(one.json().id).toBe(audience.id);
  });

  it("rejects duplicate audience keys", async () => {
    const dup = await h.app.inject({
      method: "POST",
      url: "/api/v1/workspaces/ws/audiences",
      headers: { cookie },
      payload: { key: "beta", name: "Duplicate", subjectType: "user" },
    });
    expect(dup.statusCode).toBe(409);
  });

  it("PUT writes per-stage payload and bumps stage version", async () => {
    const stagesBefore = await h.app.inject({
      method: "GET",
      url: "/api/v1/workspaces/ws/stages",
      headers: { cookie },
    });
    const prodBefore = stagesBefore.json().find((s: { key: string }) => s.key === "production");

    const put = await h.app.inject({
      method: "PUT",
      url: "/api/v1/workspaces/ws/audiences/beta/stages/production",
      headers: { cookie },
      payload: {
        members: [
          { subjectType: "user", subjectId: "user-1", included: true },
          { subjectType: "user", subjectId: "user-2", included: false },
        ],
        rules: [
          {
            id: "pro-users",
            clauses: [
              {
                kind: "attribute",
                subjectType: "user",
                attribute: "plan",
                op: "in",
                values: ["pro"],
                negate: false,
              },
            ],
          },
        ],
      },
    });
    expect(put.statusCode).toBe(200);
    const payload = put.json();
    expect(payload.members).toHaveLength(2);
    expect(payload.rules[0].clauses[0].attribute).toBe("plan");

    const stagesAfter = await h.app.inject({
      method: "GET",
      url: "/api/v1/workspaces/ws/stages",
      headers: { cookie },
    });
    const prodAfter = stagesAfter.json().find((s: { key: string }) => s.key === "production");
    expect(prodAfter.version).toBe(prodBefore.version + 1);
  });

  it("per-stage payloads are independent across stages", async () => {
    await h.app.inject({
      method: "PUT",
      url: "/api/v1/workspaces/ws/audiences/beta/stages/test",
      headers: { cookie },
      payload: {
        members: [{ subjectType: "user", subjectId: "user-9", included: true }],
        rules: [],
      },
    });

    const one = await h.app.inject({
      method: "GET",
      url: "/api/v1/workspaces/ws/audiences/beta",
      headers: { cookie },
    });
    const perStage = one.json().perStage as Record<string, { members: { subjectId: string }[] }>;
    const stageIds = Object.keys(perStage);
    expect(stageIds).toHaveLength(2);
    const memberIdsByStage = stageIds
      .map((id) => perStage[id]!.members.map((m) => m.subjectId).sort())
      .sort();
    expect(memberIdsByStage).toEqual([["user-1", "user-2"], ["user-9"]]);
  });

  it("rejects members whose subjectType differs from the audience", async () => {
    const bad = await h.app.inject({
      method: "PUT",
      url: "/api/v1/workspaces/ws/audiences/beta/stages/production",
      headers: { cookie },
      payload: {
        members: [{ subjectType: "account", subjectId: "acc-1", included: true }],
        rules: [],
      },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toMatch(/subjectType/);
  });

  it("rejects flag rules that reference unknown audience ids", async () => {
    const res = await h.app.inject({
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
            id: "r1",
            clauses: [
              {
                kind: "audience",
                op: "inAudience",
                audienceIds: ["00000000-0000-0000-0000-000000000000"],
              },
            ],
            serve: { kind: "value", valueIndex: 1 },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/audience.*not found/);
  });

  it("accepts a flag rule referencing a known audience", async () => {
    const audiences = await h.app.inject({
      method: "GET",
      url: "/api/v1/workspaces/ws/audiences",
      headers: { cookie },
    });
    const beta = (audiences.json() as { id: string; key: string }[]).find((a) => a.key === "beta")!;

    const res = await h.app.inject({
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
            id: "r1",
            clauses: [{ kind: "audience", op: "inAudience", audienceIds: [beta.id] }],
            serve: { kind: "value", valueIndex: 1 },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().rules[0].clauses[0].audienceIds).toEqual([beta.id]);
  });
});
