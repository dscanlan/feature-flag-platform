import type {
  Audience,
  AudienceId,
  Flag,
  FlagStageConfig,
  Resolution,
  ResolutionReason,
  ServeSpec,
  StageId,
  Subject,
  SubjectType,
} from "@ffp/shared-types";
import { allClausesMatch, type ClauseCtx } from "./clauses.js";
import { bucket, pickBucket } from "./bucket.js";
import { iterSubjects, subjectOfType } from "./subject.js";

export interface ResolveArgs {
  flag: Flag;
  config: FlagStageConfig;
  subject: Subject;
  audiencesById: Map<AudienceId, Audience>;
  stageId: StageId;
  /**
   * Workspace-level subject types. Used to find the default split key when a
   * percentage split doesn't specify one.
   */
  subjectTypes?: SubjectType[];
}

/**
 * Implements the full §9.1 walk: disabled, pinned, rules, default.
 */
export function resolve(args: ResolveArgs): Resolution {
  const { flag, config, subject, audiencesById, stageId, subjectTypes = [] } = args;

  if (!config.enabled) {
    return materialize(flag, config.disabledValueIndex, { kind: "disabled" });
  }

  for (const sub of iterSubjects(subject)) {
    for (const pin of config.pinned) {
      if (pin.subjectType === sub.type && pin.subjectId === sub.id) {
        return materialize(flag, pin.valueIndex, { kind: "pinned" });
      }
    }
  }

  const ctx: ClauseCtx = { audiencesById, stageId, regexCache: new Map() };
  for (const rule of config.rules) {
    if (allClausesMatch(rule.clauses, subject, ctx)) {
      return serve(flag, rule.serve, { kind: "rule", ruleId: rule.id }, subject, subjectTypes);
    }
  }

  return serve(flag, config.defaultServe, { kind: "default" }, subject, subjectTypes);
}

function serve(
  flag: Flag,
  spec: ServeSpec,
  reason: ResolutionReason,
  subject: Subject,
  subjectTypes: SubjectType[],
): Resolution {
  if (spec.kind === "value") {
    return materialize(flag, spec.valueIndex, reason);
  }
  // split
  const splitType =
    spec.splitKeySubjectType || subjectTypes.find((t) => t.isDefaultSplitKey)?.key || null;
  if (!splitType) return errorResolution(flag, "MALFORMED_SUBJECT");
  const sub = subjectOfType(subject, splitType);
  if (!sub) return errorResolution(flag, "MALFORMED_SUBJECT");

  const b = bucket(flag.key, flag.id, sub.id);
  const idx = pickBucket(
    b,
    spec.buckets.map((bk) => bk.weight),
  );
  if (idx === null) return errorResolution(flag, "BAD_CONFIG");
  const chosen = spec.buckets[idx]!;
  return materialize(flag, chosen.valueIndex, reason);
}

function materialize(flag: Flag, valueIndex: number, reason: ResolutionReason): Resolution {
  const entry = flag.values[valueIndex];
  if (!entry) return errorResolution(flag, "WRONG_TYPE");
  return { flagKey: flag.key, value: entry.value, valueIndex, reason };
}

function errorResolution(
  flag: Flag,
  code: "FLAG_NOT_FOUND" | "WRONG_TYPE" | "MALFORMED_SUBJECT" | "BAD_CONFIG",
): Resolution {
  return {
    flagKey: flag.key,
    value: null,
    valueIndex: null,
    reason: { kind: "error", code },
  };
}
