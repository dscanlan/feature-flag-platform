import { describe, expect, it } from "vitest";
import type { Flag, FlagStageConfig, Subject } from "@ffp/shared-types";
import { resolve } from "../src/resolve.js";

const audiences = new Map();
const stageId = "stage-1";

function boolFlag(overrides: Partial<Flag> = {}): Flag {
  return {
    id: "flag-1",
    workspaceId: "ws-1",
    key: "new-checkout",
    name: "new checkout",
    kind: "boolean",
    values: [{ value: false }, { value: true }],
    tags: [],
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function config(overrides: Partial<FlagStageConfig> = {}): FlagStageConfig {
  return {
    flagId: "flag-1",
    stageId,
    enabled: true,
    disabledValueIndex: 0,
    defaultServe: { kind: "value", valueIndex: 1 },
    pinned: [],
    rules: [],
    version: 1,
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const userSubject: Subject = { type: "user", id: "user-123" };

describe("resolve — disabled / pinned / default", () => {
  it("returns disabled value when config.enabled is false", () => {
    const r = resolve({
      flag: boolFlag(),
      config: config({ enabled: false, disabledValueIndex: 0 }),
      subject: userSubject,
      audiencesById: audiences,
      stageId,
    });
    expect(r.value).toBe(false);
    expect(r.valueIndex).toBe(0);
    expect(r.reason).toEqual({ kind: "disabled" });
  });

  it("uses pinned value before default", () => {
    const r = resolve({
      flag: boolFlag(),
      config: config({
        defaultServe: { kind: "value", valueIndex: 1 },
        pinned: [{ subjectType: "user", subjectId: "user-123", valueIndex: 0 }],
      }),
      subject: userSubject,
      audiencesById: audiences,
      stageId,
    });
    expect(r.value).toBe(false);
    expect(r.reason).toEqual({ kind: "pinned" });
  });

  it("falls through to default when no pin matches", () => {
    const r = resolve({
      flag: boolFlag(),
      config: config({
        pinned: [{ subjectType: "user", subjectId: "someone-else", valueIndex: 0 }],
      }),
      subject: userSubject,
      audiencesById: audiences,
      stageId,
    });
    expect(r.value).toBe(true);
    expect(r.reason).toEqual({ kind: "default" });
  });

  it("matches a pinned subject inside a composite", () => {
    const r = resolve({
      flag: boolFlag(),
      config: config({
        pinned: [{ subjectType: "user", subjectId: "user-7", valueIndex: 0 }],
      }),
      subject: {
        type: "composite",
        subjects: {
          user: { id: "user-7" },
          account: { id: "acc-1" },
        },
      },
      audiencesById: audiences,
      stageId,
    });
    expect(r.value).toBe(false);
    expect(r.reason).toEqual({ kind: "pinned" });
  });

  it("does not pin across different subject types", () => {
    const r = resolve({
      flag: boolFlag(),
      config: config({
        pinned: [{ subjectType: "account", subjectId: "user-7", valueIndex: 0 }],
      }),
      subject: { type: "user", id: "user-7" },
      audiencesById: audiences,
      stageId,
    });
    expect(r.reason).toEqual({ kind: "default" });
  });

  it("errors when defaultServe targets an out-of-range value index", () => {
    const r = resolve({
      flag: boolFlag(),
      config: config({ defaultServe: { kind: "value", valueIndex: 99 } }),
      subject: userSubject,
      audiencesById: audiences,
      stageId,
    });
    expect(r.reason).toEqual({ kind: "error", code: "WRONG_TYPE" });
    expect(r.value).toBeNull();
  });

  it("serves from a percentage split when defaultServe is a split", () => {
    const r = resolve({
      flag: boolFlag(),
      config: config({
        defaultServe: {
          kind: "split",
          splitKeySubjectType: "user",
          buckets: [
            { valueIndex: 0, weight: 50000 },
            { valueIndex: 1, weight: 50000 },
          ],
        },
      }),
      subject: userSubject,
      audiencesById: audiences,
      stageId,
    });
    expect(r.reason).toEqual({ kind: "default" });
    expect([0, 1]).toContain(r.valueIndex);
    // Same subject + same flag = same bucket every time.
    const r2 = resolve({
      flag: boolFlag(),
      config: config({
        defaultServe: {
          kind: "split",
          splitKeySubjectType: "user",
          buckets: [
            { valueIndex: 0, weight: 50000 },
            { valueIndex: 1, weight: 50000 },
          ],
        },
      }),
      subject: userSubject,
      audiencesById: audiences,
      stageId,
    });
    expect(r2.valueIndex).toBe(r.valueIndex);
  });

  it("split with a missing key kind errors as MALFORMED_SUBJECT", () => {
    const r = resolve({
      flag: boolFlag(),
      config: config({
        defaultServe: {
          kind: "split",
          splitKeySubjectType: "account",
          buckets: [{ valueIndex: 0, weight: 100000 }],
        },
      }),
      subject: { type: "user", id: "u" },
      audiencesById: audiences,
      stageId,
    });
    expect(r.reason).toEqual({ kind: "error", code: "MALFORMED_SUBJECT" });
  });
});
