import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { databaseUrl, redisUrl, streamTokenSecret } from "@ffp/e2e-stack";
import { spawnHost, type HostHandle } from "./helpers/host.ts";
import { spawnResolver, type ResolverHandle } from "./helpers/resolver.ts";
import { provisionStage, type IsolatedStage } from "./helpers/stack.ts";

const WORKSPACE_KEY = "e2e-node-restart-1";

describe("restart resilience: SDK survives a resolver outage", () => {
  let stage: IsolatedStage;
  let resolver: ResolverHandle;
  let host: HostHandle;

  beforeAll(async () => {
    stage = await provisionStage({ workspaceKey: WORKSPACE_KEY });
    await stage.seed.ensureBooleanFlag("new-checkout");
    await stage.seed.setFlagConfig("new-checkout", {
      enabled: true,
      disabledValueIndex: 0,
      defaultServe: { kind: "value", valueIndex: 1 }, // serves true
      pinned: [],
      rules: [],
    });

    resolver = await spawnResolver({ databaseUrl, redisUrl, streamTokenSecret });

    host = await spawnHost({
      resolverUrl: resolver.url,
      serverKey: stage.serverKey,
      env: {
        // Use polling-only so reconnect after the kill is bounded by the
        // poll interval. Streaming-mode SSE recovery is exercised by the
        // e2e-web harness; here we focus on the bounded-recovery contract.
        SDK_STREAMING: "false",
        SDK_POLL_MS: "1000",
      },
    });
  });

  afterAll(async () => {
    await host?.stop();
    await resolver?.stop();
  });

  test("resolver kill keeps cached values; restart → next change propagates", async () => {
    // Confirm initial state: cache populated from boot.
    const before = (await fetchJson(`${host.url}/?user=alice`)) as { checkout: boolean };
    expect(before.checkout).toBe(true);

    const port = resolver.port;
    await resolver.stop();

    // SDK keeps the snapshot in-memory; it won't crash when its next fetch
    // fails — the cached value continues serving while the resolver is gone.
    const cached = (await fetchJson(`${host.url}/?user=alice`)) as { checkout: boolean };
    expect(cached.checkout).toBe(true);

    // Bring the resolver back up on the same port so the SDK's existing
    // baseUrl resolves it without reconfiguration.
    resolver = await spawnResolver({
      databaseUrl,
      redisUrl,
      streamTokenSecret,
      port,
    });

    // Toggle through the shared admin-api → both resolvers receive the
    // pub/sub bump. With polling enabled (1s) the SDK picks up the new
    // ruleset on its next tick.
    await stage.seed.toggleFlag("new-checkout", false);
    await waitFor(async () => {
      const r = (await fetchJson(`${host.url}/?user=alice`)) as { checkout: boolean };
      return r.checkout === false;
    }, 10_000);
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
    try {
      if (await check()) return;
    } catch {
      /* keep polling */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}
