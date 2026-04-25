import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { buildResolver, type ResolverApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import { Redis } from "ioredis";
import { config as baseConfig, resetDb } from "./helpers/setup.js";

/**
 * Phase 6 resolver hardening. Uses a bespoke harness so we can inject
 * per-test rate-limit / CORS configuration without fighting the default
 * resolver harness.
 */
describe("resolver: per-stage CORS + rate limiting", () => {
  let app: ResolverApp;
  let pool: Pool;
  let redisSub: Redis;
  let publicKey: string;
  let serverKey: string;

  async function boot(cfg: Partial<Config>): Promise<void> {
    pool = new Pool({ connectionString: baseConfig.DATABASE_URL });
    redisSub = new Redis(baseConfig.REDIS_URL, { maxRetriesPerRequest: null });
    app = await buildResolver({
      config: { ...baseConfig, ...cfg },
      pool,
      redisSub,
    });
    await app.app.listen({ port: 0, host: "127.0.0.1" });
    torn = false;
  }

  let torn = true;
  async function tearDown(): Promise<void> {
    if (torn) return;
    torn = true;
    await app.sync.stop();
    await app.app.close();
    await pool.end();
    redisSub.disconnect();
  }

  beforeAll(async () => {
    const setup = new Pool({ connectionString: baseConfig.DATABASE_URL });
    await resetDb(setup);
    const { rows: wsRows } = await setup.query<{ id: string }>(
      "INSERT INTO workspaces (key, name) VALUES ('demo','Demo') RETURNING id",
    );
    const wsId = wsRows[0]!.id;
    const { rows: stRows } = await setup.query<{ server_key: string; public_key: string }>(
      `INSERT INTO stages (workspace_id, key, name, server_key, public_key, cors_origins)
       VALUES ($1,'production','Production','srv-hard-001','pub-hard-001', '{"https://app.example.com"}'::text[])
       RETURNING server_key, public_key`,
      [wsId],
    );
    publicKey = stRows[0]!.public_key;
    serverKey = stRows[0]!.server_key;
    const { rows: fRows } = await setup.query<{ id: string }>(
      `INSERT INTO flags (workspace_id, key, name, kind, values)
       VALUES ($1, 'gate', 'Gate', 'boolean', '[{"value":false},{"value":true}]'::jsonb)
       RETURNING id`,
      [wsId],
    );
    await setup.query(
      `INSERT INTO flag_stage_configs (flag_id, stage_id, enabled, disabled_value_index, default_serve, pinned, rules)
       SELECT $1, s.id, true, 0, '{"kind":"value","valueIndex":1}'::jsonb, '[]'::jsonb, '[]'::jsonb
       FROM stages s WHERE s.workspace_id = $2`,
      [fRows[0]!.id, wsId],
    );
    await setup.end();
  });

  afterAll(async () => {
    await tearDown();
  });

  it("preflight from a disallowed origin is denied (no ACAO echoed)", async () => {
    await boot({ RATE_LIMIT_RPS: 10_000, RATE_LIMIT_BURST: 10_000 });
    const addr = app.app.server.address();
    if (typeof addr !== "object" || !addr) throw new Error("no address");
    const baseUrl = `http://127.0.0.1:${addr.port}`;
    const r = await fetch(`${baseUrl}/sdk/resolve`, {
      method: "OPTIONS",
      headers: {
        origin: "https://evil.example.org",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    });
    // @fastify/cors responds 204 for a valid preflight or 204 without ACAO
    // when rejecting. The key assertion is: no Access-Control-Allow-Origin.
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
    await tearDown();
  });

  it("preflight from an allowed origin echoes ACAO", async () => {
    await boot({ RATE_LIMIT_RPS: 10_000, RATE_LIMIT_BURST: 10_000 });
    const addr = app.app.server.address();
    if (typeof addr !== "object" || !addr) throw new Error("no address");
    const baseUrl = `http://127.0.0.1:${addr.port}`;
    const r = await fetch(`${baseUrl}/sdk/resolve`, {
      method: "OPTIONS",
      headers: {
        origin: "https://app.example.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    });
    expect(r.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    await tearDown();
  });

  it("returns 429 with Retry-After once the burst is exhausted", async () => {
    // Tiny bucket so we exhaust it in a few calls.
    await boot({ RATE_LIMIT_RPS: 1, RATE_LIMIT_BURST: 2 });
    const addr = app.app.server.address();
    if (typeof addr !== "object" || !addr) throw new Error("no address");
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    async function hit(): Promise<Response> {
      return fetch(`${baseUrl}/sdk/resolve`, {
        method: "POST",
        headers: { authorization: `Bearer ${publicKey}`, "content-type": "application/json" },
        body: JSON.stringify({ subject: { type: "user", id: "u" } }),
      });
    }
    const a = await hit();
    const b = await hit();
    const c = await hit(); // should 429
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(c.status).toBe(429);
    expect(c.headers.get("retry-after")).not.toBeNull();
    const body = (await c.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
    await tearDown();
  });

  it("rate limit buckets are keyed per-Bearer so two keys don't starve each other", async () => {
    await boot({ RATE_LIMIT_RPS: 1, RATE_LIMIT_BURST: 1 });
    const addr = app.app.server.address();
    if (typeof addr !== "object" || !addr) throw new Error("no address");
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const withPublic = await fetch(`${baseUrl}/sdk/resolve`, {
      method: "POST",
      headers: { authorization: `Bearer ${publicKey}`, "content-type": "application/json" },
      body: JSON.stringify({ subject: { type: "user", id: "u" } }),
    });
    expect(withPublic.status).toBe(200);

    // Public key bucket is now empty; /sdk/flags uses the server key so its
    // bucket is fresh and the call should succeed.
    const withServer = await fetch(`${baseUrl}/sdk/flags`, {
      headers: { authorization: `Bearer ${serverKey}` },
    });
    expect(withServer.status).toBe(200);

    // Meanwhile, another hit on public 429s.
    const second = await fetch(`${baseUrl}/sdk/resolve`, {
      method: "POST",
      headers: { authorization: `Bearer ${publicKey}`, "content-type": "application/json" },
      body: JSON.stringify({ subject: { type: "user", id: "u" } }),
    });
    expect(second.status).toBe(429);
    await tearDown();
  });
});
