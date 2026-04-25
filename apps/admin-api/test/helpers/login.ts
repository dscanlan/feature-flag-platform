import type { TestHarness } from "./testApp.js";

/** Log in and return a Cookie header value to attach to subsequent requests. */
export async function loginCookie(h: TestHarness): Promise<string> {
  const res = await h.app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: h.config.ADMIN_EMAIL, password: h.config.ADMIN_PASSWORD },
  });
  if (res.statusCode !== 200) {
    throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  }
  const set = res.headers["set-cookie"];
  const header = Array.isArray(set) ? set.join("; ") : set!;
  return header.split(";")[0]!;
}
