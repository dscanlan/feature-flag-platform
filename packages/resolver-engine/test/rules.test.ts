import { describe, expect, it } from "vitest";
import type { Audience, AudienceId, Flag, FlagStageConfig, Subject } from "@ffp/shared-types";
import { resolve } from "../src/resolve.js";

const stageId = "stg-1";
const audiencesById = new Map<AudienceId, Audience>();

function flag(): Flag {
  return {
    id: "flag-1",
    workspaceId: "ws-1",
    key: "f",
    name: "f",
    kind: "boolean",
    values: [{ value: false }, { value: true }],
    tags: [],
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function cfg(rules: FlagStageConfig["rules"]): FlagStageConfig {
  return {
    flagId: "flag-1",
    stageId,
    enabled: true,
    disabledValueIndex: 0,
    defaultServe: { kind: "value", valueIndex: 0 }, // default false
    pinned: [],
    rules,
    version: 1,
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("rule walking (§9.1 step 3)", () => {
  it("first matching rule wins", () => {
    const r = resolve({
      flag: flag(),
      config: cfg([
        {
          id: "r1",
          clauses: [
            {
              kind: "attribute",
              subjectType: "user",
              attribute: "plan",
              op: "in",
              values: ["pro", "enterprise"],
              negate: false,
            },
          ],
          serve: { kind: "value", valueIndex: 1 },
        },
        {
          id: "r2",
          clauses: [],
          serve: { kind: "value", valueIndex: 0 },
        },
      ]),
      subject: { type: "user", id: "u", plan: "pro" } as Subject,
      audiencesById,
      stageId,
    });
    expect(r.value).toBe(true);
    expect(r.reason).toEqual({ kind: "rule", ruleId: "r1" });
  });

  it("matches rule on composite sub-subject", () => {
    const r = resolve({
      flag: flag(),
      config: cfg([
        {
          id: "tier-rule",
          clauses: [
            {
              kind: "attribute",
              subjectType: "account",
              attribute: "tier",
              op: "in",
              values: ["enterprise"],
              negate: false,
            },
          ],
          serve: { kind: "value", valueIndex: 1 },
        },
      ]),
      subject: {
        type: "composite",
        subjects: {
          user: { id: "u", plan: "free" },
          account: { id: "acc-1", tier: "enterprise" },
        },
      },
      audiencesById,
      stageId,
    });
    expect(r.value).toBe(true);
    expect(r.reason).toEqual({ kind: "rule", ruleId: "tier-rule" });
  });

  it("falls through to default if no rule matches", () => {
    const r = resolve({
      flag: flag(),
      config: cfg([
        {
          id: "r1",
          clauses: [
            {
              kind: "attribute",
              subjectType: "user",
              attribute: "plan",
              op: "in",
              values: ["pro"],
              negate: false,
            },
          ],
          serve: { kind: "value", valueIndex: 1 },
        },
      ]),
      subject: { type: "user", id: "u", plan: "free" } as Subject,
      audiencesById,
      stageId,
    });
    expect(r.value).toBe(false);
    expect(r.reason).toEqual({ kind: "default" });
  });

  it("AND across clauses within a rule", () => {
    const subject: Subject = { type: "user", id: "u", plan: "pro", country: "GB" } as Subject;
    const ruleConfig = cfg([
      {
        id: "r1",
        clauses: [
          {
            kind: "attribute",
            subjectType: "user",
            attribute: "plan",
            op: "in",
            values: ["pro"],
            negate: false,
          },
          {
            kind: "attribute",
            subjectType: "user",
            attribute: "country",
            op: "in",
            values: ["GB"],
            negate: false,
          },
        ],
        serve: { kind: "value", valueIndex: 1 },
      },
    ]);
    expect(
      resolve({ flag: flag(), config: ruleConfig, subject, audiencesById, stageId }).value,
    ).toBe(true);
    // Flip one clause attr → no match → default false.
    expect(
      resolve({
        flag: flag(),
        config: ruleConfig,
        subject: { ...subject, country: "US" } as Subject,
        audiencesById,
        stageId,
      }).value,
    ).toBe(false);
  });

  it("negate flips the clause result; missing sub-subject still no-match", () => {
    // Rule fires for users NOT on the 'free' plan.
    const ruleConfig = cfg([
      {
        id: "r1",
        clauses: [
          {
            kind: "attribute",
            subjectType: "user",
            attribute: "plan",
            op: "in",
            values: ["free"],
            negate: true,
          },
        ],
        serve: { kind: "value", valueIndex: 1 },
      },
    ]);
    expect(
      resolve({
        flag: flag(),
        config: ruleConfig,
        subject: { type: "user", id: "u", plan: "pro" } as Subject,
        audiencesById,
        stageId,
      }).value,
    ).toBe(true);
    // Sub-subject of the wrong kind: clause does not match (regardless of negate).
    expect(
      resolve({
        flag: flag(),
        config: ruleConfig,
        subject: { type: "account", id: "a" } as Subject,
        audiencesById,
        stageId,
      }).reason.kind,
    ).toBe("default");
  });
});
