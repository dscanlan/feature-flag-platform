import type { FlagKind, ResolverResolveResponse, Subject } from "@ffp/shared-types";
import { TinyEmitter } from "./emitter.js";
import { createSseClient, type SseClient } from "./sse.js";
import type {
  ClientOptions,
  ClientSnapshot,
  ConnectionState,
  FlagClient,
  Logger,
  SdkEvent,
} from "./types.js";

const MIN_POLL_MS = 1_000;
const DEFAULT_POLL_MS = 30_000;

const noopLogger: Logger = () => undefined;

interface CachedEntry {
  value: unknown;
  valueIndex: number | null;
  kind: FlagKind;
}

type Cache = Map<string, CachedEntry>;

export function createClient(options: ClientOptions): FlagClient {
  if (!options.publicKey) {
    throw new Error(
      "publicKey is required for createClient — use createServerClient for server mode",
    );
  }
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const log = options.logger ?? noopLogger;
  const pollMs = Math.max(MIN_POLL_MS, options.pollIntervalMs ?? DEFAULT_POLL_MS);
  const useStreaming = options.streaming !== false;

  const emitter = new TinyEmitter();
  let subject: Subject = options.subject;
  let subjectToken: string | undefined = options.subjectToken;
  let cache: Cache = new Map();
  let closed = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let pollingActive = !useStreaming;
  let readyPromise: Promise<void> | null = null;
  let sse: SseClient | null = null;
  // Set when the resolver issues a stream token; used as Bearer for /sdk/stream.
  let streamBearer: string = options.publicKey!;

  // Snapshot machinery — single object reference replaced only on transitions
  // so useSyncExternalStore consumers can compare with Object.is.
  const initialState: ConnectionState = useStreaming ? "connecting" : "polling";
  let snapshot: ClientSnapshot = {
    ready: false,
    error: null,
    connectionState: initialState,
    version: 0,
  };
  const stateListeners = new Set<() => void>();

  function publish(updates: Partial<Omit<ClientSnapshot, "version">> = {}): void {
    snapshot = { ...snapshot, ...updates, version: snapshot.version + 1 };
    for (const listener of stateListeners) {
      try {
        listener();
      } catch {
        // listeners are user code — never let one break the loop
      }
    }
  }

  function applyResults(results: ResolverResolveResponse["results"]): boolean {
    const next: Cache = new Map();
    for (const [key, r] of Object.entries(results)) {
      next.set(key, { value: r.value, valueIndex: r.valueIndex, kind: r.kind });
    }
    let changed = next.size !== cache.size;
    for (const [key, entry] of next) {
      const prev = cache.get(key);
      if (!prev || prev.valueIndex !== entry.valueIndex) {
        emitter.emit("change", { key, value: entry.value });
        changed = true;
      }
    }
    cache = next;
    return changed;
  }

  async function fetchOnce(): Promise<void> {
    try {
      // When a signed subjectToken is set, send it instead of the raw
      // subject — the resolver extracts the trusted claims server-side.
      const body = subjectToken ? { subjectToken } : { subject };
      const res = await fetchImpl(`${baseUrl}/sdk/resolve`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${options.publicKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        log("warn", `resolve returned ${res.status}`);
        emitter.emit("error", { status: res.status });
        recordFetchError({ status: res.status });
        return;
      }
      const payload = (await res.json()) as ResolverResolveResponse;
      // If the resolver issued a stream token, prefer it for SSE auth.
      // Bound to (stage, subject, exp), so it scopes the stream connection
      // to exactly the subject we just resolved against.
      if (payload.streamToken) {
        streamBearer = payload.streamToken;
        sse?.setBearer(payload.streamToken);
      }
      const cacheChanged = applyResults(payload.results);
      recordFetchSuccess(cacheChanged);
    } catch (err) {
      log("warn", "resolve fetch failed", err);
      emitter.emit("error", { err });
      recordFetchError({ err });
    }
  }

  function recordFetchSuccess(cacheChanged: boolean): void {
    const updates: Partial<Omit<ClientSnapshot, "version">> = {};
    // If we were "offline" (consecutive errors), come back to the appropriate
    // non-streaming state. Streaming is governed separately by SSE callbacks.
    if (snapshot.connectionState === "offline") {
      updates.connectionState = useStreaming ? "connecting" : "polling";
    }
    if (snapshot.error !== null) updates.error = null;
    if (cacheChanged || Object.keys(updates).length > 0) publish(updates);
  }

  function recordFetchError(info: unknown): void {
    const updates: Partial<Omit<ClientSnapshot, "version">> = { error: info };
    // Only flip to "offline" when streaming isn't currently carrying us. If a
    // poll/resolve fails while SSE is healthy, leave state at "streaming".
    if (snapshot.connectionState !== "streaming") {
      updates.connectionState = "offline";
    }
    publish(updates);
  }

  function clearPoll(): void {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function schedulePoll(): void {
    if (closed || !pollingActive) return;
    clearPoll();
    pollTimer = setTimeout(async () => {
      pollTimer = null;
      await fetchOnce();
      schedulePoll();
    }, pollMs);
  }

  function startStreaming(): void {
    if (sse || closed) return;
    sse = createSseClient({
      url: `${baseUrl}/sdk/stream`,
      bearer: streamBearer,
      fetchImpl,
      logger: log,
      onEvent: (event) => {
        if (event === "change" || event === "ready") {
          void fetchOnce();
        }
      },
      onOpen: () => {
        if (snapshot.connectionState !== "streaming") {
          publish({ connectionState: "streaming" });
        }
      },
      onFallback: () => {
        if (pollingActive) return;
        pollingActive = true;
        log("info", "sdk: enabling polling fallback");
        publish({ connectionState: "polling" });
        // Immediate refresh + start the poll loop.
        void fetchOnce().then(() => schedulePoll());
      },
      onResume: () => {
        if (!pollingActive) return;
        pollingActive = false;
        log("info", "sdk: streaming resumed, stopping polling");
        clearPoll();
        if (snapshot.connectionState !== "streaming") {
          publish({ connectionState: "streaming" });
        }
      },
    });
    sse.start();
  }

  return {
    async ready(): Promise<void> {
      if (!readyPromise) {
        readyPromise = (async () => {
          await fetchOnce();
          emitter.emit("ready", null);
          publish({ ready: true });
          if (useStreaming) startStreaming();
          if (pollingActive) schedulePoll();
        })();
      }
      return readyPromise;
    },
    getSubject() {
      return subject;
    },
    async setSubject(next: Subject) {
      subject = next;
      await fetchOnce();
    },
    async setSubjectToken(token: string | null) {
      subjectToken = token ?? undefined;
      await fetchOnce();
    },
    boolFlag(key, defaultValue) {
      const entry = cache.get(key);
      if (!entry) return defaultValue;
      if (entry.kind !== "boolean") {
        log("warn", `boolFlag(${key}) called on a ${entry.kind} flag; returning default`, {
          code: "WRONG_TYPE",
        });
        return defaultValue;
      }
      if (typeof entry.value !== "boolean") return defaultValue;
      return entry.value;
    },
    jsonFlag<T>(key: string, defaultValue: T): T {
      const entry = cache.get(key);
      if (!entry) return defaultValue;
      if (entry.kind !== "json") {
        log("warn", `jsonFlag(${key}) called on a ${entry.kind} flag; returning default`, {
          code: "WRONG_TYPE",
        });
        return defaultValue;
      }
      if (entry.value === null || entry.value === undefined) return defaultValue;
      try {
        return structuredClone(entry.value) as T;
      } catch {
        return defaultValue;
      }
    },
    allFlags() {
      const out: Record<string, unknown> = {};
      for (const [k, v] of cache) out[k] = v.value;
      return out;
    },
    on(event: SdkEvent, listener: (info: unknown) => void): () => void {
      return emitter.on(event, listener);
    },
    subscribe(listener: () => void): () => void {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    getState(): ClientSnapshot {
      return snapshot;
    },
    close() {
      closed = true;
      clearPoll();
      sse?.stop();
      if (snapshot.connectionState !== "offline") {
        publish({ connectionState: "offline" });
      }
    },
  };
}
