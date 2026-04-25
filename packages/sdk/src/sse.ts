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
 *
 * Liveness:
 *  - `connectTimeoutMs` bounds the initial handshake so a wedged TCP connect
 *    can't hang the read loop forever.
 *  - `idleTimeoutMs` is a frame-level watchdog: if no bytes arrive within the
 *    window, we abort and reconnect. The resolver sends `event: ping` every
 *    25s, so the default 60s leaves room for one missed heartbeat. This is
 *    what catches the "server died, undici keeps the read promise pending"
 *    case (see `build/sdk-sse-reconnect-followup.md`).
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
  /** Per-attempt handshake timeout. Default 10s. */
  connectTimeoutMs?: number;
  /** Drop & reconnect if no frame arrives within this window. Default 60s. */
  idleTimeoutMs?: number;
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
const DEFAULT_CONNECT_TIMEOUT = 10_000;
const DEFAULT_IDLE_TIMEOUT = 60_000;
const SERVER_ERROR_WINDOW = 60_000;
const SERVER_ERROR_THRESHOLD = 3;

export function createSseClient(opts: SseClientOptions): SseClient {
  const maxBackoff = opts.maxBackoffMs ?? DEFAULT_MAX_BACKOFF;
  const fallbackRetry = opts.fallbackRetryMs ?? DEFAULT_FALLBACK_RETRY;
  const connectTimeout = opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT;
  const idleTimeout = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT;

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

    // Handshake watchdog: if the initial fetch hasn't returned headers within
    // connectTimeoutMs, abort. Tracked separately from user-initiated aborts
    // (stop / setBearer) so the catch path knows to schedule a reconnect.
    let handshakeTimedOut = false;
    const handshakeTimer = setTimeout(() => {
      if (ctl.signal.aborted) return;
      handshakeTimedOut = true;
      opts.logger("warn", `sse: handshake timeout after ${connectTimeout}ms`);
      ctl.abort();
    }, connectTimeout);

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
      clearTimeout(handshakeTimer);
      if (stopped) return;
      // User-initiated abort (stop / setBearer): they've already arranged for
      // the next step. Handshake timeout looks like an abort too — fall
      // through so we schedule the reconnect.
      if (ctl.signal.aborted && !handshakeTimedOut) return;
      attempt += 1;
      opts.logger("warn", "sse: connect failed", err);
      scheduleConnect(backoffMs());
      return;
    }
    clearTimeout(handshakeTimer);

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

    // Idle watchdog: covers the undici case where the server dies mid-stream
    // and `reader.read()` neither resolves nor rejects. Re-armed on every
    // chunk; firing aborts the controller, which makes the read reject.
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const armIdle = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idleTimer = null;
        if (ctl.signal.aborted) return;
        opts.logger("warn", `sse: no frames in ${idleTimeout}ms, dropping`);
        ctl.abort();
      }, idleTimeout);
    };
    armIdle();

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buf = "";
    try {
      while (!stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        armIdle();
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
    } finally {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
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
