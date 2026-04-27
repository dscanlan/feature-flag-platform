import type { Pool, PoolClient } from "pg";
import type { Logger } from "pino";
import { hashPassword } from "../auth/password.js";
import type { Config } from "../config.js";
import { generatePublicKey, generateServerKey, generateSubjectSigningSecret } from "../lib/keys.js";

export async function seedAdminUser(pool: Pool, config: Config, logger: Logger): Promise<void> {
  const existing = await pool.query<{ id: string }>("SELECT id FROM admin_users WHERE email = $1", [
    config.ADMIN_EMAIL,
  ]);

  if (existing.rows.length > 0) {
    logger.debug({ email: config.ADMIN_EMAIL }, "admin user already exists");
    return;
  }

  const hash = await hashPassword(config.ADMIN_PASSWORD);
  await pool.query("INSERT INTO admin_users (email, password_hash) VALUES ($1, $2)", [
    config.ADMIN_EMAIL,
    hash,
  ]);
  logger.info({ email: config.ADMIN_EMAIL }, "seeded admin user");
}

const DEV_WORKSPACE_KEY = "default";

interface DevStage {
  key: string;
  name: string;
  critical?: boolean;
}

const DEV_STAGES: DevStage[] = [
  { key: "production", name: "Production", critical: true },
  { key: "staging", name: "Staging" },
  { key: "development", name: "Development" },
];

interface DevSubjectType {
  key: string;
  name: string;
  isDefaultSplitKey?: boolean;
}

const DEV_SUBJECT_TYPES: DevSubjectType[] = [
  { key: "user", name: "User", isDefaultSplitKey: true },
  { key: "account", name: "Account" },
  { key: "device", name: "Device" },
];

interface DevAudienceClause {
  kind: "attribute";
  subjectType: string;
  attribute: string;
  op: string;
  values: (string | number | boolean)[];
  negate: boolean;
}

interface DevAudienceMember {
  subjectType: string;
  subjectId: string;
  included: boolean;
}

interface DevAudience {
  key: string;
  name: string;
  subjectType: string;
  members: DevAudienceMember[];
  rules: { id: string; clauses: DevAudienceClause[] }[];
}

const DEV_AUDIENCES: DevAudience[] = [
  {
    key: "beta-testers",
    name: "Beta testers",
    subjectType: "user",
    members: [
      { subjectType: "user", subjectId: "alice", included: true },
      { subjectType: "user", subjectId: "bob", included: true },
      { subjectType: "user", subjectId: "carol", included: true },
      { subjectType: "user", subjectId: "dave", included: false },
    ],
    rules: [
      {
        id: "pro-plan",
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
      },
    ],
  },
  {
    key: "internal-employees",
    name: "Internal employees",
    subjectType: "user",
    members: [
      { subjectType: "user", subjectId: "eve", included: true },
      { subjectType: "user", subjectId: "frank", included: true },
    ],
    rules: [
      {
        id: "company-email",
        clauses: [
          {
            kind: "attribute",
            subjectType: "user",
            attribute: "email",
            op: "endsWith",
            values: ["@example.com"],
            negate: false,
          },
        ],
      },
    ],
  },
  {
    key: "enterprise-accounts",
    name: "Enterprise accounts",
    subjectType: "account",
    members: [
      { subjectType: "account", subjectId: "acme-corp", included: true },
      { subjectType: "account", subjectId: "globex", included: true },
      { subjectType: "account", subjectId: "initech", included: true },
    ],
    rules: [
      {
        id: "high-tier",
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
      },
    ],
  },
  {
    key: "mobile-devices",
    name: "Mobile devices",
    subjectType: "device",
    members: [],
    rules: [
      {
        id: "mobile-platforms",
        clauses: [
          {
            kind: "attribute",
            subjectType: "device",
            attribute: "platform",
            op: "in",
            values: ["ios", "android"],
            negate: false,
          },
        ],
      },
    ],
  },
];

interface DevSubject {
  subjectType: string;
  subjectId: string;
  name?: string;
  attributes: Record<string, unknown>;
}

const DEV_SUBJECTS: DevSubject[] = [
  {
    subjectType: "user",
    subjectId: "alice",
    name: "Alice Anderson",
    attributes: { email: "alice@example.com", plan: "pro", country: "US" },
  },
  {
    subjectType: "user",
    subjectId: "bob",
    name: "Bob Brown",
    attributes: { email: "bob@example.com", plan: "pro", country: "GB" },
  },
  {
    subjectType: "user",
    subjectId: "carol",
    name: "Carol Chen",
    attributes: { email: "carol@enterprise.test", plan: "enterprise", country: "US" },
  },
  {
    subjectType: "user",
    subjectId: "dave",
    name: "Dave Davies",
    attributes: { email: "dave@gmail.test", plan: "free", country: "AU" },
  },
  {
    subjectType: "user",
    subjectId: "eve",
    name: "Eve Edwards",
    attributes: { email: "eve@example.com", plan: "pro", country: "US", role: "admin" },
  },
  {
    subjectType: "user",
    subjectId: "frank",
    name: "Frank Foster",
    attributes: { email: "frank@example.com", plan: "free", country: "DE", role: "engineer" },
  },
  {
    subjectType: "user",
    subjectId: "grace",
    name: "Grace Garcia",
    attributes: { email: "grace@gmail.test", plan: "free", country: "ES" },
  },
  {
    subjectType: "user",
    subjectId: "heidi",
    name: "Heidi Hughes",
    attributes: { email: "heidi@gmail.test", plan: "pro", country: "FR" },
  },
  {
    subjectType: "user",
    subjectId: "ivan",
    name: "Ivan Ivanov",
    attributes: { email: "ivan@gmail.test", plan: "free", country: "RU" },
  },
  {
    subjectType: "account",
    subjectId: "acme-corp",
    name: "Acme Corp",
    attributes: { tier: "enterprise", seats: 250, region: "us-east-1" },
  },
  {
    subjectType: "account",
    subjectId: "globex",
    name: "Globex",
    attributes: { tier: "enterprise", seats: 1200, region: "eu-west-1" },
  },
  {
    subjectType: "account",
    subjectId: "initech",
    name: "Initech",
    attributes: { tier: "enterprise", seats: 80, region: "us-west-2" },
  },
  {
    subjectType: "account",
    subjectId: "hooli",
    name: "Hooli",
    attributes: { tier: "growth", seats: 35, region: "us-west-2" },
  },
  {
    subjectType: "device",
    subjectId: "ios-1234",
    attributes: { platform: "ios", appVersion: "4.2.0" },
  },
  {
    subjectType: "device",
    subjectId: "android-5678",
    attributes: { platform: "android", appVersion: "4.1.3" },
  },
  {
    subjectType: "device",
    subjectId: "web-9012",
    attributes: { platform: "web", appVersion: "4.2.1" },
  },
];

