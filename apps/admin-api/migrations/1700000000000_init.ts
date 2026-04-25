/* eslint-disable @typescript-eslint/no-explicit-any */
import type { MigrationBuilder } from "node-pg-migrate";

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createExtension("pgcrypto", { ifNotExists: true });

  pgm.createTable("workspaces", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    key: { type: "text", notNull: true, unique: true },
    name: { type: "text", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createTable("stages", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    workspace_id: {
      type: "uuid",
      notNull: true,
      references: "workspaces(id)",
      onDelete: "CASCADE",
    },
    key: { type: "text", notNull: true },
    name: { type: "text", notNull: true },
    server_key: { type: "text", notNull: true, unique: true },
    public_key: { type: "text", notNull: true, unique: true },
    critical: { type: "boolean", notNull: true, default: false },
    version: { type: "bigint", notNull: true, default: 0 },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("stages", "stages_workspace_key_unique", {
    unique: ["workspace_id", "key"],
  });

  pgm.createTable("subject_types", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    workspace_id: {
      type: "uuid",
      notNull: true,
      references: "workspaces(id)",
      onDelete: "CASCADE",
    },
    key: { type: "text", notNull: true },
    name: { type: "text", notNull: true },
    is_default_split_key: { type: "boolean", notNull: true, default: false },
  });
  pgm.addConstraint("subject_types", "subject_types_workspace_key_unique", {
    unique: ["workspace_id", "key"],
  });

  pgm.createTable("flags", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    workspace_id: {
      type: "uuid",
      notNull: true,
      references: "workspaces(id)",
      onDelete: "CASCADE",
    },
    key: { type: "text", notNull: true },
    name: { type: "text", notNull: true },
    description: { type: "text" },
    kind: { type: "text", notNull: true, check: "kind IN ('boolean','json')" },
    values: { type: "jsonb", notNull: true },
    tags: { type: "text[]", notNull: true, default: "{}" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("flags", "flags_workspace_key_unique", {
    unique: ["workspace_id", "key"],
  });

  pgm.createTable(
    "flag_stage_configs",
    {
      flag_id: {
        type: "uuid",
        notNull: true,
        references: "flags(id)",
        onDelete: "CASCADE",
      },
      stage_id: {
        type: "uuid",
        notNull: true,
        references: "stages(id)",
        onDelete: "CASCADE",
      },
      enabled: { type: "boolean", notNull: true, default: false },
      disabled_value_index: { type: "integer", notNull: true, default: 0 },
      default_serve: { type: "jsonb", notNull: true },
      pinned: { type: "jsonb", notNull: true, default: "[]" },
      rules: { type: "jsonb", notNull: true, default: "[]" },
      version: { type: "bigint", notNull: true, default: 0 },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    {
      constraints: { primaryKey: ["flag_id", "stage_id"] },
    },
  );

  pgm.createTable("audiences", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    workspace_id: {
      type: "uuid",
      notNull: true,
      references: "workspaces(id)",
      onDelete: "CASCADE",
    },
    key: { type: "text", notNull: true },
    name: { type: "text", notNull: true },
    subject_type: { type: "text", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("audiences", "audiences_workspace_key_unique", {
    unique: ["workspace_id", "key"],
  });

  pgm.createTable(
    "audience_stage_payloads",
    {
      audience_id: {
        type: "uuid",
        notNull: true,
        references: "audiences(id)",
        onDelete: "CASCADE",
      },
      stage_id: {
        type: "uuid",
        notNull: true,
        references: "stages(id)",
        onDelete: "CASCADE",
      },
      members: { type: "jsonb", notNull: true, default: "[]" },
      rules: { type: "jsonb", notNull: true, default: "[]" },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    {
      constraints: { primaryKey: ["audience_id", "stage_id"] },
    },
  );

  pgm.createTable("admin_users", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    email: { type: "text", notNull: true, unique: true },
    password_hash: { type: "text", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createTable("admin_sessions", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "admin_users(id)",
      onDelete: "CASCADE",
    },
    expires_at: { type: "timestamptz", notNull: true },
  });
  pgm.createIndex("admin_sessions", ["user_id"]);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("admin_sessions");
  pgm.dropTable("admin_users");
  pgm.dropTable("audience_stage_payloads");
  pgm.dropTable("audiences");
  pgm.dropTable("flag_stage_configs");
  pgm.dropTable("flags");
  pgm.dropTable("subject_types");
  pgm.dropTable("stages");
  pgm.dropTable("workspaces");
}
