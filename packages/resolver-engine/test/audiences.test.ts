import { describe, expect, it } from "vitest";
import type {
  Audience,
  AudienceId,
  Flag,
  FlagStageConfig,
  MatchRule,
  Subject,
} from "@ffp/shared-types";
import { resolve } from "../src/resolve.js";
import { subjectInAudience } from "../src/clauses.js";

const stageId = "stg-1";

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

function cfg(rules: MatchRule[]): FlagStageConfig {
  return {
    flagId: "flag-1",
    stageId,
    enabled: true,
    disabledValueIndex: 0,
    defaultServe: { kind: "value", valueIndex: 0 },
    pinned: [],
    rules,
    version: 1,
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function audience(
  id: string,
  payload: {
    members?: Audience["perStage"][string]["members"];
    rules?: Audience["perStage"][string]["rules"];
  } = {},
): Audience {
  return {
    id,
    workspaceId: "ws-1",
    key: id,
    name: id,
    subjectType: "user",
    perStage: {
      [stageId]: {
        members: payload.members ?? [],
        rules: payload.rules ?? [],
      },
    },
  };
}

function indexedBy(list: Audience[]): Map<AudienceId, Audience> {
  return new Map(list.map((a) => [a.id, a]));
}

describe("audience membership (§9.4)", () => {
  it("included wins over no other signal", () => {
    const a = audience("a1", {
      members: [{ subjectType: "user", subjectId: "u-1", included: true }],
    });
    expect(subjectInAudience(a, { type: "user", id: "u-1" } as Subject, stageId)).toBe(true);
    expect(subjectInAudience(a, { type: "user", id: "u-2" } as Subject, stageId)).toBe(false);
  });

  it("excluded beats included on the same subject", () => {
    const a = audience("a1", {
      members: [
        { subjectType: "user", subjectId: "u-1", included: true },
        { subjectType: "user", subjectId: "u-1", included: false },
      ],
    });
    expect(subjectInAudience(a, { type: "user", id: "u-1" } as Subject, stageId)).toBe(false);
  });

  it("excluded beats rule match", () => {
    const a = audience("a1", {
      members: [{ subjectType: "user", subjectId: "u-1", included: false }],
      rules: [
        {
          id: "r",
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
        },
      ],
    });
    expect(subjectInAudience(a, { type: "user", id: "u-1", plan: "pro" } as Subject, stageId)).toBe(
      false,
    );
  });

  it("rule match makes subject a member when not excluded", () => {
    const a = audience("a1", {
      rules: [
        {
          id: "r",
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
        },
      ],
    });
    expect(subjectInAudience(a, { type: "user", id: "u-9", plan: "pro" } as Subject, stageId)).toBe(
      true,
    );
    expect(
      subjectInAudience(a, { type: "user", id: "u-9", plan: "free" } as Subject, stageId),
    ).toBe(false);
  });

  it("no membership when stage has no payload at all", () => {
    const a: Audience = {
      id: "a1",
      workspaceId: "ws-1",
      key: "a1",
      name: "a1",
      subjectType: "user",
      perStage: {},
    };
    expect(subjectInAudience(a, { type: "user", id: "u-1" } as Subject, stageId)).toBe(false);
  });
});

describe("audience clauses in flag rules", () => {
  it("inAudience: multiple audience ids OR-match within one clause", () => {
    const a1 = audience("a1", {
      members: [{ subjectType: "user", subjectId: "u-1", included: true }],
    });
    const a2 = audience("a2", {
      members: [{ subjectType: "user", subjectId: "u-2", included: true }],
    });
    const audiencesById = indexedBy([a1, a2]);

    const config = cfg([
      {
        id: "r",
        clauses: [{ kind: "audience", op: "inAudience", audienceIds: ["a1", "a2"] }],
        serve: { kind: "value", valueIndex: 1 },
      },
    ]);

    // u-1 is in a1 — clause matches.
    expect(
      resolve({
        flag: flag(),
        config,
        subject: { type: "user", id: "u-1" },
        audiencesById,
        stageId,
      }).value,
    ).toBe(true);
    // u-2 is in a2 — clause matches.
    expect(
      resolve({
        flag: flag(),
        config,
        subject: { type: "user", id: "u-2" },
        audiencesById,
        stageId,
      }).value,
    ).toBe(true);
    // u-3 is in neither — default false.
    expect(
      resolve({
        flag: flag(),
        config,
        subject: { type: "user", id: "u-3" },
        audiencesById,
        stageId,
      }).value,
    ).toBe(false);
  });

  it("two audience clauses on the same rule AND-match", () => {
    const a1 = audience("a1", {
      members: [
        { subjectType: "user", subjectId: "u-1", included: true },
        { subjectType: "user", subjectId: "u-2", included: true },
      ],
    });
    const a2 = audience("a2", {
      members: [{ subjectType: "user", subjectId: "u-2", included: true }],
    });
    const audiencesById = indexedBy([a1, a2]);

    const config = cfg([
      {
        id: "r",
        clauses: [
          { kind: "audience", op: "inAudience", audienceIds: ["a1"] },
          { kind: "audience", op: "inAudience", audienceIds: ["a2"] },
        ],
        serve: { kind: "value", valueIndex: 1 },
      },
    ]);

    // u-1 is in a1 only — not both — default false.
    expect(
      resolve({
        flag: flag(),
        config,
        subject: { type: "user", id: "u-1" },
        audiencesById,
        stageId,
      }).value,
    ).toBe(false);
    // u-2 is in both — rule fires.
    expect(
      resolve({
        flag: flag(),
        config,
        subject: { type: "user", id: "u-2" },
        audiencesById,
        stageId,
      }).value,
    ).toBe(true);
  });

  it("notInAudience matches when the subject is in none of the listed audiences", () => {
    const a1 = audience("a1", {
      members: [{ subjectType: "user", subjectId: "u-1", included: true }],
    });
    const audiencesById = indexedBy([a1]);

    const config = cfg([
      {
        id: "r",
        clauses: [{ kind: "audience", op: "notInAudience", audienceIds: ["a1"] }],
        serve: { kind: "value", valueIndex: 1 },
      },
    ]);
    expect(
      resolve({
        flag: flag(),
        config,
        subject: { type: "user", id: "u-1" },
        audiencesById,
        stageId,
      }).value,
    ).toBe(false);
    expect(
      resolve({
        flag: flag(),
        config,
        subject: { type: "user", id: "u-9" },
        audiencesById,
        stageId,
      }).value,
    ).toBe(true);
  });

  it("audience clause referencing an unknown id never matches (no throw)", () => {
    const audiencesById = indexedBy([]);
    const config = cfg([
      {
        id: "r",
        clauses: [{ kind: "audience", op: "inAudience", audienceIds: ["missing"] }],
        serve: { kind: "value", valueIndex: 1 },
      },
    ]);
    const r = resolve({
      flag: flag(),
      config,
      subject: { type: "user", id: "u-1" },
      audiencesById,
      stageId,
    });
    expect(r.reason).toEqual({ kind: "default" });
  });
});
