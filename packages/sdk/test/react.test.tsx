// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode, useState } from "react";
import { act, render, screen, cleanup } from "@testing-library/react";
import type { FlagClient, ClientSnapshot } from "../src/types.js";
import { FlagsProvider, useFlags, useFlagClient } from "../src/react.js";

afterEach(() => cleanup());

interface FakeClient extends FlagClient {
  __setSnapshot(updates: Partial<Omit<ClientSnapshot, "version">>): void;
  __setBool(key: string, value: boolean): void;
  __setJson(key: string, value: unknown): void;
  __readyCalls: number;
  __closeCalls: number;
}

function createFakeClient(initial?: Partial<Omit<ClientSnapshot, "version">>): FakeClient {
  let snapshot: ClientSnapshot = {
    ready: false,
    error: null,
    connectionState: "connecting",
    version: 0,
    ...initial,
  };
  const listeners = new Set<() => void>();
  const bools = new Map<string, boolean>();
  const jsons = new Map<string, unknown>();

  function publish(updates: Partial<Omit<ClientSnapshot, "version">> = {}): void {
    snapshot = { ...snapshot, ...updates, version: snapshot.version + 1 };
    for (const l of listeners) l();
  }

  const client: FakeClient = {
    __readyCalls: 0,
    __closeCalls: 0,
    __setSnapshot(updates) {
      publish(updates);
    },
    __setBool(key, value) {
      bools.set(key, value);
      publish();
    },
    __setJson(key, value) {
      jsons.set(key, value);
      publish();
    },
    async ready() {
      client.__readyCalls += 1;
    },
    getSubject() {
      return { type: "user", id: "u" };
    },
    async setSubject() {
      /* noop */
    },
    async setSubjectToken() {
      /* noop */
    },
    boolFlag(key, defaultValue) {
      return bools.has(key) ? (bools.get(key) as boolean) : defaultValue;
    },
    jsonFlag<T>(key: string, defaultValue: T): T {
      return jsons.has(key) ? (jsons.get(key) as T) : defaultValue;
    },
    allFlags() {
      const out: Record<string, unknown> = {};
      for (const [k, v] of bools) out[k] = v;
      for (const [k, v] of jsons) out[k] = v;
      return out;
    },
    on() {
      return () => undefined;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState() {
      return snapshot;
    },
    close() {
      client.__closeCalls += 1;
    },
  };
  return client;
}

describe("FlagsProvider + useFlags", () => {
  it("auto-calls ready() once on mount", () => {
    const client = createFakeClient();
    render(
      <FlagsProvider client={client}>
        <span>x</span>
      </FlagsProvider>,
    );
    expect(client.__readyCalls).toBe(1);
  });

  it("does not call ready() when autoReady={false}", () => {
    const client = createFakeClient();
    render(
      <FlagsProvider client={client} autoReady={false}>
        <span>x</span>
      </FlagsProvider>,
    );
    expect(client.__readyCalls).toBe(0);
  });

  it("ready() is idempotent under StrictMode double-mount", () => {
    // The fake counts every ready() invocation. The real client (client.ts)
    // caches the readyPromise, so a second call is a free reuse — that
    // contract is verified separately in client.test.ts.
    const client = createFakeClient();
    render(
      <StrictMode>
        <FlagsProvider client={client}>
          <span>x</span>
        </FlagsProvider>
      </StrictMode>,
    );
    // StrictMode mounts → unmounts → remounts, so ready() is called twice on
    // the dev double-mount. Verify the provider doesn't multiply that further.
    expect(client.__readyCalls).toBeLessThanOrEqual(2);
    expect(client.__readyCalls).toBeGreaterThanOrEqual(1);
  });

  it("does not close the client on unmount by default", () => {
    const client = createFakeClient();
    const { unmount } = render(
      <FlagsProvider client={client}>
        <span>x</span>
      </FlagsProvider>,
    );
    unmount();
    expect(client.__closeCalls).toBe(0);
  });

  it("closes the client on unmount when closeOnUnmount={true}", () => {
    const client = createFakeClient();
    const { unmount } = render(
      <FlagsProvider client={client} closeOnUnmount>
        <span>x</span>
      </FlagsProvider>,
    );
    unmount();
    expect(client.__closeCalls).toBe(1);
  });

  it("useFlags() throws when used outside the provider", () => {
    function Consumer() {
      useFlags();
      return null;
    }
    // React logs the error to console.error; suppress for clean test output.
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Consumer />)).toThrow(/inside a <FlagsProvider>/);
    spy.mockRestore();
  });

  it("re-renders consumers when a flag value changes", () => {
    const client = createFakeClient();
    function Banner() {
      const flags = useFlags();
      return <span data-testid="banner">{flags.boolFlag("gate", false) ? "on" : "off"}</span>;
    }
    render(
      <FlagsProvider client={client}>
        <Banner />
      </FlagsProvider>,
    );
    expect(screen.getByTestId("banner").textContent).toBe("off");
    act(() => client.__setBool("gate", true));
    expect(screen.getByTestId("banner").textContent).toBe("on");
  });

  it("surfaces error and connectionState transitions", () => {
    const client = createFakeClient();
    function Status() {
      const flags = useFlags();
      return (
        <>
          <span data-testid="conn">{flags.connectionState}</span>
          <span data-testid="ready">{flags.ready ? "yes" : "no"}</span>
          <span data-testid="err">{flags.error ? "yes" : "no"}</span>
        </>
      );
    }
    render(
      <FlagsProvider client={client}>
        <Status />
      </FlagsProvider>,
    );
    expect(screen.getByTestId("conn").textContent).toBe("connecting");
    expect(screen.getByTestId("ready").textContent).toBe("no");

    act(() => client.__setSnapshot({ ready: true, connectionState: "streaming" }));
    expect(screen.getByTestId("ready").textContent).toBe("yes");
    expect(screen.getByTestId("conn").textContent).toBe("streaming");

    act(() => client.__setSnapshot({ connectionState: "polling" }));
    expect(screen.getByTestId("conn").textContent).toBe("polling");

    act(() => client.__setSnapshot({ connectionState: "streaming", error: { status: 503 } }));
    expect(screen.getByTestId("conn").textContent).toBe("streaming");
    expect(screen.getByTestId("err").textContent).toBe("yes");
  });

  it("useFlagClient() returns the same instance passed to the provider", () => {
    const client = createFakeClient();
    let captured: FlagClient | null = null;
    function Capture() {
      captured = useFlagClient();
      return null;
    }
    render(
      <FlagsProvider client={client}>
        <Capture />
      </FlagsProvider>,
    );
    expect(captured).toBe(client);
  });

  it("getState() returns identity-equal snapshots between unrelated renders", () => {
    const client = createFakeClient();
    let parentRenders = 0;
    function Parent() {
      parentRenders += 1;
      const [, setN] = useState(0);
      // Force a re-render at the parent without touching client state.
      // useFlags should not produce a new snapshot.
      return (
        <>
          <button data-testid="bump" onClick={() => setN((n) => n + 1)}>
            bump
          </button>
          <Child />
        </>
      );
    }
    let snapshots: ClientSnapshot[] = [];
    function Child() {
      useFlags();
      snapshots.push(client.getState());
      return null;
    }
    render(
      <FlagsProvider client={client}>
        <Parent />
      </FlagsProvider>,
    );
    const first = snapshots[0]!;
    act(() => screen.getByTestId("bump").click());
    const second = snapshots[snapshots.length - 1]!;
    expect(parentRenders).toBeGreaterThan(1);
    expect(second).toBe(first); // identity equality across unrelated re-renders
  });
});
