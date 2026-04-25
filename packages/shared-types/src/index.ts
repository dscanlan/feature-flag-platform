// Canonical shared types — every package imports from here.

// --- ids ----------------------------------------------------------------

export type WorkspaceId = string;
export type StageId = string;
export type FlagId = string;
export type AudienceId = string;
export type SubjectTypeId = string;
export type Iso8601 = string;

// --- subjects -----------------------------------------------------------

export interface SingleSubject {
  type: string;
  id: string;
  name?: string;
  [attribute: string]: unknown;
}

export interface CompositeSubject {
  type: "composite";
  subjects: Record<string, Omit<SingleSubject, "type">>;
}

export type Subject = SingleSubject | CompositeSubject;

// --- workspaces / stages / subject types --------------------------------

export interface Workspace {
  id: WorkspaceId;
  key: string;
  name: string;
  createdAt: Iso8601;
}

export interface Stage {
  id: StageId;
  workspaceId: WorkspaceId;
  key: string;
  name: string;
  serverKey: string;
  publicKey: string;
  critical: boolean;
  version: number;
  /** Per-stage CORS allow-list. `["*"]` means any origin. */
  corsOrigins: string[];
  /**
   * HMAC secret used by the host application's backend to sign `subjectToken`s.
   * Returned on stage create and on explicit reset; OMITTED from list/get
   * responses to prevent casual leakage.
   */
  subjectSigningSecret?: string;
  createdAt: Iso8601;
}

/** A persisted subject snapshot, as upserted by the resolver. */
export interface PersistedSubject {
  id: string;
  workspaceId: WorkspaceId;
  stageId: StageId;
  subjectType: string;
  subjectId: string;
  name: string | null;
  attributes: Record<string, unknown>;
  firstSeenAt: Iso8601;
  lastSeenAt: Iso8601;
  lastSeenVia: string | null;
}

export interface AuditLogEntry {
  id: string;
  workspaceId: WorkspaceId | null;
  actorUserId: string | null;
  action: string;
  target: string;
  before: unknown;
  after: unknown;
  at: Iso8601;
}

export interface SubjectType {
  id: SubjectTypeId;
  workspaceId: WorkspaceId;
  key: string;
  name: string;
  isDefaultSplitKey: boolean;
}

// --- flags --------------------------------------------------------------

export type FlagKind = "boolean" | "json";

export interface FlagValue {
  value: boolean | unknown;
  name?: string;
  description?: string;
}

export interface Flag {
  id: FlagId;
  workspaceId: WorkspaceId;
  key: string;
  name: string;
  description?: string;
  kind: FlagKind;
  values: FlagValue[];
  tags: string[];
  createdAt: Iso8601;
}

// --- per-stage config ---------------------------------------------------

export type ServeSpec =
  | { kind: "value"; valueIndex: number }
  | {
      kind: "split";
      splitKeySubjectType: string;
      buckets: Array<{ valueIndex: number; weight: number }>;
    };

export type AttributeOp =
  | "in"
  | "notIn"
  | "startsWith"
  | "endsWith"
  | "contains"
  | "matches"
  | "lessThan"
  | "lessThanOrEqual"
  | "greaterThan"
  | "greaterThanOrEqual"
  | "before"
  | "after"
  | "semVerEqual"
  | "semVerLessThan"
  | "semVerGreaterThan";

export interface AttributeClause {
  kind: "attribute";
  subjectType: string;
  attribute: string;
  op: AttributeOp;
  values: Array<string | number | boolean>;
  negate: boolean;
}

export interface AudienceClause {
  kind: "audience";
  op: "inAudience" | "notInAudience";
  audienceIds: AudienceId[];
}

export type Clause = AttributeClause | AudienceClause;

export interface MatchRule {
  id: string;
  description?: string;
  clauses: Clause[];
  serve: ServeSpec;
}

export interface PinnedSubject {
  subjectType: string;
  subjectId: string;
  valueIndex: number;
}

export interface FlagStageConfig {
  flagId: FlagId;
  stageId: StageId;
  enabled: boolean;
  disabledValueIndex: number;
  defaultServe: ServeSpec;
  pinned: PinnedSubject[];
  rules: MatchRule[];
  version: number;
  updatedAt: Iso8601;
}

// --- audiences ----------------------------------------------------------

export interface AudienceMember {
  subjectType: string;
  subjectId: string;
  included: boolean;
}

export interface AudienceRule {
  id: string;
  clauses: Clause[];
}

export interface Audience {
  id: AudienceId;
  workspaceId: WorkspaceId;
  key: string;
  name: string;
  subjectType: string;
  perStage: Record<StageId, { members: AudienceMember[]; rules: AudienceRule[] }>;
}

// --- resolver outputs ---------------------------------------------------

export type ResolutionReason =
  | { kind: "disabled" }
  | { kind: "pinned" }
  | { kind: "rule"; ruleId: string }
  | { kind: "default" }
  | {
      kind: "error";
      code: "FLAG_NOT_FOUND" | "WRONG_TYPE" | "MALFORMED_SUBJECT" | "BAD_CONFIG";
    };

export interface Resolution<V = unknown> {
  flagKey: string;
  value: V;
  valueIndex: number | null;
  reason: ResolutionReason;
}

// --- API envelopes ------------------------------------------------------

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface ResolverFlagsResponse {
  stage: { id: StageId; key: string; version: number };
  flags: Flag[];
  configs: FlagStageConfig[];
  audiences: Audience[];
  subjectTypes: SubjectType[];
}

export interface ResolverResolveResponse {
  stage: { id: StageId; key: string; version: number };
  /**
   * Short-lived `sst-` token bound to (stage, subject, expiry) — clients
   * present this on /sdk/stream. Optional for back-compat with pre-Phase-9
   * resolvers; when absent, callers can fall back to their public key.
   */
  streamToken?: string;
  /** Token expiry, seconds since epoch. Present iff streamToken is. */
  streamTokenExp?: number;
  results: Record<
    string,
    { value: unknown; valueIndex: number | null; reason: ResolutionReason; kind: FlagKind }
  >;
}
