import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "./helpers/testApp.js";

describe("health integration", () => {
  let h: TestHarness;

  beforeAll(async () => {
    h = await createTestHarness();
  });

  afterAll(async () => {
    await h?.close();
  });

  it("reports ok when both deps are reachable", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, dbOk: true, redisOk: true });
  });
});
