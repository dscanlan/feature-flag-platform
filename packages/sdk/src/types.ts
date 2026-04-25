import type { Subject } from "@ffp/shared-types";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type Logger = (level: LogLevel, msg: string, meta?: unknown) => void;

export type SdkEvent = "ready" | "change" | "error";

export type ConnectionState = "connecting" | "streaming" | "polling" | "offline";

/**
 * Immutable view of the client's lifecycle state. The same object reference is
 * returned by `getState()` until something changes — `useSyncExternalStore` and
 * other React-style subscribers rely on this for change detection.
 */
export interface ClientSnapshot {
  ready: boolean;
  error: unknown | null;
  connectionState: ConnectionState;
  /** Monotonic counter — bumps on any cache or state change. */
  version: number;
}

export interface ClientOptions {
  baseUrl: string;
  publicKey?: string; // client mode
  serverKey?: string; // server mode
  subject: Subject;
  /**
   * Optional signed `sjt-` token issued by your backend. When set, the SDK
   * sends this on /sdk/resolve INSTEAD of the raw subject — the resolver
   * extracts the trusted subject claims from the token. The local `subject`
   * field is still required (the React/UI layer reads it for display) but
   * its attributes are not sent over the wire when a token is present.
   * See PLAN.md §7.6 — recommended for sensitive flag use.
   */
  subjectToken?: string;
  pollIntervalMs?: number;
  logger?: Logger;
  /** Inject a fetch impl (mainly for tests). */
  fetch?: typeof fetch;
  /** Disable SSE streaming (force polling). Default: true (streaming on). */
  streaming?: boolean;
  /**
   * Drop & reconnect the stream if no frame arrives within this window. The
   * resolver pings every 25s; the SDK default (60s) leaves room for one
   * missed heartbeat. Lower values speed up dead-connection detection at the
   * cost of more reconnects under flaky networks. Mainly a test knob.
   */
  streamIdleTimeoutMs?: number;
  /** Per-attempt SSE handshake timeout. Default 10s. Mainly a test knob. */
  streamConnectTimeoutMs?: number;
}

export interface ServerClientOptions {
  baseUrl: string;
  serverKey: string;
  subject: Subject;
  pollIntervalMs?: number;
  logger?: Logger;
  fetch?: typeof fetch;
  streaming?: boolean;
  /** See ClientOptions.streamIdleTimeoutMs. */
  streamIdleTimeoutMs?: number;
  /** See ClientOptions.streamConnectTimeoutMs. */
  streamConnectTimeoutMs?: number;
}

export interface FlagClient {
  ready(): Promise<void>;
  getSubject(): Subject;
  setSubject(next: Subject): Promise<void>;
  /**
   * Replace the signed subject token used on subsequent /sdk/resolve calls.
   * Pass `null` to clear it (revert to sending the raw subject). Triggers an
   * immediate refetch. Server-mode SDK ignores this — it doesn't talk to
   * /sdk/resolve. PLAN.md §7.6.
   */
  setSubjectToken(token: string | null): Promise<void>;
  boolFlag(key: string, defaultValue: boolean): boolean;
  jsonFlag<T = unknown>(key: string, defaultValue: T): T;
  allFlags(): Record<string, unknown>;
  on(event: SdkEvent, listener: (info: unknown) => void): () => void;
  /**
   * Framework-neutral subscription. Listener fires every time the snapshot
   * version bumps — i.e. on cache changes, ready completion, connection-state
   * transitions, errors. Returns an unsubscribe function. Used by the React
   * binding (`@ffp/sdk/react`) but available to any other subscription model.
   */
  subscribe(listener: () => void): () => void;
  /** Read the current immutable snapshot. Stable reference between bumps. */
  getState(): ClientSnapshot;
  close(): void;
}
