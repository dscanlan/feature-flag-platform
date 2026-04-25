import type { Pool } from "pg";
import type { Redis } from "ioredis";
import type { FastifyBaseLogger } from "fastify";
import { loadStage, putRuleset, type RulesetStore } from "./store.js";
import type { StreamHub } from "./streamHub.js";

const STAGE_PATTERN = "ff:stage:*";

export interface Synchronizer {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  refreshStage: (stageId: string) => Promise<void>;
}

/**
 * Subscribes to ff:stage:* on Redis. On each notification, re-loads the
 * affected stage's ruleset from Postgres and pushes it into `store`.
 */
export function createSynchronizer(args: {
  pool: Pool;
  redisSub: Redis;
  store: RulesetStore;
  hub: StreamHub;
  log: FastifyBaseLogger;
  safetyPollMs: number;
}): Synchronizer {
  const { pool, redisSub, store, hub, log, safetyPollMs } = args;
  let safetyTimer: NodeJS.Timeout | null = null;

  async function refreshStage(stageId: string): Promise<void> {
    const next = await loadStage(pool, stageId);
    putRuleset(store, next, stageId);
    if (next) {
      hub.emitChange(stageId, next.stage.version);
      log.debug({ stageId, version: next.stage.version }, "stage refreshed");
    } else {
      log.info({ stageId }, "stage removed");
    }
  }

  async function safetyPoll(): Promise<void> {
    try {
      const res = await pool.query<{ id: string; version: string }>(
        "SELECT id, version FROM stages",
      );
      for (const row of res.rows) {
        const cached = store.byStageId.get(row.id);
        const dbVersion = Number(row.version);
        if (!cached || cached.stage.version !== dbVersion) {
          await refreshStage(row.id);
        }
      }
    } catch (err) {
      log.warn({ err }, "safety poll failed");
    }
  }

  return {
    async start() {
      await redisSub.psubscribe(STAGE_PATTERN);
      redisSub.on("pmessage", (_pattern, channel) => {
        const stageId = channel.slice("ff:stage:".length);
        void refreshStage(stageId).catch((err) =>
          log.warn({ err, stageId }, "refreshStage failed"),
        );
      });
      safetyTimer = setInterval(() => void safetyPoll(), safetyPollMs);
      log.info({ pattern: STAGE_PATTERN }, "subscribed to stage updates");
    },
    async stop() {
      if (safetyTimer) clearInterval(safetyTimer);
      await redisSub.punsubscribe(STAGE_PATTERN).catch(() => undefined);
    },
    refreshStage,
  };
}
