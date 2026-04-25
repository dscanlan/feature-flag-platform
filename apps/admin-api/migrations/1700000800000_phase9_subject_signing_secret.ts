import type { MigrationBuilder } from "node-pg-migrate";

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Per-stage HMAC secret used by the host application's backend to sign
  // `subjectToken`s (PLAN.md §7.6). The resolver verifies tokens against this
  // secret before trusting the embedded subject claims.
  //
  //  - Stored as base64 of 32 random bytes (256-bit key) — generated here for
  //    pre-existing rows; new stages generate one in the admin API on insert.
  //  - This is a secret. Do NOT echo it in API responses except on creation
  //    and on explicit reset (mirrors AGENT.md §12.6 for Server Keys).
  pgm.addColumn("stages", {
    subject_signing_secret: {
      type: "text",
      notNull: true,
      default: pgm.func("encode(gen_random_bytes(32), 'base64')"),
    },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumn("stages", "subject_signing_secret");
}
