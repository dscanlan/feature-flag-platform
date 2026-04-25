import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "./helpers/testApp.js";

describe("auth integration", () => {
  let h: TestHarness;

  beforeAll(async () => {
    h = await createTestHarness();
  });

  afterAll(async () => {
    await h?.close();
  });

  it("rejects missing credentials on protected route", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/v1/me" });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects bad credentials", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: h.config.ADMIN_EMAIL, password: "nope" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("INVALID_CREDENTIALS");
  });

  it("logs in and accesses protected route, then logs out", async () => {
    const login = await h.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: h.config.ADMIN_EMAIL, password: h.config.ADMIN_PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toEqual({ ok: true });
    const setCookie = login.headers["set-cookie"];
    expect(setCookie).toBeDefined();
    const cookieHeader = Array.isArray(setCookie) ? setCookie.join("; ") : setCookie!;
    const sessionCookie = cookieHeader.split(";")[0]!;

    const me = await h.app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { cookie: sessionCookie },
    });
    expect(me.statusCode).toBe(200);
    const body = me.json();
    expect(typeof body.userId).toBe("string");

    const logout = await h.app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie: sessionCookie },
    });
    expect(logout.statusCode).toBe(200);

    const meAgain = await h.app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { cookie: sessionCookie },
    });
    expect(meAgain.statusCode).toBe(401);
  });

  it("validates login body shape", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "not-an-email" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});
