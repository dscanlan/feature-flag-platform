import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolverResolveResponse } from "@ffp/shared-types";
import { createClient } from "../src/client.js";

/**
 * Build a Response that streams SSE frames written by the test, then closes.
 * The `frames` array is joined with the SSE frame separator ("\n\n"). The body
 * is delivered in one chunk and then the stream ends — that lets us verify the
 * SSE parser without needing a real network.
 */
function sseResponse(frames: string[], opts: { status?: number } = {}): Response {
  const body = frames.length > 0 ? frames.join("\n\n") + "\n\n" : "";
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, {
    status: opts.status ?? 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function resolveResponse(results: ResolverResolveResponse["results"]): Response {
  const body: ResolverResolveResponse = {
    stage: { id: "stg-1", key: "production", version: 1 },
    results,
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("SDK SSE wiring", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("on stream change event, refetches /sdk/resolve", async () => {
    let toggled = false;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/sdk/resolve")) {
        return resolveResponse({
          gate: {
            value: toggled,
            valueIndex: toggled ? 1 : 0,
            reason: { kind: "default" },
            kind: "boolean",
          },
        });
      }
      if (u.endsWith("/sdk/stream")) {
        return sseResponse([
          'event: ready\ndata: {"version":1}',
          'event: change\ndata: {"version":2}',
        ]);
      }
      throw new Error(`unexpected ${u}`);
    });
    const client = createClient({
      baseUrl: "http://x",
      publicKey: "pub-test",
      subject: { type: "user", id: "u" },
      fetch: fetchImpl as unknown as typeof fetch,
    });
    await client.ready();
    expect(client.boolFlag("gate", true)).toBe(false);

    // Flip the server-side state then let the SSE 'change' frame land.
    toggled = true;
    // The SSE frames were buffered when the body opened. Let microtasks flush.
    await vi.advanceTimersByTimeAsync(50);
    expect(client.boolFlag("gate", false)).toBe(true);

    client.close();
  });

  it("falls back to polling after three 5xx stream responses in 60s", async () => {
    let streamHits = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/sdk/resolve")) return resolveResponse({});
      if (u.endsWith("/sdk/stream")) {
        streamHits += 1;
        return sseResponse([], { status: 503 });
      }
      throw new Error(`unexpected ${u}`);
    });
    const client = createClient({
      baseUrl: "http://x",
      publicKey: "pub-test",
      subject: { type: "user", id: "u" },
      pollIntervalMs: 10_000,
      fetch: fetchImpl as unknown as typeof fetch,
    });
    await client.ready();
    // Walk through the backoff window so we accumulate three 5xx responses.
    // Backoff is capped at 30s; with three retries at 500/1000/2000 + jitter
    // we'll be well within 60s.
    for (let i = 0; i < 5 && streamHits < 3; i += 1) {
      await vi.advanceTimersByTimeAsync(40_000);
    }
    expect(streamHits).toBeGreaterThanOrEqual(3);
    // After threshold trip, state should observe "polling".
    expect(client.getState().connectionState).toBe("polling");
    // Polling fallback engaged → an extra resolve was queued. Run the poll loop
    // a couple of times.
    const before = fetchImpl.mock.calls.filter((c) => String(c[0]).endsWith("/sdk/resolve")).length;
    await vi.advanceTimersByTimeAsync(10_000);
    const after = fetchImpl.mock.calls.filter((c) => String(c[0]).endsWith("/sdk/resolve")).length;
    expect(after).toBeGreaterThan(before);
    client.close();
  });

  it("flips connectionState to streaming on first SSE open", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/sdk/resolve")) return resolveResponse({});
      if (u.endsWith("/sdk/stream")) {
        return sseResponse(['event: ready\ndata: {"version":1}']);
      }
      throw new Error(`unexpected ${u}`);
    });
    const client = createClient({
      baseUrl: "http://x",
      publicKey: "pub-test",
      subject: { type: "user", id: "u" },
      fetch: fetchImpl as unknown as typeof fetch,
    });
    expect(client.getState().connectionState).toBe("connecting");
    await client.ready();
    // Microtask flush so the SSE body parser actually runs.
    await vi.advanceTimersByTimeAsync(50);
    expect(client.getState().connectionState).toBe("streaming");
    client.close();
    expect(client.getState().connectionState).toBe("offline");
  });

  it("publishes a snapshot bump when a flag value changes via SSE", async () => {
    let toggled = false;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/sdk/resolve")) {
        return resolveResponse({
          gate: {
            value: toggled,
            valueIndex: toggled ? 1 : 0,
            reason: { kind: "default" },
            kind: "boolean",
          },
        });
      }
      if (u.endsWith("/sdk/stream")) {
        return sseResponse([
          'event: ready\ndata: {"version":1}',
          'event: change\ndata: {"version":2}',
        ]);
      }
      throw new Error(`unexpected ${u}`);
    });
    const client = createClient({
      baseUrl: "http://x",
      publicKey: "pub-test",
      subject: { type: "user", id: "u" },
      fetch: fetchImpl as unknown as typeof fetch,
    });
    let bumps = 0;
    client.subscribe(() => {
      bumps += 1;
    });
    await client.ready();
    const versionAfterReady = client.getState().version;
    toggled = true;
    await vi.advanceTimersByTimeAsync(50);
    expect(client.getState().version).toBeGreaterThan(versionAfterReady);
    expect(bumps).toBeGreaterThan(0);
    client.close();
  });
});
