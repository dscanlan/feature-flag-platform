import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { createClient, createServerClient } from "@ffp/sdk";
import { config, resetDb, startResolver, type ResolverHarness } from "./helpers/setup.js";

/**
 * Live SDK ↔ resolver integration. Spins up the resolver, opens a streaming
 * SDK against it, and verifies that admin-side mutations propagate within 1s
 * via SSE. Also exercises polling fallback + reconnect after a resolver
 * restart.
 *
 * "Admin-side mutations" here are simulated with raw SQL + Redis publishes —
 * we don't need to spin up admin-api for this layer.
 */
describe("SDK ↔ resolver: streaming + reconnect", () => {
  let h: ResolverHarness;
  let publicKey: string;
  let serverKey: string;
  let stageId: string;
  let flagId: string;
  let configPool: Pool;

  beforeAll(async () => {
    const setup = new Pool({ connectionString: config.DATABASE_URL });
    await resetDb(setup);

    const { rows: wsRows } = await setup.query<{ id: string }>(
      "INSERT INTO workspaces (key, name) VALUES ('demo','Demo') RETURNING id",
    );
    const wsId = wsRows[0]!.id;
    const { rows: stRows } = await setup.query<{
      id: string;
      server_key: string;
      public_key: string;
    }>(
      `INSERT INTO stages (workspace_id, key, name, server_key, public_key)
       VALUES ($1,'production','Production','srv-sdk-it-001','pub-sdk-it-001')
       RETURNING id, server_key, public_key`,
      [wsId],
    );
    stageId = stRows[0]!.id;
    publicKey = stRows[0]!.public_key;
    serverKey = stRows[0]!.server_key;
    const { rows: fRows } = await setup.query<{ id: string }>(
      `INSERT INTO flags (workspace_id, key, name, kind, values)
       VALUES ($1, 'gate', 'Gate', 'boolean',
               '[{"value":false},{"value":true}]'::jsonb) RETURNING id`,
      [wsId],
    );
    flagId = fRows[0]!.id;
    await setup.query(
      `INSERT INTO flag_stage_configs
         (flag_id, stage_id, enabled, disabled_value_index, default_serve, pinned, rules)
       VALUES ($1, $2, true, 0, '{"kind":"value","valueIndex":0}'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
      [flagId, stageId],
    );
    await setup.end();

    h = await startResolver();
    configPool = new Pool({ connectionString: config.DATABASE_URL });
  });

  afterAll(async () => {
    await configPool?.end();
    await h?.close();
  });

  async function flipDefault(toIndex: number, version: number): Promise<void> {
    await configPool.query(
      `UPDATE flag_stage_configs
         SET default_serve = $1::jsonb, version = version + 1
       WHERE flag_id = $2 AND stage_id = $3`,
      [JSON.stringify({ kind: "value", valueIndex: toIndex }), flagId, stageId],
    );
    await configPool.query("UPDATE stages SET version = version + 1 WHERE id = $1", [stageId]);
    await h.redisPub.publish(
      `ff:stage:${stageId}`,
      JSON.stringify({ kind: "config-changed", version }),
    );
  }

  async function waitFor<T>(
    label: string,
    fn: () => T,
    pred: (v: T) => boolean,
    timeoutMs: number,
  ): Promise<T> {
    const start = Date.now();
    let last: T = fn();
    while (Date.now() - start < timeoutMs) {
      last = fn();
      if (pred(last)) return last;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`waitFor(${label}) timed out at ${JSON.stringify(last)}`);
  }

  it("client-mode SDK receives a flag flip via SSE within 1s", async () => {
    const client = createClient({
      baseUrl: h.baseUrl,
      publicKey,
      subject: { type: "user", id: "u-it" },
    });
    try {
      await client.ready();
      // Initial state from seed: default index 0 → false.
      expect(client.boolFlag("gate", true)).toBe(false);

      const t0 = Date.now();
      await flipDefault(1, 100);
      const after = await waitFor(
        "boolFlag→true",
        () => client.boolFlag("gate", false),
        (v) => v === true,
        1_500,
      );
      const elapsed = Date.now() - t0;
      expect(after).toBe(true);
      expect(elapsed).toBeLessThan(1_000);

      // Flip back to confirm subsequent updates also propagate.
      await flipDefault(0, 101);
      await waitFor(
        "boolFlag→false",
        () => client.boolFlag("gate", true),
        (v) => v === false,
        1_500,
      );
    } finally {
      client.close();
    }
  });

  it("server-mode SDK refetches /sdk/flags on stream change and resolves locally", async () => {
    let flagsHits = 0;
    let resolveHits = 0;
    const wrapped: typeof fetch = async (input, init) => {
      const u = String(typeof input === "string" || input instanceof URL ? input : input.url);
      if (u.endsWith("/sdk/flags")) flagsHits += 1;
      if (u.endsWith("/sdk/resolve")) resolveHits += 1;
      return fetch(input as RequestInfo, init);
    };
    // Start state: default index 0 (false).
    await flipDefault(0, 200);
    await new Promise((r) => setTimeout(r, 100));

    const client = createServerClient({
      baseUrl: h.baseUrl,
      serverKey,
      subject: { type: "user", id: "srv-u" },
      fetch: wrapped,
    });
    try {
      await client.ready();
      expect(flagsHits).toBeGreaterThanOrEqual(1);
      expect(client.boolFlag("gate", true)).toBe(false);

      // setSubject on server mode is local — no network hits.
      const before = flagsHits + resolveHits;
      await client.setSubject({ type: "user", id: "another" });
      expect(flagsHits + resolveHits).toBe(before);

      // Flip on the server, expect /sdk/flags refetch via SSE.
      const flagsBefore = flagsHits;
      await flipDefault(1, 201);
      await waitFor(
        "server flags refetch",
        () => flagsHits,
        (v) => v > flagsBefore,
        1_500,
      );
      await waitFor(
        "server boolFlag→true",
        () => client.boolFlag("gate", false),
        (v) => v === true,
        500,
      );
      expect(resolveHits).toBe(0); // server mode never calls /sdk/resolve.
    } finally {
      client.close();
    }
  });

  it("recovers when the resolver is killed and restarted", { timeout: 60_000 }, async () => {
    // Reset the seed state to false. Wait briefly for the resolver to refetch.
    await flipDefault(0, 300);
    await new Promise((r) => setTimeout(r, 200));

    let resolveHits = 0;
    const wrapped: typeof fetch = async (input, init) => {
      const u = String(typeof input === "string" || input instanceof URL ? input : input.url);
      if (u.endsWith("/sdk/resolve")) resolveHits += 1;
      return fetch(input as RequestInfo, init);
    };

    const client = createClient({
      baseUrl: h.baseUrl,
      publicKey,
      subject: { type: "user", id: "u-restart" },
      pollIntervalMs: 1_000,
      fetch: wrapped,
    });
    try {
      await client.ready();
      await waitFor(
        "initial boolFlag→false",
        () => client.boolFlag("gate", true),
        (v) => v === false,
        1_500,
      );

      // Kill the resolver. The SDK keeps its last-known cache.
      const originalPort = Number(new URL(h.baseUrl).port);
      await h.close();
      expect(client.boolFlag("gate", true)).toBe(false);

      // Bring up a fresh resolver on the same port so the SDK's cached
      // baseUrl points at it.
      h = await startResolver(originalPort);

      // Wait for SSE to reconnect — the SDK issues a /sdk/resolve on the
      // "ready" frame when the stream comes back. Exponential backoff can
      // stretch to ~16s after a few failed attempts.
      const hitsBefore = resolveHits;
      await waitFor(
        "SSE reconnect triggered a resolve",
        () => resolveHits,
        (v) => v > hitsBefore,
        45_000,
      );
      await flipDefault(1, 301);
      await waitFor(
        "post-restart boolFlag→true",
        () => client.boolFlag("gate", false),
        (v) => v === true,
        5_000,
      );
    } finally {
      client.close();
    }
  });
});
