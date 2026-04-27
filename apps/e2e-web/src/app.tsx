import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from "react";
import { createClient, type FlagClient } from "@ffp/sdk/client";
import { FlagsProvider, useFlagClient, useFlags } from "@ffp/sdk/react";

interface RuntimeConfig {
  resolverUrl: string;
  directResolverUrl: string;
  publicKey: string;
  pollIntervalMs: number;
  users: string[];
}

declare global {
  interface Window {
    __sdk?: {
      tryResume: () => void;
    };
  }
}

const fallbackPricing = { tier: "free" };

export function App() {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function loadRuntime(): Promise<void> {
      while (!cancelled) {
        try {
          const res = await fetch("/sidecar/runtime");
          if (res.ok) {
            const next = (await res.json()) as RuntimeConfig;
            const search = new URLSearchParams(window.location.search);
            const transport = search.get("transport");
            const finalConfig =
              transport === "direct" ? { ...next, resolverUrl: next.directResolverUrl } : next;
            if (!cancelled) setConfig(finalConfig);
            return;
          }
        } catch {
          // The stack may still be coming up.
        }
        await sleep(250);
      }
    }
    void loadRuntime();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    window.__sdk = {
      tryResume: () => setGeneration((value) => value + 1),
    };
    return () => {
      delete window.__sdk;
    };
  }, []);

  if (!config) {
    return <BootShell bootState="booting" />;
  }

  // `key` forces a fresh provider + client when generation changes, so the old
  // client is unmounted (closeOnUnmount) and a new one connects.
  return <Harness key={generation} config={config} />;
}

function Harness({ config }: { config: RuntimeConfig }) {
  const [lastError, setLastError] = useState("none");
  const updateLastError = useCallback((value: string) => {
    setLastError((prev) => (prev === "none" || value !== "none" ? value : prev));
  }, []);

  // Tests that need to assert on `last-error` opt in via ?instrument=fetch.
  // The default path passes no `fetch`, so the SDK falls back to the global
  // — the shape real apps ship with. Exercising that path is what catches
  // regressions like the Chromium "Illegal invocation" bug from passing a
  // bare global fetch through method-call indirection in sse.ts.
  const instrumented = useMemo(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("instrument") === "fetch";
  }, []);

  const wrappedFetch = useMemo<typeof fetch>(() => {
    return async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      try {
        const res = await fetch(input, init);
        if ((url.includes("/sdk/resolve") || url.includes("/sdk/stream")) && !res.ok) {
          const next = await describeErrorResponse(res);
          updateLastError(next);
        }
        return res;
      } catch (err) {
        if (url.includes("/sdk/stream") || url.includes("/sdk/resolve")) {
          updateLastError(`NETWORK_ERROR: ${describeThrownError(err)}`);
        }
        throw err;
      }
    };
  }, [updateLastError]);

  // One client per Harness mount. The `key={generation}` in App rotates this
  // component on window.__sdk.tryResume(), and `closeOnUnmount` lets the
  // provider tear the old client down when the new one mounts.
  const [client] = useState<FlagClient>(() =>
    createClient({
      baseUrl: config.resolverUrl,
      publicKey: config.publicKey,
      subject: { type: "user", id: config.users[0] ?? "user-anon" },
      pollIntervalMs: config.pollIntervalMs,
      ...(instrumented ? { fetch: wrappedFetch } : {}),
      logger(level, msg, meta) {
        const suffix = formatMeta(meta);
        const line = `[sdk:${level}] ${msg}${suffix ? ` ${suffix}` : ""}`;
        if (level === "warn") console.warn(line);
        if (level === "error") console.error(line);
      },
    }),
  );

  return (
    <FlagsProvider client={client} closeOnUnmount>
      <Shell config={config} lastError={lastError} updateLastError={updateLastError} />
    </FlagsProvider>
  );
}

interface ShellProps {
  config: RuntimeConfig;
  lastError: string;
  updateLastError: (value: string) => void;
}

