import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolverResolveResponse } from "@ffp/shared-types";
import { createClient } from "../src/client.js";

function jsonResponse(body: ResolverResolveResponse): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function sseResponse(frames: string[]): Response {
  const body = frames.length > 0 ? frames.join("\n\n") + "\n\n" : "";
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("SDK trust-model wiring", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends subjectToken in the body when set; omits the raw subject", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, body });
      if (url.endsWith("/sdk/resolve")) {
        return jsonResponse({
          stage: { id: "s1", key: "production", version: 1 },
          results: {},
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    const client = createClient({
      baseUrl: "http://x",
      publicKey: "pub-test",
      subject: { type: "user", id: "u-display-only" },
      subjectToken: "sjt-fake-token",
      fetch: fetchImpl as unknown as typeof fetch,
      streaming: false,
    });
    await client.ready();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ subjectToken: "sjt-fake-token" });
    expect(JSON.stringify(calls[0]!.body)).not.toContain("u-display-only");
    client.close();
  });

  it("setSubjectToken flips the wire payload and triggers a refetch", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      bodies.push(init?.body ? JSON.parse(String(init.body)) : null);
      return jsonResponse({
        stage: { id: "s1", key: "production", version: 1 },
        results: {},
      });
    });
    const client = createClient({
      baseUrl: "http://x",
      publicKey: "pub-test",
      subject: { type: "user", id: "u" },
      fetch: fetchImpl as unknown as typeof fetch,
      streaming: false,
    });
    await client.ready();
    expect(bodies[0]).toEqual({ subject: { type: "user", id: "u" } });

    await client.setSubjectToken("sjt-from-backend");
    expect(bodies[1]).toEqual({ subjectToken: "sjt-from-backend" });

    await client.setSubjectToken(null);
    expect(bodies[2]).toEqual({ subject: { type: "user", id: "u" } });
    client.close();
  });

  it("uses the issued streamToken as the SSE Bearer", async () => {
    const seenAuth: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const auth =
        (init?.headers as Record<string, string> | undefined)?.authorization ??
        (init?.headers as Record<string, string> | undefined)?.Authorization ??
        "";
      if (url.endsWith("/sdk/resolve")) {
        return jsonResponse({
          stage: { id: "s1", key: "production", version: 1 },
          streamToken: "sst-issued-token",
          streamTokenExp: Math.floor(Date.now() / 1000) + 60,
          results: {},
        });
      }
      if (url.endsWith("/sdk/stream")) {
        seenAuth.push(auth);
        return sseResponse(['event: ready\ndata: {"version":1}']);
      }
      throw new Error(`unexpected ${url}`);
    });
    const client = createClient({
      baseUrl: "http://x",
      publicKey: "pub-test",
      subject: { type: "user", id: "u" },
      fetch: fetchImpl as unknown as typeof fetch,
    });
    await client.ready();
    // Let the SSE client establish + reconnect with the new bearer.
    await vi.advanceTimersByTimeAsync(100);
    // Last SSE attempt must use the issued sst- token, not pub-test.
    expect(seenAuth.length).toBeGreaterThan(0);
    expect(seenAuth.at(-1)).toBe("Bearer sst-issued-token");
    client.close();
  });
});
