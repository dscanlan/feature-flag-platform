import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolverResolveResponse } from "@ffp/shared-types";
import { createClient } from "../src/client.js";

function fakeResponse(results: ResolverResolveResponse["results"]): Response {
  const body: ResolverResolveResponse = {
    stage: { id: "stg-1", key: "production", version: 1 },
    results,
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("createClient (client mode, polling)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("populates the cache after ready() and serves boolFlag from it", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({
        "new-checkout": {
          value: true,
          valueIndex: 1,
          reason: { kind: "default" },
          kind: "boolean",
        },
      }),
    );
    const client = createClient({
      baseUrl: "http://x",
      publicKey: "pub-test",
      subject: { type: "user", id: "u" },
      fetch: fetchImpl as unknown as typeof fetch,
      streaming: false,
    });
    await client.ready();
    expect(client.boolFlag("new-checkout", false)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    client.close();
  });

  it("returns the default when the flag is missing", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse({}));
    const client = createClient({
      baseUrl: "http://x",
      publicKey: "pub-test",
      subject: { type: "user", id: "u" },
      fetch: fetchImpl as unknown as typeof fetch,
      streaming: false,
    });
    await client.ready();
    expect(client.boolFlag("not-there", true)).toBe(true);
    expect(client.boolFlag("not-there", false)).toBe(false);
    client.close();
  });

  it("falls back to default on fetch error and never throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const client = createClient({
      baseUrl: "http://x",
      publicKey: "pub-test",
      subject: { type: "user", id: "u" },
      fetch: fetchImpl as unknown as typeof fetch,
      streaming: false,
    });
    await client.ready();
    expect(client.boolFlag("anything", true)).toBe(true);
    client.close();
  });

  it("polls at the configured interval", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({
        x: { value: true, valueIndex: 1, reason: { kind: "default" }, kind: "boolean" },
      }),
    );
    const client = createClient({
      baseUrl: "http://x",
      publicKey: "pub-test",
      subject: { type: "user", id: "u" },
      pollIntervalMs: 5_000,
      fetch: fetchImpl as unknown as typeof fetch,
      streaming: false,
    });
    await client.ready();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    client.close();
  });

  it("clamps poll interval to the minimum", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse({}));
    const client = createClient({
      baseUrl: "http://x",
      publicKey: "pub-test",
      subject: { type: "user", id: "u" },
      pollIntervalMs: 1, // below MIN_POLL_MS
      fetch: fetchImpl as unknown as typeof fetch,
      streaming: false,
    });
    await client.ready();
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // not yet at 1s
    await vi.advanceTimersByTimeAsync(600);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    client.close();
  });

  it("setSubject triggers an immediate refetch", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse({}));
    const client = createClient({
      baseUrl: "http://x",
      publicKey: "pub-test",
      subject: { type: "user", id: "u1" },
      fetch: fetchImpl as unknown as typeof fetch,
    });
    await client.ready();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await client.setSubject({ type: "user", id: "u2" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    client.close();
  });

  it("emits change when a flag value flips", async () => {
    let toggled = false;
    const fetchImpl = vi.fn(async () => {
      const res = fakeResponse({
        x: {
          value: toggled,
          valueIndex: toggled ? 1 : 0,
          reason: { kind: "default" },
          kind: "boolean",
        },
      });
      return res;
    });
    const client = createClient({
      baseUrl: "http://x",
      publicKey: "pub-test",
      subject: { type: "user", id: "u" },
      pollIntervalMs: 1_000,
      fetch: fetchImpl as unknown as typeof fetch,
      streaming: false,
    });
    const changes: Array<{ key: string; value: unknown }> = [];
    client.on("change", (info) => changes.push(info as { key: string; value: unknown }));
    await client.ready();
    expect(changes).toEqual([{ key: "x", value: false }]);
    toggled = true;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(changes.at(-1)).toEqual({ key: "x", value: true });
    client.close();
  });

  it("boolFlag on a json flag returns default and warn-logs WRONG_TYPE", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({
        cfg: { value: { tier: "pro" }, valueIndex: 1, reason: { kind: "default" }, kind: "json" },
      }),
    );
    const logs: Array<{ level: string; msg: string; meta?: unknown }> = [];
    const client = createClient({
      baseUrl: "http://x",
      publicKey: "pub-test",
      subject: { type: "user", id: "u" },
      fetch: fetchImpl as unknown as typeof fetch,
      streaming: false,
      logger: (level, msg, meta) => logs.push({ level, msg, meta }),
    });
    await client.ready();
    expect(client.boolFlag("cfg", true)).toBe(true);
    expect(client.boolFlag("cfg", false)).toBe(false);
    const warn = logs.find((l) => l.level === "warn" && l.msg.includes("boolFlag"));
    expect(warn).toBeDefined();
    expect((warn!.meta as { code: string }).code).toBe("WRONG_TYPE");
    client.close();
  });

  it("jsonFlag on a boolean flag returns default and warn-logs WRONG_TYPE", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({
        gate: { value: true, valueIndex: 1, reason: { kind: "default" }, kind: "boolean" },
      }),
    );
    const logs: Array<{ level: string; msg: string }> = [];
    const client = createClient({
      baseUrl: "http://x",
      publicKey: "pub-test",
      subject: { type: "user", id: "u" },
      fetch: fetchImpl as unknown as typeof fetch,
      streaming: false,
      logger: (level, msg) => logs.push({ level, msg }),
    });
    await client.ready();
    const fallback = { ok: true };
    expect(client.jsonFlag("gate", fallback)).toBe(fallback);
    const warn = logs.find((l) => l.level === "warn" && l.msg.includes("jsonFlag"));
    expect(warn).toBeDefined();
    client.close();
  });

  it("jsonFlag deep-clones so callers can't mutate the cache", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({
        cfg: { value: { a: 1 }, valueIndex: 0, reason: { kind: "default" }, kind: "json" },
      }),
    );
    const client = createClient({
      baseUrl: "http://x",
      publicKey: "pub-test",
      subject: { type: "user", id: "u" },
      fetch: fetchImpl as unknown as typeof fetch,
      streaming: false,
    });
    await client.ready();
    const v = client.jsonFlag<{ a: number }>("cfg", { a: 0 });
    v.a = 99;
    const v2 = client.jsonFlag<{ a: number }>("cfg", { a: 0 });
    expect(v2.a).toBe(1);
    client.close();
  });

  it("jsonFlag deep-clones nested values", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({
        deep: {
          value: { tiers: [{ name: "free", price: 0 }] },
          valueIndex: 0,
          reason: { kind: "default" },
          kind: "json",
        },
      }),
    );
    const client = createClient({
      baseUrl: "http://x",
      publicKey: "pub-test",
      subject: { type: "user", id: "u" },
      fetch: fetchImpl as unknown as typeof fetch,
      streaming: false,
    });
    await client.ready();
    type Cfg = { tiers: { name: string; price: number }[] };
    const a = client.jsonFlag<Cfg>("deep", { tiers: [] });
    a.tiers[0]!.price = 999;
    a.tiers.push({ name: "evil", price: -1 });
    const b = client.jsonFlag<Cfg>("deep", { tiers: [] });
    expect(b.tiers).toHaveLength(1);
    expect(b.tiers[0]!.price).toBe(0);
    client.close();
  });
});
