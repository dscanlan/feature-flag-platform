import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { spawnHost, type HostHandle } from "./helpers/host.ts";
import { provisionStage, type IsolatedStage } from "./helpers/stack.ts";

const WORKSPACE_KEY = "e2e-node-server-mode-1";

describe("server-mode SDK against a live resolver", () => {
  let stage: IsolatedStage;
  let host: HostHandle;

  beforeAll(async () => {
    stage = await provisionStage({ workspaceKey: WORKSPACE_KEY });
    await stage.seed.ensureBooleanFlag("new-checkout");
    await stage.seed.ensureJsonFlag("pricing", [
      { value: { tier: "free" }, name: "Free" },
      { value: { tier: "pro" }, name: "Pro" },
    ]);
    await stage.seed.setFlagConfig("new-checkout", {
      enabled: false,
      disabledValueIndex: 0,
      defaultServe: { kind: "value", valueIndex: 1 },
      pinned: [],
      rules: [],
    });
    await stage.seed.setFlagConfig("pricing", {
      enabled: true,
      disabledValueIndex: 0,
      defaultServe: { kind: "value", valueIndex: 0 },
      pinned: [],
      rules: [],
    });

    host = await spawnHost({
      resolverUrl: stage.resolverUrl,
      serverKey: stage.serverKey,
      publicKey: stage.publicKey,
    });
  });

  afterAll(async () => {
    await host?.stop();
  });

  test("boolean flag toggle propagates within 1s", async () => {
    // Initial state: disabled flag returns the disabled-value (index 0 = false).
    const initial = (await fetchJson(`${host.url}/?user=alice`)) as { checkout: boolean };
    expect(initial.checkout).toBe(false);

    const startedOn = Date.now();
    await stage.seed.toggleFlag("new-checkout", true);
    await waitFor(async () => {
      const r = (await fetchJson(`${host.url}/?user=alice`)) as { checkout: boolean };
      return r.checkout === true;
    }, 2_000);
    expect(Date.now() - startedOn).toBeLessThan(1_500);

    const startedOff = Date.now();
    await stage.seed.toggleFlag("new-checkout", false);
    await waitFor(async () => {
      const r = (await fetchJson(`${host.url}/?user=alice`)) as { checkout: boolean };
      return r.checkout === false;
    }, 2_000);
    expect(Date.now() - startedOff).toBeLessThan(1_500);
  });

  test("JSON flag round-trips and reacts to default changes", async () => {
    await stage.seed.setFlagConfig("pricing", {
      enabled: true,
      disabledValueIndex: 0,
      defaultServe: { kind: "value", valueIndex: 0 },
      pinned: [],
      rules: [],
    });
    await waitFor(async () => {
      const r = (await fetchJson(`${host.url}/?user=alice`)) as { pricing: { tier: string } };
      return r.pricing?.tier === "free";
    }, 2_000);

    await stage.seed.setFlagConfig("pricing", {
      enabled: true,
      disabledValueIndex: 0,
      defaultServe: { kind: "value", valueIndex: 1 },
      pinned: [],
      rules: [],
    });
    await waitFor(async () => {
      const r = (await fetchJson(`${host.url}/?user=alice`)) as { pricing: { tier: string } };
      return r.pricing?.tier === "pro";
    }, 2_000);
  });

  test("composite subject resolves the pinned value when present", async () => {
    await stage.seed.setFlagConfig("new-checkout", {
      enabled: true,
      disabledValueIndex: 0,
      defaultServe: { kind: "value", valueIndex: 0 }, // default = false
      pinned: [{ subjectType: "account", subjectId: "acc-vip", valueIndex: 1 }], // pinned = true
      rules: [],
    });
    // Wait for the SDK to pick up the new config — easiest tell is that the
    // pinned subject starts evaluating to true.
    await waitFor(async () => {
      const r = (await fetchJson(`${host.url}/?user=anyone&account=acc-vip`)) as {
        checkout: boolean;
      };
      return r.checkout === true;
    }, 5_000);

    const unpinned = (await fetchJson(`${host.url}/?user=anyone&account=acc-rando`)) as {
      checkout: boolean;
    };
    expect(unpinned.checkout).toBe(false);

    const userOnly = (await fetchJson(`${host.url}/?user=anyone`)) as {
      checkout: boolean;
    };
    expect(userOnly.checkout).toBe(false);
  });

  test("calling boolFlag on a JSON flag returns the default and logs WRONG_TYPE", async () => {
    await fetchJson(`${host.url}/debug/reset`);
    const r = (await fetchJson(`${host.url}/?user=alice&readPricingAsBool=1`)) as {
      pricingAsBool: boolean;
    };
    expect(r.pricingAsBool).toBe(false);

    const warn = (await fetchJson(`${host.url}/debug/last-warn`)) as {
      lastWarn: { msg: string; meta: { code?: string } } | null;
    };
    expect(warn.lastWarn?.msg).toMatch(/boolFlag\(pricing\) called on a json flag/);
    expect(warn.lastWarn?.meta?.code).toBe("WRONG_TYPE");
  });
});

async function fetchJson(url: string): Promise<unknown> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}
