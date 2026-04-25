import type { Pool, PoolClient } from "pg";
import type { Redis } from "ioredis";
import { writeAudit, type AuditEntry } from "./audit.js";

export const stageChannel = (stageId: string): string => `ff:stage:${stageId}`;

/**
 * Bump the version of every stage_id passed in (inside the supplied tx
 * client), then return a function the caller invokes after commit to publish
 * the new versions to Redis. Failure to publish is logged and swallowed —
 * the resolver's 60s safety poll will pick up the change anyway.
 */
export async function bumpStages(
  client: PoolClient,
  stageIds: string[],
): Promise<{ stageId: string; version: number }[]> {
  if (stageIds.length === 0) return [];
  const res = await client.query<{ id: string; version: string }>(
    "UPDATE stages SET version = version + 1 WHERE id = ANY($1::uuid[]) RETURNING id, version",
    [stageIds],
  );
  return res.rows.map((r) => ({ stageId: r.id, version: Number(r.version) }));
}

export interface Publisher {
  publishStageChanges: (changes: { stageId: string; version: number }[]) => Promise<void>;
}

export function createPublisher(
  redis: Redis,
  log: (msg: string, err?: unknown) => void,
): Publisher {
  return {
    async publishStageChanges(changes) {
      if (changes.length === 0) return;
      await Promise.all(
        changes.map(async ({ stageId, version }) => {
          try {
            await redis.publish(
              stageChannel(stageId),
              JSON.stringify({ kind: "config-changed", version }),
            );
          } catch (err) {
            log(`failed to publish ${stageChannel(stageId)}`, err);
          }
        }),
      );
    },
  };
}

/**
 * Convenience: open a tx, run `op`, append any `audit` rows inside the same
 * tx, commit, then publish to Redis. Audit rows are written regardless of
 * whether any stageIds are bumped (e.g. workspace create has no stage).
 */
export async function withStageBump<T>(
  pool: Pool,
  publisher: Publisher,
  op: (
    client: PoolClient,
  ) => Promise<{ result: T; stageIds: string[]; audit?: AuditEntry | AuditEntry[] }>,
): Promise<T> {
  const client = await pool.connect();
  let bumps: { stageId: string; version: number }[] = [];
  let result: T;
  try {
    await client.query("BEGIN");
    const { result: r, stageIds, audit } = await op(client);
    bumps = await bumpStages(client, stageIds);
    if (audit) {
      const entries = Array.isArray(audit) ? audit : [audit];
      for (const e of entries) await writeAudit(client, e);
    }
    await client.query("COMMIT");
    result = r;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  await publisher.publishStageChanges(bumps);
  return result;
}
