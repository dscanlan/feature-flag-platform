import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { ResolverResolveResponse } from "@ffp/shared-types";
import { signSubjectToken } from "../../resolver/src/tokens.ts";
import { provisionStage, type IsolatedStage } from "./helpers/stack.ts";

const WORKSPACE_KEY = "e2e-node-subject-token-1";

describe("Node backend mints sjt- tokens for browser callers", () => {
  let stage: IsolatedStage;

  beforeAll(async () => {
    stage = await provisionStage({ workspaceKey: WORKSPACE_KEY });
    await stage.seed.ensureBooleanFlag("new-checkout");
    await stage.seed.setFlagConfig("new-checkout", {
      enabled: true,
      disabledValueIndex: 0,
      defaultServe: { kind: "value", valueIndex: 0 }, // default = false
      pinned: [{ subjectType: "user", subjectId: "user-pinned", valueIndex: 1 }], // pinned = true
      rules: [],
    });
  });

  afterAll(async () => {
    /* nothing to tear down — no host process for this file. */
  });

  test("a server-signed sjt- token resolves the pinned value via /sdk/resolve", async () => {
    // The resolver discovers new stages via Redis pub/sub on the first
    // setFlagConfig — which beforeAll already triggered. But it's
    // asynchronous, so wait until the stage's public key starts working
    // before we assert on token verification.
    await waitForStageLoaded(stage.resolverUrl, stage.publicKey);

    expect(stage.subjectSigningSecret).not.toBe("");
    const token = signSubjectToken(stage.subjectSigningSecret, {
      sub: { type: "user", id: "user-pinned" },
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    const r = await postResolve(stage.resolverUrl, stage.publicKey, { subjectToken: token });
    if (r.status !== 200) {
      throw new Error(`expected 200 got ${r.status}: ${await r.text()}`);
    }
    const body = (await r.json()) as ResolverResolveResponse;
    expect(body.results["new-checkout"]?.value).toBe(true);
    expect(body.results["new-checkout"]?.reason.kind).toBe("pinned");
  });

  test("rotating the signing secret invalidates tokens minted with the old one", async () => {
    const oldSecret = stage.subjectSigningSecret;
    const oldToken = signSubjectToken(oldSecret, {
      sub: { type: "user", id: "user-pinned" },
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    // Sanity: the old token works against the current secret.
    const before = await postResolve(stage.resolverUrl, stage.publicKey, {
      subjectToken: oldToken,
    });
    expect(before.status).toBe(200);

    // Rotate the per-stage subject signing secret. The resolver's in-memory
    // store needs the bump to refresh; we wait for it by polling until the
    // old token starts failing.
    const { subjectSigningSecret: newSecret } = await stage.seed.rotateSubjectSigningSecret();
    expect(newSecret).not.toBe(oldSecret);

    await waitFor(async () => {
      const r = await postResolve(stage.resolverUrl, stage.publicKey, {
        subjectToken: oldToken,
      });
      // Drain the body so the connection releases.
      await r.text();
      return r.status === 401;
    }, 5_000);

    const newToken = signSubjectToken(newSecret, {
      sub: { type: "user", id: "user-pinned" },
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    const r = await postResolve(stage.resolverUrl, stage.publicKey, {
      subjectToken: newToken,
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as ResolverResolveResponse;
    expect(body.results["new-checkout"]?.value).toBe(true);
  });
});

function postResolve(
  resolverUrl: string,
  publicKey: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${resolverUrl}/sdk/resolve`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${publicKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function waitForStageLoaded(
  resolverUrl: string,
  publicKey: string,
  timeoutMs = 5_000,
): Promise<void> {
  const started = Date.now();
  let lastStatus = 0;
  while (Date.now() - started < timeoutMs) {
    const r = await fetch(`${resolverUrl}/sdk/resolve`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${publicKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ subject: { type: "user", id: "warmup" } }),
    });
    await r.text();
    if (r.status === 200) return;
    lastStatus = r.status;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`stage not loaded by resolver within ${timeoutMs}ms (last=${lastStatus})`);
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}