interface StageRow {
  id: string;
  key: string;
}

/**
 * Idempotent dev-only seed: populates a `default` workspace with stages,
 * subject types, audiences (with members + rules), and a handful of subjects
 * so the admin UI has something to render on first boot. Skips entirely if
 * the workspace already exists.
 */
export async function seedDevSampleData(pool: Pool, config: Config, logger: Logger): Promise<void> {
  if (config.NODE_ENV !== "development") return;

  const existing = await pool.query<{ id: string }>("SELECT id FROM workspaces WHERE key = $1", [
    DEV_WORKSPACE_KEY,
  ]);
  if (existing.rows.length > 0) {
    logger.debug({ key: DEV_WORKSPACE_KEY }, "dev sample workspace already exists");
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const wsRes = await client.query<{ id: string }>(
      "INSERT INTO workspaces (key, name) VALUES ($1, $2) RETURNING id",
      [DEV_WORKSPACE_KEY, "Default Workspace"],
    );
    const workspaceId = wsRes.rows[0]!.id;

    const stages = await insertStages(client, workspaceId);
    await insertSubjectTypes(client, workspaceId);
    await insertAudiences(client, workspaceId, stages);
    await insertSubjects(client, workspaceId, stages);

    await client.query("COMMIT");
    logger.info(
      {
        workspace: DEV_WORKSPACE_KEY,
        stages: stages.length,
        subjectTypes: DEV_SUBJECT_TYPES.length,
        audiences: DEV_AUDIENCES.length,
        subjects: DEV_SUBJECTS.length * stages.length,
      },
      "seeded dev sample data",
    );
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    logger.warn({ err }, "failed to seed dev sample data");
    throw err;
  } finally {
    client.release();
  }
}

async function insertStages(client: PoolClient, workspaceId: string): Promise<StageRow[]> {
  const out: StageRow[] = [];
  for (const stage of DEV_STAGES) {
    const res = await client.query<{ id: string; key: string }>(
      `INSERT INTO stages
         (workspace_id, key, name, server_key, public_key, critical, subject_signing_secret)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, key`,
      [
        workspaceId,
        stage.key,
        stage.name,
        generateServerKey(),
        generatePublicKey(),
        stage.critical ?? false,
        generateSubjectSigningSecret(),
      ],
    );
    out.push(res.rows[0]!);
  }
  return out;
}

async function insertSubjectTypes(client: PoolClient, workspaceId: string): Promise<void> {
  for (const st of DEV_SUBJECT_TYPES) {
    await client.query(
      `INSERT INTO subject_types (workspace_id, key, name, is_default_split_key)
       VALUES ($1, $2, $3, $4)`,
      [workspaceId, st.key, st.name, st.isDefaultSplitKey ?? false],
    );
  }
}

async function insertAudiences(
  client: PoolClient,
  workspaceId: string,
  stages: StageRow[],
): Promise<void> {
  for (const aud of DEV_AUDIENCES) {
    const res = await client.query<{ id: string }>(
      `INSERT INTO audiences (workspace_id, key, name, subject_type)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [workspaceId, aud.key, aud.name, aud.subjectType],
    );
    const audienceId = res.rows[0]!.id;
    for (const stage of stages) {
      await client.query(
        `INSERT INTO audience_stage_payloads (audience_id, stage_id, members, rules)
         VALUES ($1, $2, $3::jsonb, $4::jsonb)`,
        [audienceId, stage.id, JSON.stringify(aud.members), JSON.stringify(aud.rules)],
      );
    }
  }
}

async function insertSubjects(
  client: PoolClient,
  workspaceId: string,
  stages: StageRow[],
): Promise<void> {
  // Skip the development stage so each stage isn't a clone — gives the
  // Subjects page something to differentiate.
  const seedStages = stages.filter((s) => s.key !== "development");
  for (const stage of seedStages) {
    for (const subj of DEV_SUBJECTS) {
      await client.query(
        `INSERT INTO subjects
           (workspace_id, stage_id, subject_type, subject_id, name, attributes, last_seen_via)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [
          workspaceId,
          stage.id,
          subj.subjectType,
          subj.subjectId,
          subj.name ?? null,
          JSON.stringify(subj.attributes),
          "seed",
        ],
      );
    }
  }
}
