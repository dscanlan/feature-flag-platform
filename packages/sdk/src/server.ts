import { resolve } from "@ffp/resolver-engine";
import type {
  Audience,
  AudienceId,
  Flag,
  FlagStageConfig,
  ResolverFlagsResponse,
  Stage,
  Subject,
  SubjectType,
} from "@ffp/shared-types";
import { TinyEmitter } from "./emitter.js";
import { createSseClient, type SseClient } from "./sse.js";
import type {
  ClientSnapshot,
  ConnectionState,
  FlagClient,
  Logger,
  SdkEvent,
  ServerClientOptions,
} from "./types.js";

const MIN_POLL_MS = 1_000;
const DEFAULT_POLL_MS = 30_000;

const noopLogger: Logger = () => undefined;

interface Snapshot {
  stage: Stage | null;
  flags: Flag[];
  configsByFlagId: Map<string, FlagStageConfig>;
  audiencesById: Map<AudienceId, Audience>;
  subjectTypes: SubjectType[];
}

const emptySnapshot = (): Snapshot => ({
  stage: null,
  flags: [],
  configsByFlagId: new Map(),
  audiencesById: new Map(),
  subjectTypes: [],
});

export function createServerClient(options: ServerClientOptions): FlagClient {
  if (!options.serverKey) {
    throw new Error("serverKey is required for createServerClient");
  }
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? fetch.bind(globalThis);
  const log = options.logger ?? noopLogger;
  const pollMs = Math.max(MIN_POLL_MS, options.pollIntervalMs ?? DEFAULT_POLL_MS);
  const useStreaming = options.streaming !== false;

  const emitter = new TinyEmitter();
  let subject: Subject = options.subject;
  let snap: Snapshot = emptySnapshot();
  let closed = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let pollingActive = !useStreaming;
  let readyPromise: Promise<void> | null = null;
  let sse: SseClient | null = null;

  const initialState: ConnectionState = useStreaming ? "connecting" : "polling";
  let stateSnapshot: ClientSnapshot = {
    ready: false,
    error: null,
    connectionState: initialState,
    version: 0,
  };
  const stateListeners = new Set<() => void>();

  function publish(updates: Partial<Omit<ClientSnapshot, "version">> = {}): void {
    stateSnapshot = { ...stateSnapshot, ...updates, version: stateSnapshot.version + 1 };
    for (const listener of stateListeners) {
      try {
        listener();
      } catch {
        // listeners are user code — never let one break the loop
      }
    }
  }

  function recordFetchSuccess(cacheChanged: boolean): void {
    const updates: Partial<Omit<ClientSnapshot, "version">> = {};
    if (stateSnapshot.connectionState === "offline") {
      updates.connectionState = useStreaming ? "connecting" : "polling";
    }
    if (stateSnapshot.error !== null) updates.error = null;
    if (cacheChanged || Object.keys(updates).length > 0) publish(updates);
  }

  function recordFetchError(info: unknown): void {
    const updates: Partial<Omit<ClientSnapshot, "version">> = { error: info };
    if (stateSnapshot.connectionState !== "streaming") {
      updates.connectionState = "offline";
    }
    publish(updates);
  }

  function applySnapshot(next: Snapshot): boolean {
    const prev = snap;
    snap = next;
    let changed = false;
    // Diff: emit change for flags whose resolved valueIndex flipped against the
    // current subject. Server-mode resolves locally, so we walk both sides.
    for (const flag of next.flags) {
      const cfg = next.configsByFlagId.get(flag.id);
      if (!cfg) continue;
      const newRes = resolve({
        flag,
        config: cfg,
        subject,
        audiencesById: next.audiencesById,
        stageId: next.stage!.id,
        subjectTypes: next.subjectTypes,
      });
      const prevFlag = prev.flags.find((f) => f.key === flag.key);
      const prevCfg = prevFlag ? prev.configsByFlagId.get(prevFlag.id) : undefined;
      let prevIdx: number | null | undefined = undefined;
      if (prevFlag && prevCfg) {
        prevIdx = resolve({
          flag: prevFlag,
          config: prevCfg,
          subject,
          audiencesById: prev.audiencesById,
          stageId: prev.stage!.id,
          subjectTypes: prev.subjectTypes,
        }).valueIndex;
      }
      if (prevIdx !== newRes.valueIndex) {
        emitter.emit("change", { key: flag.key, value: newRes.value });
        changed = true;
      }
    }
    return changed;
  }

  async function fetchOnce(): Promise<void> {
    try {
      const res = await fetchImpl(`${baseUrl}/sdk/flags`, {
        method: "GET",
        headers: { authorization: `Bearer ${options.serverKey}` },
      });
      if (!res.ok) {
        log("warn", `flags returned ${res.status}`);
        emitter.emit("error", { status: res.status });
        recordFetchError({ status: res.status });
        return;
      }
      const body = (await res.json()) as ResolverFlagsResponse;
      const next: Snapshot = {
        stage: { ...body.stage } as Stage,
        flags: body.flags,
        configsByFlagId: new Map(body.configs.map((c) => [c.flagId, c])),
        audiencesById: new Map(body.audiences.map((a) => [a.id, a])),
        subjectTypes: body.subjectTypes,
      };
      const cacheChanged = applySnapshot(next);
      recordFetchSuccess(cacheChanged);
    } catch (err) {
      log("warn", "flags fetch failed", err);
      emitter.emit("error", { err });
      recordFetchError({ err });
    }
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
      bearer: options.serverKey,
      fetchImpl,
      logger: log,
      idleTimeoutMs: options.streamIdleTimeoutMs,
      connectTimeoutMs: options.streamConnectTimeoutMs,
      onEvent: (event) => {
        if (event === "change" || event === "ready") void fetchOnce();
      },
      onOpen: () => {
        if (stateSnapshot.connectionState !== "streaming") {
          publish({ connectionState: "streaming" });
        }
      },
      onFallback: () => {
        if (pollingActive) return;
        pollingActive = true;
        log("info", "sdk: enabling polling fallback");
        publish({ connectionState: "polling" });
        void fetchOnce().then(() => schedulePoll());
      },
      onResume: () => {
        if (!pollingActive) return;
        pollingActive = false;
        log("info", "sdk: streaming resumed, stopping polling");
        clearPoll();
        if (stateSnapshot.connectionState !== "streaming") {
          publish({ connectionState: "streaming" });
        }
      },
    });
    sse.start();
  }

  function lookup(key: string) {
    const flag = snap.flags.find((f) => f.key === key);
    if (!flag) return null;
    const cfg = snap.configsByFlagId.get(flag.id);
    if (!cfg || !snap.stage) return null;
    return { flag, cfg };
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
      // Server-mode: rebind locally, no network.
      subject = next;
      publish();
    },
    async setSubjectToken(_token: string | null) {
      // Server-mode SDK has the full ruleset and resolves locally; subject
      // tokens are a client-mode (browser) concern. Accept the call so the
      // FlagClient contract holds, but it's a no-op.
    },
    boolFlag(key, defaultValue) {
      const found = lookup(key);
      if (!found) return defaultValue;
      if (found.flag.kind !== "boolean") {
        log("warn", `boolFlag(${key}) called on a ${found.flag.kind} flag; returning default`, {
          code: "WRONG_TYPE",
        });
        return defaultValue;
      }
      const r = resolve({
        flag: found.flag,
        config: found.cfg,
        subject,
        audiencesById: snap.audiencesById,
        stageId: snap.stage!.id,
        subjectTypes: snap.subjectTypes,
      });
      if (typeof r.value !== "boolean") return defaultValue;
      return r.value;
    },
    jsonFlag<T>(key: string, defaultValue: T): T {
      const found = lookup(key);
      if (!found) return defaultValue;
      if (found.flag.kind !== "json") {
        log("warn", `jsonFlag(${key}) called on a ${found.flag.kind} flag; returning default`, {
          code: "WRONG_TYPE",
        });
        return defaultValue;
      }
      const r = resolve({
        flag: found.flag,
        config: found.cfg,
        subject,
        audiencesById: snap.audiencesById,
        stageId: snap.stage!.id,
        subjectTypes: snap.subjectTypes,
      });
      if (r.value === null || r.value === undefined) return defaultValue;
      try {
        return structuredClone(r.value) as T;
      } catch {
        return defaultValue;
      }
    },
    allFlags() {
      const out: Record<string, unknown> = {};
      if (!snap.stage) return out;
      for (const flag of snap.flags) {
        const cfg = snap.configsByFlagId.get(flag.id);
        if (!cfg) continue;
        const r = resolve({
          flag,
          config: cfg,
          subject,
          audiencesById: snap.audiencesById,
          stageId: snap.stage.id,
          subjectTypes: snap.subjectTypes,
        });
        out[flag.key] = r.value;
      }
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
      return stateSnapshot;
    },
    close() {
      closed = true;
      clearPoll();
      sse?.stop();
      if (stateSnapshot.connectionState !== "offline") {
        publish({ connectionState: "offline" });
      }
    },
  };
}
