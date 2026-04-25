import type { MigrationBuilder } from "node-pg-migrate";

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Per-stage CORS allow-list. Default `{*}` preserves the existing behaviour
  // (any origin). Admins can tighten this per stage from the UI.
  pgm.addColumn("stages", {
    cors_origins: { type: "text[]", notNull: true, default: "{*}" },
  });

  // Append-only audit log for every admin write. `before` and `after` are
  // nullable so creates/deletes can be represented (one side null).
  pgm.createTable("audit_log", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    workspace_id: {
      type: "uuid",
      references: "workspaces(id)",
      onDelete: "CASCADE",
    },
    actor_user_id: {
      type: "uuid",
      references: "admin_users(id)",
      onDelete: "SET NULL",
    },
    action: { type: "text", notNull: true },
    target: { type: "text", notNull: true },
    before: { type: "jsonb" },
    after: { type: "jsonb" },
    at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("audit_log", ["workspace_id", "at"]);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("audit_log");
  pgm.dropColumn("stages", "cors_origins");
}
