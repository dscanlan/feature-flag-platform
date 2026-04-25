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

/**
 * Build an SSE Response whose body stream stays open until the caller's
 * AbortSignal fires (or the returned `close` is invoked). Used to model the
 * "server connection silently freezes" case the watchdog is meant to catch:
 * the body never delivers another chunk and never closes on its own.
 */
function liveSseResponse(
  initialFrames: string[],
  signal: AbortSignal | undefined | null,
): { response: Response; close: () => void } {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      if (initialFrames.length > 0) {
        const body = initialFrames.join("\n\n") + "\n\n";
        c.enqueue(new TextEncoder().encode(body));
      }
    },
  });
  const fail = (): void => {
    try {
      controller?.error(new Error("aborted"));
    } catch {
      /* already closed */
    }
  };
  signal?.addEventListener("abort", fail);
  return {
    response: new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
    close: fail,
  };
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

  it("reconnects after the idle watchdog fires on a wedged stream", async () => {
    let streamHits = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/sdk/resolve")) return resolveResponse({});
      if (u.endsWith("/sdk/stream")) {
        streamHits += 1;
        const { response } = liveSseResponse(
          ['event: ready\ndata: {"version":1}'],
          init?.signal ?? null,
        );
        return response;
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
    // Let the first stream connect open and the watchdog arm.
    await vi.advanceTimersByTimeAsync(50);
    expect(streamHits).toBe(1);
    expect(client.getState().connectionState).toBe("streaming");
    // Default idle timeout = 60s. Push past it; watchdog aborts, backoff
    // (~1s for attempt=1) schedules the reconnect.
    await vi.advanceTimersByTimeAsync(61_000);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(streamHits).toBeGreaterThanOrEqual(2);
    client.close();
  });

  it("retries after the handshake timeout when the initial fetch wedges", async () => {
    let streamAttempts = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/sdk/resolve")) return resolveResponse({});
      if (u.endsWith("/sdk/stream")) {
        streamAttempts += 1;
        if (streamAttempts === 1) {
          // First attempt: never resolves until the SDK aborts (handshake
          // timeout). Mirrors the undici "TCP connect hangs" case.
          return new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            );
          });
        }
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
    await client.ready();
    await vi.advanceTimersByTimeAsync(50);
    expect(streamAttempts).toBe(1);
    // Default connect timeout = 10s. Cross it, then let backoff run.
    await vi.advanceTimersByTimeAsync(11_000);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(streamAttempts).toBeGreaterThanOrEqual(2);
    await vi.advanceTimersByTimeAsync(50);
    expect(client.getState().connectionState).toBe("streaming");
    client.close();
  });
});
