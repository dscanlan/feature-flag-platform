import type {
  Flag,
  FlagStageConfig,
  FlagValue,
  PinnedSubject,
  ServeSpec,
  Stage,
  Workspace,
} from "@ffp/shared-types";

export interface WorkspaceRow {
  id: string;
  key: string;
  name: string;
  created_at: Date;
}
export const toWorkspace = (r: WorkspaceRow): Workspace => ({
  id: r.id,
  key: r.key,
  name: r.name,
  createdAt: r.created_at.toISOString(),
});

export interface StageRow {
  id: string;
  workspace_id: string;
  key: string;
  name: string;
  server_key: string;
  public_key: string;
  critical: boolean;
  version: string;
  cors_origins: string[];
  subject_signing_secret: string;
  created_at: Date;
}
/**
 * `revealSecret` controls whether `subjectSigningSecret` is included in the
 * returned `Stage`. Only set this true on create and on explicit reset —
 * everywhere else (list, get) the secret stays in Postgres.
 */
export const toStage = (r: StageRow, revealSecret = false): Stage => ({
  id: r.id,
  workspaceId: r.workspace_id,
  key: r.key,
  name: r.name,
  serverKey: r.server_key,
  publicKey: r.public_key,
  critical: r.critical,
  version: Number(r.version),
  corsOrigins: r.cors_origins,
  subjectSigningSecret: revealSecret ? r.subject_signing_secret : undefined,
  createdAt: r.created_at.toISOString(),
});

export interface FlagRow {
  id: string;
  workspace_id: string;
  key: string;
  name: string;
  description: string | null;
  kind: "boolean" | "json";
  values: FlagValue[];
  tags: string[];
  created_at: Date;
}
export const toFlag = (r: FlagRow): Flag => ({
  id: r.id,
  workspaceId: r.workspace_id,
  key: r.key,
  name: r.name,
  description: r.description ?? undefined,
  kind: r.kind,
  values: r.values,
  tags: r.tags,
  createdAt: r.created_at.toISOString(),
});

export interface FlagStageConfigRow {
  flag_id: string;
  stage_id: string;
  enabled: boolean;
  disabled_value_index: number;
  default_serve: ServeSpec;
  pinned: PinnedSubject[];
  rules: unknown[];
  version: string;
  updated_at: Date;
}
export const toFlagStageConfig = (r: FlagStageConfigRow): FlagStageConfig => ({
  flagId: r.flag_id,
  stageId: r.stage_id,
  enabled: r.enabled,
  disabledValueIndex: r.disabled_value_index,
  defaultServe: r.default_serve,
  pinned: r.pinned,
  rules: r.rules as FlagStageConfig["rules"],
  version: Number(r.version),
  updatedAt: r.updated_at.toISOString(),
});
