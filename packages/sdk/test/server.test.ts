import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolverFlagsResponse } from "@ffp/shared-types";
import { createServerClient } from "../src/server.js";

function flagsResponse(overrides: Partial<ResolverFlagsResponse> = {}): Response {
  const body: ResolverFlagsResponse = {
    stage: { id: "stg-1", key: "production", version: 1 },
    flags: [
      {
        id: "f1",
        workspaceId: "w1",
        key: "new-checkout",
        name: "New checkout",
        kind: "boolean",
        values: [{ value: false }, { value: true }],
        tags: [],
        createdAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "f2",
        workspaceId: "w1",
        key: "pricing",
        name: "Pricing",
        kind: "json",
        values: [
          { name: "free", value: { tier: "free" } },
          { name: "pro", value: { tier: "pro" } },
        ],
        tags: [],
        createdAt: "2026-01-01T00:00:00Z",
      },
    ],
    configs: [
      {
        flagId: "f1",
        stageId: "stg-1",
        enabled: true,
        disabledValueIndex: 0,
        defaultServe: { kind: "value", valueIndex: 1 },
        pinned: [{ subjectType: "user", subjectId: "u-pin", valueIndex: 0 }],
        rules: [],
        version: 1,
        updatedAt: "2026-01-01T00:00:00Z",
      },
      {
        flagId: "f2",
        stageId: "stg-1",
        enabled: true,
        disabledValueIndex: 0,
        defaultServe: { kind: "value", valueIndex: 0 },
        pinned: [],
        rules: [],
        version: 1,
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ],
    audiences: [],
    subjectTypes: [
      { id: "st1", workspaceId: "w1", key: "user", name: "User", isDefaultSplitKey: true },
    ],
    ...overrides,
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("createServerClient (server mode)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("evaluates flags locally with the cached ruleset", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/sdk/flags")) return flagsResponse();
      throw new Error(`unexpected ${u}`);
    });
    const client = createServerClient({
      baseUrl: "http://x",
      serverKey: "srv-test",
      subject: { type: "user", id: "u-anon" },
      fetch: fetchImpl as unknown as typeof fetch,
      streaming: false,
    });
    await client.ready();
    expect(client.boolFlag("new-checkout", false)).toBe(true);
    expect(client.jsonFlag("pricing", { tier: "default" })).toEqual({ tier: "free" });
    client.close();
  });

  it("setSubject does NOT call /sdk/resolve (no network on rebind)", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/sdk/flags")) return flagsResponse();
      throw new Error(`unexpected ${u}`);
    });
    const client = createServerClient({
      baseUrl: "http://x",
      serverKey: "srv-test",
      subject: { type: "user", id: "u-anon" },
      fetch: fetchImpl as unknown as typeof fetch,
      streaming: false,
    });
    await client.ready();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // setSubject pivots to the pinned subject; this must change the resolution
    // without making any network call.
    await client.setSubject({ type: "user", id: "u-pin" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(client.boolFlag("new-checkout", true)).toBe(false);
    client.close();
  });

  it("respects the wrong-type guard", async () => {
    const fetchImpl = vi.fn(async () => flagsResponse());
    const logs: Array<{ level: string; msg: string }> = [];
    const client = createServerClient({
      baseUrl: "http://x",
      serverKey: "srv-test",
      subject: { type: "user", id: "u-anon" },
      fetch: fetchImpl as unknown as typeof fetch,
      streaming: false,
      logger: (level, msg) => logs.push({ level, msg }),
    });
    await client.ready();
    expect(client.jsonFlag("new-checkout", { fallback: true })).toEqual({ fallback: true });
    expect(logs.some((l) => l.level === "warn" && l.msg.includes("jsonFlag"))).toBe(true);
    client.close();
  });

  it("allFlags returns resolved values for every flag in the ruleset", async () => {
    const fetchImpl = vi.fn(async () => flagsResponse());
    const client = createServerClient({
      baseUrl: "http://x",
      serverKey: "srv-test",
      subject: { type: "user", id: "u-anon" },
      fetch: fetchImpl as unknown as typeof fetch,
      streaming: false,
    });
    await client.ready();
    const all = client.allFlags();
    expect(all["new-checkout"]).toBe(true);
    expect(all["pricing"]).toEqual({ tier: "free" });
    client.close();
  });
});
