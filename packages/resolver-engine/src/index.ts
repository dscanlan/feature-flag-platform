export { resolve } from "./resolve.js";
export type { ResolveArgs } from "./resolve.js";
export { iterSubjects, subjectOfType } from "./subject.js";
export { bucket, pickBucket } from "./bucket.js";
export { applyOp } from "./operators.js";
export { allClausesMatch, clauseMatches, subjectInAudience, type ClauseCtx } from "./clauses.js";

export const RESOLVER_ENGINE_VERSION = "0.2.0";
