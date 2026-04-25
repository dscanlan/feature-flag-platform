import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { signStreamToken, signSubjectToken, subjectFingerprint } from "../src/tokens.js";
import { config, resetDb, startResolver, type ResolverHarness } from "./helpers/setup.js";

/**
 * Phase 9 — Trust Model Hardening end-to-end:
 *  - /sdk/resolve accepts a signed `subjectToken` and refuses bad/expired ones.
 *  - /sdk/resolve issues a stream-subscription token.
 *  - /sdk/stream accepts that token (sst-) and still accepts pub-/srv- keys
 *    for back-compat.
 */
describe("trust model: subjectToken + stream token", () => {
  let h: ResolverHarness;
  let publicKey: string;
  let serverKey: string;
  let stageId: string;
  let subjectSigningSecret: string;

  beforeAll(async () => {
    const setup = new Pool({ connectionString: config.DATABASE_URL });
    await resetDb(setup);
    const { rows: wsRows } = await setup.query<{ id: string }>(
      "INSERT INTO workspaces (key, name) VALUES ('demo','Demo') RETURNING id",
    );
    const wsId = wsRows[0]!.id;
    const sssecret = "host-app-backend-secret-32-chars-long-aaa";
    const { rows: stRows } = await setup.query<{
      id: string;
      server_key: string;
      public_key: string;
      subject_signing_secret: string;
    }>(
      `INSERT INTO stages
         (workspace_id, key, name, server_key, public_key, subject_signing_secret)
       VALUES ($1,'production','Production','srv-trust-001','pub-trust-001',$2)
       RETURNING id, server_key, public_key, subject_signing_secret`,
      [wsId, sssecret],
    );
    stageId = stRows[0]!.id;
    publicKey = stRows[0]!.public_key;
    serverKey = stRows[0]!.server_key;
    subjectSigningSecret = stRows[0]!.subject_signing_secret;
    const { rows: fRows } = await setup.query<{ id: string }>(
      `INSERT INTO flags (workspace_id, key, name, kind, values)
       VALUES ($1, 'gate', 'Gate', 'boolean', '[{"value":false},{"value":true}]'::jsonb)
       RETURNING id`,
      [wsId],
    );
    await setup.query(
      `INSERT INTO flag_stage_configs (flag_id, stage_id, enabled, disabled_value_index, default_serve, pinned, rules)
       VALUES ($1, $2, true, 0, '{"kind":"value","valueIndex":1}'::jsonb,
               '[{"subjectType":"user","subjectId":"user-pinned","valueIndex":0}]'::jsonb,
               '[]'::jsonb)`,
      [fRows[0]!.id, stageId],
    );
    await setup.end();
    h = await startResolver();
  });

  afterAll(async () => {
    await h?.close();
  });

  async function resolve(body: object): Promise<Response> {
    return fetch(`${h.baseUrl}/sdk/resolve`, {
      method: "POST",
      headers: { authorization: `Bearer ${publicKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("issues a streamToken bound to the subject + stage on /sdk/resolve", async () => {
    const r = await resolve({ subject: { type: "user", id: "user-anon" } });
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      streamToken?: string;
      streamTokenExp?: number;
      results: Record<string, { value: unknown }>;
    };
    expect(body.streamToken).toMatch(/^sst-/);
    expect(typeof body.streamTokenExp).toBe("number");
    expect(body.streamTokenExp! > Math.floor(Date.now() / 1000)).toBe(true);
    expect(body.results["gate"]!.value).toBe(true); // default index 1
  });

  it("/sdk/stream accepts the issued sst- token", async () => {
    const r = await resolve({ subject: { type: "user", id: "user-anon" } });
    const { streamToken } = (await r.json()) as { streamToken: string };

    const ctl = new AbortController();
    const stream = await fetch(`${h.baseUrl}/sdk/stream`, {
      headers: { authorization: `Bearer ${streamToken}` },
      signal: ctl.signal,
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");

    // Read at least the initial `ready` frame so we know the stream is live.
    const reader = stream.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("event: ready");
    ctl.abort();
  });

  it("/sdk/stream still accepts pub-/srv- keys (back-compat)", async () => {
    for (const key of [publicKey, serverKey]) {
      const ctl = new AbortController();
      const stream = await fetch(`${h.baseUrl}/sdk/stream`, {
        headers: { authorization: `Bearer ${key}` },
        signal: ctl.signal,
      });
      expect(stream.status).toBe(200);
      ctl.abort();
    }
  });

  it("/sdk/stream rejects an unknown sst- token (forged signature)", async () => {
    const forged = signStreamToken("wrong-secret-still-32-chars-long-aaaa", {
      s: stageId,
      f: subjectFingerprint({ type: "user", id: "user-anon" }),
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    const r = await fetch(`${h.baseUrl}/sdk/stream`, {
      headers: { authorization: `Bearer ${forged}` },
    });
    expect(r.status).toBe(401);
  });

  it("subjectToken: valid token resolves the embedded pinned subject", async () => {
    // Sign a token that carries (user, user-pinned) → pinned to index 0 (false).
    const token = signSubjectToken(subjectSigningSecret, {
      sub: { type: "user", id: "user-pinned" },
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    const r = await resolve({ subjectToken: token });
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      results: Record<string, { value: unknown; reason: { kind: string } }>;
    };
    expect(body.results["gate"]!.value).toBe(false);
    expect(body.results["gate"]!.reason.kind).toBe("pinned");
  });

  it("subjectToken: bad signature → 401", async () => {
    const token = signSubjectToken("not-the-stages-secret-also-32-bytes-long", {
      sub: { type: "user", id: "user-pinned" },
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    const r = await resolve({ subjectToken: token });
    expect(r.status).toBe(401);
    const body = (await r.json()) as { error: { code: string } };
    expect(body.error.code).toBe("BAD_SUBJECT_TOKEN");
  });

  it("subjectToken: expired → 401", async () => {
    const token = signSubjectToken(subjectSigningSecret, {
      sub: { type: "user", id: "user-pinned" },
      exp: Math.floor(Date.now() / 1000) - 1,
    });
    const r = await resolve({ subjectToken: token });
    expect(r.status).toBe(401);
  });

  it("subjectToken wins over a raw subject when both are present", async () => {
    // Raw subject would resolve to default (true), but the token says user-pinned (false).
    const token = signSubjectToken(subjectSigningSecret, {
      sub: { type: "user", id: "user-pinned" },
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    const r = await resolve({
      subject: { type: "user", id: "user-anon" },
      subjectToken: token,
    });
    const body = (await r.json()) as { results: Record<string, { value: unknown }> };
    expect(body.results["gate"]!.value).toBe(false);
  });

  it("missing both subject and subjectToken → 400", async () => {
    const r = await resolve({});
    expect(r.status).toBe(400);
  });
});
