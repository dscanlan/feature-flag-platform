import type { Pool } from "pg";
import type {
  Audience,
  AudienceId,
  Flag,
  FlagStageConfig,
  Stage,
  SubjectType,
} from "@ffp/shared-types";

export interface StageRuleset {
  stage: Stage;
  flags: Flag[];
  flagsByKey: Map<string, Flag>;
  configs: FlagStageConfig[];
  configsByFlagId: Map<string, FlagStageConfig>;
  audiences: Audience[];
  audiencesById: Map<AudienceId, Audience>;
  subjectTypes: SubjectType[];
}

export interface RulesetStore {
  byStageId: Map<string, StageRuleset>;
  byServerKey: Map<string, StageRuleset>;
  byPublicKey: Map<string, StageRuleset>;
}

export function emptyStore(): RulesetStore {
  return {
    byStageId: new Map(),
    byServerKey: new Map(),
    byPublicKey: new Map(),
  };
}

interface StageRow {
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

interface FlagRow {
  id: string;
  workspace_id: string;
  key: string;
  name: string;
  description: string | null;
  kind: "boolean" | "json";
  values: Flag["values"];
  tags: string[];
  created_at: Date;
}

interface ConfigRow {
  flag_id: string;
  stage_id: string;
  enabled: boolean;
  disabled_value_index: number;
  default_serve: FlagStageConfig["defaultServe"];
  pinned: FlagStageConfig["pinned"];
  rules: FlagStageConfig["rules"];
  version: string;
  updated_at: Date;
}

interface SubjectTypeRow {
  id: string;
  workspace_id: string;
  key: string;
  name: string;
  is_default_split_key: boolean;
}

interface AudienceRow {
  id: string;
  workspace_id: string;
  key: string;
  name: string;
  subject_type: string;
}

interface AudiencePayloadRow {
  audience_id: string;
  stage_id: string;
  members: Audience["perStage"][string]["members"];
  rules: Audience["perStage"][string]["rules"];
}

const toStage = (r: StageRow): Stage => ({
  id: r.id,
  workspaceId: r.workspace_id,
  key: r.key,
  name: r.name,
  serverKey: r.server_key,
  publicKey: r.public_key,
  critical: r.critical,
  version: Number(r.version),
  corsOrigins: r.cors_origins,
  // Internal — never serialised to clients. The resolver verifies subject
  // tokens with this; nothing in the SDK ever sees it.
  subjectSigningSecret: r.subject_signing_secret,
  createdAt: r.created_at.toISOString(),
});

const toFlag = (r: FlagRow): Flag => ({
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

const toConfig = (r: ConfigRow): FlagStageConfig => ({
  flagId: r.flag_id,
  stageId: r.stage_id,
  enabled: r.enabled,
  disabledValueIndex: r.disabled_value_index,
  defaultServe: r.default_serve,
  pinned: r.pinned,
  rules: r.rules,
  version: Number(r.version),
  updatedAt: r.updated_at.toISOString(),
});

const toSubjectType = (r: SubjectTypeRow): SubjectType => ({
  id: r.id,
  workspaceId: r.workspace_id,
  key: r.key,
  name: r.name,
  isDefaultSplitKey: r.is_default_split_key,
});

/** Load (or reload) the ruleset for a single stage from the DB. */
export async function loadStage(pool: Pool, stageId: string): Promise<StageRuleset | null> {
  const stageRes = await pool.query<StageRow>("SELECT * FROM stages WHERE id = $1", [stageId]);
  const stageRow = stageRes.rows[0];
  if (!stageRow) return null;
  const stage = toStage(stageRow);

  const [flagsRes, cfgRes, audRes, audPayRes, stRes] = await Promise.all([
    pool.query<FlagRow>("SELECT * FROM flags WHERE workspace_id = $1", [stage.workspaceId]),
    pool.query<ConfigRow>("SELECT * FROM flag_stage_configs WHERE stage_id = $1", [stage.id]),
    pool.query<AudienceRow>("SELECT * FROM audiences WHERE workspace_id = $1", [stage.workspaceId]),
    pool.query<AudiencePayloadRow>(
      `SELECT asp.* FROM audience_stage_payloads asp
       JOIN audiences a ON a.id = asp.audience_id
       WHERE a.workspace_id = $1 AND asp.stage_id = $2`,
      [stage.workspaceId, stage.id],
    ),
    pool.query<SubjectTypeRow>("SELECT * FROM subject_types WHERE workspace_id = $1", [
      stage.workspaceId,
    ]),
  ]);

  const flags = flagsRes.rows.map(toFlag);
  const configs = cfgRes.rows.map(toConfig);
  const subjectTypes = stRes.rows.map(toSubjectType);

  // Stitch audience + per-stage payloads together for this stage only.
  const payloadByAudienceId = new Map<string, AudiencePayloadRow>();
  for (const p of audPayRes.rows) payloadByAudienceId.set(p.audience_id, p);
  const audiences: Audience[] = audRes.rows.map((r) => {
    const payload = payloadByAudienceId.get(r.id);
    return {
      id: r.id,
      workspaceId: r.workspace_id,
      key: r.key,
      name: r.name,
      subjectType: r.subject_type,
      perStage: {
        [stage.id]: {
          members: payload?.members ?? [],
          rules: payload?.rules ?? [],
        },
      },
    };
  });

  return {
    stage,
    flags,
    flagsByKey: new Map(flags.map((f) => [f.key, f])),
    configs,
    configsByFlagId: new Map(configs.map((c) => [c.flagId, c])),
    audiences,
    audiencesById: new Map(audiences.map((a) => [a.id, a])),
    subjectTypes,
  };
}

/** Load every stage in the database. */
export async function loadAllStages(pool: Pool): Promise<RulesetStore> {
  const ids = await pool.query<{ id: string }>("SELECT id FROM stages");
  const store = emptyStore();
  for (const { id } of ids.rows) {
    const ruleset = await loadStage(pool, id);
    if (ruleset) putRuleset(store, ruleset);
  }
  return store;
}

/** Replace the ruleset for `stage.id` (and rewire key indexes), or remove if null. */
export function putRuleset(
  store: RulesetStore,
  ruleset: StageRuleset | null,
  stageId?: string,
): void {
  // Remove any prior entry for this stage so old keys don't linger.
  const existingId = ruleset?.stage.id ?? stageId;
  if (existingId) {
    const prior = store.byStageId.get(existingId);
    if (prior) {
      store.byServerKey.delete(prior.stage.serverKey);
      store.byPublicKey.delete(prior.stage.publicKey);
    }
    store.byStageId.delete(existingId);
  }
  if (!ruleset) return;
  store.byStageId.set(ruleset.stage.id, ruleset);
  store.byServerKey.set(ruleset.stage.serverKey, ruleset);
  store.byPublicKey.set(ruleset.stage.publicKey, ruleset);
}