function Shell({ config, lastError, updateLastError }: ShellProps) {
  const flags = useFlags();
  const client = useFlagClient();

  const [selectedUser, setSelectedUser] = useState(config.users[0] ?? "user-anon");
  const [tokenUser, setTokenUser] = useState(config.users[1] ?? config.users[0] ?? "user-anon");
  const [token, setToken] = useState<string | null>(null);
  const [readPricingAsBoolean, setReadPricingAsBoolean] = useState(false);

  useEffect(() => {
    void client.setSubject({ type: "user", id: selectedUser });
  }, [client, selectedUser]);

  // The harness renders a coarse boot-state purely for debugging — tests
  // assert on `app-ready` instead. Derive it from the SDK lifecycle.
  const bootState = !flags.ready
    ? flags.connectionState === "offline"
      ? "resolve-error"
      : "ready-started"
    : "ready-done";

  const checkoutEnabled = readPricingAsBoolean
    ? flags.boolFlag("pricing", false)
    : flags.boolFlag("new-checkout", false);

  const pricingValue = flags.jsonFlag("pricing", fallbackPricing);

  const userOptions = config.users;

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "32px 16px",
      }}
    >
      <section
        style={{
          width: "min(960px, 100%)",
          borderRadius: 28,
          padding: 28,
          background: "rgba(255,255,255,0.82)",
          backdropFilter: "blur(14px)",
          boxShadow: "0 18px 50px rgba(15, 23, 42, 0.12)",
          border: "1px solid rgba(148, 163, 184, 0.3)",
        }}
      >
        <p style={{ margin: 0, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          Browser Harness
        </p>
        <h1 style={{ margin: "12px 0 24px", fontSize: "clamp(2rem, 5vw, 3rem)" }}>
          Real SDK client against the live resolver
        </h1>

        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            marginBottom: 24,
          }}
        >
          <label style={fieldStyle}>
            <span>User</span>
            <select
              data-testid="user-picker"
              value={selectedUser}
              onChange={(event) => setSelectedUser(event.target.value)}
            >
              {userOptions.map((userId) => (
                <option key={userId} value={userId}>
                  {userId}
                </option>
              ))}
            </select>
          </label>

          <label style={fieldStyle}>
            <span>Token User</span>
            <select
              data-testid="token-user-picker"
              value={tokenUser}
              onChange={(event) => setTokenUser(event.target.value)}
            >
              {userOptions.map((userId) => (
                <option key={userId} value={userId}>
                  {userId}
                </option>
              ))}
            </select>
          </label>

          <div style={{ ...fieldStyle, alignItems: "stretch" }}>
            <span>Subject Mode</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button data-testid="use-raw" onClick={() => void handleUseRaw(client, setToken)}>
                Use Raw
              </button>
              <button
                data-testid="use-token"
                onClick={() =>
                  void handleUseToken(
                    client,
                    tokenUser,
                    "/sidecar/sign-subject-token",
                    setToken,
                    updateLastError,
                  )
                }
              >
                Use Token
              </button>
              <button
                data-testid="use-bad-token"
                onClick={() =>
                  void handleUseToken(
                    client,
                    tokenUser,
                    "/sidecar/sign-bad-token",
                    setToken,
                    updateLastError,
                  )
                }
              >
                Use Bad Token
              </button>
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            alignItems: "start",
          }}
        >
          <article style={cardStyle}>
            <strong>Boolean Flag</strong>
            <div
              data-testid="checkout-banner"
              style={{ marginTop: 12, fontSize: 28, fontWeight: 700 }}
            >
              {`new-checkout: ${checkoutEnabled ? "on" : "off"}`}
            </div>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 16,
                fontSize: 14,
              }}
            >
              <input
                data-testid="read-pricing-as-boolean"
                type="checkbox"
                checked={readPricingAsBoolean}
                onChange={(event) => setReadPricingAsBoolean(event.target.checked)}
              />
              read pricing as bool
            </label>
          </article>

          <article style={cardStyle}>
            <strong>JSON Flag</strong>
            <pre
              data-testid="pricing-card"
              style={{
                margin: "12px 0 0",
                padding: 14,
                borderRadius: 16,
                background: "#0f172a",
                color: "#e2e8f0",
                overflowX: "auto",
              }}
            >
              {JSON.stringify(pricingValue, null, 2)}
            </pre>
            <button
              data-testid="mutate-pricing"
              style={{ marginTop: 12 }}
              onClick={() => {
                const value = client.jsonFlag("pricing", fallbackPricing);
                if (value && typeof value === "object") {
                  (value as { tier?: string }).tier = "mutated";
                }
              }}
            >
              Mutate Local Copy
            </button>
          </article>

          <article style={cardStyle}>
            <strong>Diagnostics</strong>
            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              <div>
                ready: <span data-testid="app-ready">{flags.ready ? "yes" : "no"}</span>
              </div>
              <div>
                boot: <span data-testid="boot-state">{bootState}</span>
              </div>
              <div>
                connection:{" "}
                <span data-testid="connection-state">
                  {normalizeConnection(flags.connectionState)}
                </span>
              </div>
              <div>
                token active: <span data-testid="token-state">{token ? "yes" : "no"}</span>
              </div>
            </div>
            <output
              data-testid="last-error"
              style={{
                display: "block",
                marginTop: 12,
                padding: 12,
                borderRadius: 12,
                background: "#fff7ed",
                color: "#9a3412",
                minHeight: 48,
                whiteSpace: "pre-wrap",
              }}
            >
              {lastError}
            </output>
          </article>
        </div>
      </section>
    </main>
  );
}

function BootShell({ bootState }: { bootState: string }) {
  return (
    <main style={{ padding: 32 }}>
      <span data-testid="app-ready">no</span>
      <span data-testid="boot-state">{bootState}</span>
    </main>
  );
}

const fieldStyle: CSSProperties = {
  display: "grid",
  gap: 8,
};

const cardStyle: CSSProperties = {
  padding: 20,
  borderRadius: 22,
  background: "rgba(255,255,255,0.92)",
  border: "1px solid rgba(148, 163, 184, 0.25)",
};

async function handleUseRaw(
  client: FlagClient,
  setToken: Dispatch<SetStateAction<string | null>>,
): Promise<void> {
  setToken(null);
  await client.setSubjectToken(null);
}

async function handleUseToken(
  client: FlagClient,
  userId: string,
  path: string,
  setToken: Dispatch<SetStateAction<string | null>>,
  updateLastError: (value: string) => void,
): Promise<void> {
  updateLastError("none");
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  const payload = (await res.json()) as { token: string };
  setToken(payload.token);
  await client.setSubjectToken(payload.token);
}

async function describeErrorResponse(res: Response): Promise<string> {
  try {
    const payload = (await res.clone().json()) as { error?: { code?: string; message?: string } };
    if (payload.error?.code) {
      return `${payload.error.code}: ${payload.error.message ?? `status ${res.status}`}`;
    }
  } catch {
    // The browser turns CORS denials into opaque failures before JS can see them.
  }
  return `HTTP_${res.status}`;
}

function describeThrownError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function formatMeta(meta: unknown): string {
  if (!meta) return "";
  try {
    return JSON.stringify(meta);
  } catch {
    return String(meta);
  }
}

// `connecting` is an SDK-internal pre-ready state. Tests assert on the three
// post-ready states only, so collapse `connecting` → `offline` for display
// stability with the prior harness.
function normalizeConnection(state: string): string {
  if (state === "connecting") return "offline";
  return state;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
