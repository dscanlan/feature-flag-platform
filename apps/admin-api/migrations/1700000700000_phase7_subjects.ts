import type { MigrationBuilder } from "node-pg-migrate";

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Persisted subjects observed by the resolver. Per PLAN.md §2.3 + §4:
  //  - One row per typed subject per stage (composite payloads expand to N rows).
  //  - `attributes` is the *latest* snapshot, not a merged history.
  //  - first_seen_at / last_seen_at let the admin UI surface activity later.
  pgm.createTable("subjects", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    workspace_id: {
      type: "uuid",
      notNull: true,
      references: "workspaces(id)",
      onDelete: "CASCADE",
    },
    stage_id: {
      type: "uuid",
      notNull: true,
      references: "stages(id)",
      onDelete: "CASCADE",
    },
    subject_type: { type: "text", notNull: true },
    subject_id: { type: "text", notNull: true },
    name: { type: "text" },
    attributes: { type: "jsonb", notNull: true, default: "{}" },
    first_seen_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    last_seen_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    last_seen_via: { type: "text" },
  });
  pgm.addConstraint("subjects", "subjects_stage_type_id_unique", {
    unique: ["stage_id", "subject_type", "subject_id"],
  });

  // List-by-recency for the Subjects page; descending so default ordering
  // returns the most recently active subjects first.
  pgm.createIndex("subjects", ["stage_id", { name: "last_seen_at", sort: "DESC" }], {
    name: "subjects_stage_recency_idx",
  });
  // Searchable subject lookups for admin dropdowns: scoped by (stage, type)
  // then by case-insensitive id prefix.
  pgm.sql(
    `CREATE INDEX subjects_stage_type_id_lower_idx
       ON subjects (stage_id, subject_type, lower(subject_id) text_pattern_ops)`,
  );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("subjects");
}
