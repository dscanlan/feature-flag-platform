import type {
  Audience,
  AudienceClause,
  AudienceId,
  AttributeClause,
  AudienceMember,
  Clause,
  StageId,
  Subject,
} from "@ffp/shared-types";
import { applyOp } from "./operators.js";
import { subjectOfType } from "./subject.js";

export interface ClauseCtx {
  audiencesById: Map<AudienceId, Audience>;
  stageId: StageId;
  /** Per-evaluation regex cache keyed by pattern string. */
  regexCache: Map<string, RegExp>;
}

/** All clauses must match (AND). Empty clause list = always match. */
export function allClausesMatch(clauses: Clause[], subject: Subject, ctx: ClauseCtx): boolean {
  for (const c of clauses) {
    if (!clauseMatches(c, subject, ctx)) return false;
  }
  return true;
}

export function clauseMatches(clause: Clause, subject: Subject, ctx: ClauseCtx): boolean {
  return clause.kind === "attribute"
    ? attributeClauseMatches(clause, subject, ctx)
    : audienceClauseMatches(clause, subject, ctx);
}

function attributeClauseMatches(
  clause: AttributeClause,
  subject: Subject,
  ctx: ClauseCtx,
): boolean {
  const sub = subjectOfType(subject, clause.subjectType);
  // Per AGENT.md §9.2: missing sub-subject ⇒ no match, regardless of negate.
  if (!sub) return false;
  const actual = clause.attribute === "key" ? sub.id : sub[clause.attribute];
  const matched = applyOp(clause.op, actual, clause.values, ctx.regexCache);
  return clause.negate ? !matched : matched;
}

function audienceClauseMatches(clause: AudienceClause, subject: Subject, ctx: ClauseCtx): boolean {
  const memberOfAny = clause.audienceIds.some((id) => {
    const aud = ctx.audiencesById.get(id);
    return aud ? subjectInAudience(aud, subject, ctx.stageId) : false;
  });
  return clause.op === "inAudience" ? memberOfAny : !memberOfAny;
}

/**
 * AGENT.md §9.4 audience membership precedence: explicit excluded > explicit
 * included > rule match > default false.
 */
export function subjectInAudience(audience: Audience, subject: Subject, stageId: StageId): boolean {
  const payload = audience.perStage[stageId];
  if (!payload) return false;
  const sub = subjectOfType(subject, audience.subjectType);
  if (!sub) return false;

  let included = false;
  for (const m of payload.members as AudienceMember[]) {
    if (m.subjectType !== audience.subjectType || m.subjectId !== sub.id) continue;
    if (!m.included) return false;
    included = true;
  }
  if (included) return true;

  const ctx: ClauseCtx = {
    audiencesById: new Map([[audience.id, audience]]),
    stageId,
    regexCache: new Map(),
  };
  for (const r of payload.rules) {
    if (allClausesMatch(r.clauses, subject, ctx)) return true;
  }
  return false;
}
