import type { PoolClient } from "pg";

export interface AuditEntry {
  workspaceId: string | null;
  actorUserId: string | null;
  action: string;
  target: string;
  before?: unknown;
  after?: unknown;
}

/**
 * Append a row to `audit_log`. Call this inside the same tx as the mutation
 * it describes so the log row is atomic with the change. Silently no-ops on
 * the caller side by only writing `before`/`after` as JSON when defined — we
 * always store JSON (not SQL NULL) for "null" vs "absent" distinction.
 */
export async function writeAudit(client: PoolClient, entry: AuditEntry): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (workspace_id, actor_user_id, action, target, before, after)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [
      entry.workspaceId,
      entry.actorUserId,
      entry.action,
      entry.target,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
    ],
  );
}
