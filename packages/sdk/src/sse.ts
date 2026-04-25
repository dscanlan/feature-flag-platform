import type { Logger } from "./types.js";

/**
 * Minimal SSE consumer built on `fetch` + ReadableStream so we don't depend on
 * the browser EventSource (which can't send Authorization headers) or on a Node
 * polyfill. Works in Node 20+ and modern browsers.
 *
 * Reconnect policy:
 *  - Auto-reconnect on stream end / error using exponential backoff capped at
 *    `maxBackoffMs` (default 30s).
 *  - If the server returns three 5xx responses inside any rolling 60s window,
 *    notify the caller via `onFallback` so it can switch to polling. We then
 *    re-attempt SSE every 5 minutes (`fallbackRetryMs`).
 *  - Caller can force a re-attempt at any time by calling `tryResume()`.
 */
export interface SseClientOptions {
  url: string;
  bearer: string;
  fetchImpl: typeof fetch;
  logger: Logger;
  /** Fired for every parsed event with a name. `data` is the raw data field. */
  onEvent: (event: string, data: string) => void;
  /** Called once after we've taken three 5xxs in 60s. */
  onFallback: () => void;
  /** Called when the SSE connection becomes healthy after being unhealthy. */
  onResume: () => void;
  /** Called every time a stream connection opens successfully (200 + body). */
  onOpen: () => void;
  maxBackoffMs?: number;
  fallbackRetryMs?: number;
}

export interface SseClient {
  start(): void;
  stop(): void;
  /** Force an immediate reconnect attempt, used when polling-fallback wants to retry SSE. */
  tryResume(): void;
  /**
   * Update the Bearer token used on the next connect attempt. Used after the
   * resolver issues a fresh stream-subscription token. The current connection
   * is dropped so the new token takes effect immediately.
   */
  setBearer(bearer: string): void;
}

const DEFAULT_MAX_BACKOFF = 30_000;
const DEFAULT_FALLBACK_RETRY = 5 * 60_000;
const SERVER_ERROR_WINDOW = 60_000;
const SERVER_ERROR_THRESHOLD = 3;

export function createSseClient(opts: SseClientOptions): SseClient {
  const maxBackoff = opts.maxBackoffMs ?? DEFAULT_MAX_BACKOFF;
  const fallbackRetry = opts.fallbackRetryMs ?? DEFAULT_FALLBACK_RETRY;

  let bearer = opts.bearer;
  let stopped = false;
  let inFallback = false;
  let attempt = 0;
  let abort: AbortController | null = null;
  let nextTimer: ReturnType<typeof setTimeout> | null = null;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  const recent5xx: number[] = [];

  function clearTimers(): void {
    if (nextTimer) {
      clearTimeout(nextTimer);
      nextTimer = null;
    }
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
  }

  function backoffMs(): number {
    const base = Math.min(maxBackoff, 500 * 2 ** Math.min(attempt, 10));
    const jitter = Math.random() * 250;
    return base + jitter;
  }

  function record5xx(): void {
    const now = Date.now();
    recent5xx.push(now);
    while (recent5xx.length > 0 && now - recent5xx[0]! > SERVER_ERROR_WINDOW) {
      recent5xx.shift();
    }
    if (!inFallback && recent5xx.length >= SERVER_ERROR_THRESHOLD) {
      inFallback = true;
      opts.logger("warn", "sse: too many 5xx, switching to polling fallback");
      try {
        opts.onFallback();
      } catch {
        /* listeners are user code */
      }
      // Re-attempt SSE after fallbackRetryMs.
      fallbackTimer = setTimeout(() => {
        fallbackTimer = null;
        attempt = 0;
        scheduleConnect(0);
      }, fallbackRetry);
    }
  }

  function scheduleConnect(delayMs: number): void {
    if (stopped || nextTimer) return;
    nextTimer = setTimeout(() => {
      nextTimer = null;
      void connect();
    }, delayMs);
  }

  async function connect(): Promise<void> {
    if (stopped) return;
    abort = new AbortController();
    const ctl = abort;
    let res: Response;
    try {
      res = await opts.fetchImpl(opts.url, {
        method: "GET",
        headers: {
          accept: "text/event-stream",
          authorization: `Bearer ${bearer}`,
        },
        signal: ctl.signal,
      });
    } catch (err) {
      if (stopped || ctl.signal.aborted) return;
      attempt += 1;
      opts.logger("warn", "sse: connect failed", err);
      scheduleConnect(backoffMs());
      return;
    }

    if (!res.ok || !res.body) {
      const status = res.status;
      try {
        // Drain the body so the connection can be released.
        await res.body?.cancel();
      } catch {
        /* noop */
      }
      if (status >= 500) record5xx();
      attempt += 1;
      opts.logger("warn", `sse: bad status ${status}`);
      if (!stopped) scheduleConnect(backoffMs());
      return;
    }

    // Healthy connection — reset attempts and clear the 5xx window.
    attempt = 0;
    recent5xx.length = 0;
    try {
      opts.onOpen();
    } catch {
      /* listeners are user code */
    }
    if (inFallback) {
      inFallback = false;
      try {
        opts.onResume();
      } catch {
        /* listeners are user code */
      }
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buf = "";
    try {
      while (!stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, nl);
          buf = buf.slice(nl + 2);
          dispatchFrame(frame);
        }
      }
    } catch (err) {
      if (!stopped && !ctl.signal.aborted) {
        opts.logger("debug", "sse: read error", err);
      }
    }
    if (!stopped) {
      // Stream ended unexpectedly — reconnect.
      attempt += 1;
      scheduleConnect(backoffMs());
    }
  }

  function dispatchFrame(frame: string): void {
    let event = "message";
    const dataLines: string[] = [];
    for (const rawLine of frame.split("\n")) {
      const line = rawLine.replace(/\r$/, "");
      if (line === "" || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") dataLines.push(value);
    }
    if (dataLines.length === 0) return;
    try {
      opts.onEvent(event, dataLines.join("\n"));
    } catch (err) {
      opts.logger("warn", "sse: onEvent threw", err);
    }
  }

  return {
    start() {
      if (stopped) return;
      scheduleConnect(0);
    },
    stop() {
      stopped = true;
      clearTimers();
      abort?.abort();
    },
    tryResume() {
      if (stopped) return;
      // Cancel any pending backoff and try right now.
      if (nextTimer) {
        clearTimeout(nextTimer);
        nextTimer = null;
      }
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      attempt = 0;
      scheduleConnect(0);
    },
    setBearer(next: string) {
      if (next === bearer) return;
      bearer = next;
      if (inFallback) {
        // We're deliberately in fallback — let the existing backoff /
        // fallback timers govern the next attempt. The fresh bearer is
        // already stored above and will be sent on whichever timer fires
        // next. Forcing an immediate reconnect here would short-circuit the
        // fallback strategy (and collapse the observable polling window).
        return;
      }
      // Drop the current connection so the new bearer takes effect on the
      // next attempt. Backoff timers are reset so we reconnect promptly.
      if (nextTimer) {
        clearTimeout(nextTimer);
        nextTimer = null;
      }
      attempt = 0;
      abort?.abort();
      if (!stopped) scheduleConnect(0);
    },
  };
}
