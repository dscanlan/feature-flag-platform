import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { databaseUrl, redisUrl, streamTokenSecret } from "@ffp/e2e-stack";
import { spawnHost, type HostHandle } from "./helpers/host.ts";
import { spawnResolver, type ResolverHandle } from "./helpers/resolver.ts";
import { provisionStage, type IsolatedStage } from "./helpers/stack.ts";

const WORKSPACE_KEY = "e2e-node-rate-1";

interface DebugError {
  lastError: { status?: number; err?: unknown } | null;
}

describe("rate limit surfaces through the SDK error path", () => {
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

    // A resolver process dedicated to this file. burst=2 leaves just enough
    // room for the SDK's first /sdk/flags + a couple SSE retries before the
    // bucket empties; concurrent direct fetches in the test then guarantee
    // the bucket stays empty long enough for the SDK's next poll to 429.
    resolver = await spawnResolver({
      databaseUrl,
      redisUrl,
      streamTokenSecret,
      rateLimitRps: 1,
      rateLimitBurst: 2,
    });

    host = await spawnHost({
      resolverUrl: resolver.url,
      serverKey: stage.serverKey,
      env: {
        SDK_STREAMING: "false",
        SDK_POLL_MS: "1000",
      },
    });
  });

  afterAll(async () => {
    await host?.stop();
    await resolver?.stop();
  });

  test("burst exhaustion → 429 → cached value still served", async () => {
    // Confirm initial state: cached fetch from boot returns the configured
    // value before we drain the bucket.
    const initial = (await fetchJson(`${host.url}/?user=alice`)) as { checkout: boolean };
    expect(initial.checkout).toBe(true);

    // Continuously drain the bucket via direct /sdk/flags hits with the
    // same server key the SDK is using. We keep this firing in the
    // background so the bucket stays empty long enough for the SDK's next
    // poll (every ~1s) to land on a 429.
    let draining = true;
    const drainLoop = (async () => {
      while (draining) {
        await Promise.all(
          Array.from({ length: 5 }, () =>
            fetch(`${resolver.url}/sdk/flags`, {
              headers: { authorization: `Bearer ${stage.serverKey}` },
            }).catch(() => undefined),
          ),
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    })();

    try {
      await waitFor(async () => {
        const r = (await fetchJson(`${host.url}/debug/last-error`)) as DebugError;
        return r.lastError?.status === 429;
      }, 10_000);

      // Cached value still serves correctly even while the bucket is empty.
      const cached = (await fetchJson(`${host.url}/?user=bob`)) as { checkout: boolean };
      expect(cached.checkout).toBe(true);
    } finally {
      draining = false;
      await drainLoop;
    }
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
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}
