import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { PersistedSubject } from "@ffp/shared-types";
import { spawnHost, type HostHandle } from "./helpers/host.ts";
import { provisionStage, type IsolatedStage } from "./helpers/stack.ts";

const WORKSPACE_KEY = "e2e-node-persistence-1";

interface SubjectsListResponse {
  items: PersistedSubject[];
  nextCursor: string | null;
}

describe("subject persistence via /sdk/resolve", () => {
  let stage: IsolatedStage;
  let host: HostHandle;

  beforeAll(async () => {
    stage = await provisionStage({ workspaceKey: WORKSPACE_KEY });
    // We need at least one flag so /sdk/resolve has something to evaluate;
    // its only side-effect we care about is the subject upsert.
    await stage.seed.ensureBooleanFlag("noop");
    await stage.seed.setFlagConfig("noop", {
      enabled: false,
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

  test("five distinct user subjects show up via the admin API in last_seen DESC order", async () => {
    const ids = ["alice", "bob", "carol", "dave", "erin"];
    for (const id of ids) {
      const r = await fetch(`${host.url}/persist?user=${id}`);
      expect(r.ok).toBe(true);
    }

    const subjects = await waitForSubjects(stage, "user", ids.length);
    const seen = subjects.map((s) => s.subjectId);
    for (const id of ids) expect(seen).toContain(id);

    // last_seen_at DESC: erin (last persisted) should sort before alice (first).
    const erinIdx = seen.indexOf("erin");
    const aliceIdx = seen.indexOf("alice");
    expect(erinIdx).toBeLessThan(aliceIdx);
  });

  test("composite subject expands to one row per typed sub-subject", async () => {
    const r = await fetch(`${host.url}/persist?user=cu-1&account=ca-1&device=cd-1`);
    expect(r.ok).toBe(true);

    await waitForSubject(stage, "user", "cu-1");
    await waitForSubject(stage, "account", "ca-1");
    await waitForSubject(stage, "device", "cd-1");
  });

  test("re-resolving the same subject replaces (not merges) its attributes", async () => {
    const id = "replace-me";
    const first = await fetch(
      `${host.url}/persist?user=${id}&attrs=${encodeURIComponent(
        JSON.stringify({ plan: "pro", seats: 7 }),
      )}`,
    );
    expect(first.ok).toBe(true);
    await waitForSubjectAttrs(stage, "user", id, (a) => a.plan === "pro" && a.seats === 7);

    const second = await fetch(
      `${host.url}/persist?user=${id}&attrs=${encodeURIComponent(
        JSON.stringify({ plan: "enterprise" }),
      )}`,
    );
    expect(second.ok).toBe(true);
    await waitForSubjectAttrs(
      stage,
      "user",
      id,
      (a) => a.plan === "enterprise" && a.seats === undefined,
    );
  });
});

async function listSubjects(
  stage: IsolatedStage,
  subjectType: string,
): Promise<PersistedSubject[]> {
  const cookie = await stage.seed.login();
  const url =
    `${stage.adminApiUrl}/api/v1/workspaces/${stage.workspace.key}` +
    `/stages/${stage.stage.key}/subjects?subjectType=${subjectType}&limit=100`;
  const r = await fetch(url, { headers: { cookie } });
  if (!r.ok) throw new Error(`list subjects -> ${r.status}`);
  const body = (await r.json()) as SubjectsListResponse;
  return body.items;
}

async function waitForSubjects(
  stage: IsolatedStage,
  subjectType: string,
  minCount: number,
  timeoutMs = 5_000,
): Promise<PersistedSubject[]> {
  const started = Date.now();
  let last: PersistedSubject[] = [];
  while (Date.now() - started < timeoutMs) {
    last = await listSubjects(stage, subjectType);
    if (last.length >= minCount) return last;
    await sleep(100);
  }
  throw new Error(`expected at least ${minCount} ${subjectType} subjects, got ${last.length}`);
}

async function waitForSubject(
  stage: IsolatedStage,
  subjectType: string,
  subjectId: string,
  timeoutMs = 5_000,
): Promise<PersistedSubject> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const subjects = await listSubjects(stage, subjectType);
    const found = subjects.find((s) => s.subjectId === subjectId);
    if (found) return found;
    await sleep(100);
  }
  throw new Error(`subject ${subjectType}:${subjectId} did not appear within ${timeoutMs}ms`);
}

async function waitForSubjectAttrs(
  stage: IsolatedStage,
  subjectType: string,
  subjectId: string,
  predicate: (attrs: Record<string, unknown>) => boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const found = await waitForSubject(stage, subjectType, subjectId, 500);
      if (predicate(found.attributes)) return;
    } catch {
      /* keep polling */
    }
    await sleep(100);
  }
  throw new Error(
    `subject ${subjectType}:${subjectId} did not match predicate within ${timeoutMs}ms`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
