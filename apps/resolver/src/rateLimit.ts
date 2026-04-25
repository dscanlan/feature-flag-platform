/**
 * In-process token-bucket rate limiter, keyed by Bearer token. Tokens refill
 * continuously at `rate` per second up to `burst`. Per-key state is purged
 * after 5 minutes of inactivity so the map can't grow without bound.
 */

export interface RateLimit {
  /** Returns null on success, or the seconds-to-wait on rejection. */
  consume: (key: string) => number | null;
}

export interface RateLimitConfig {
  /** Tokens per second, sustained. Default: 100. */
  rate: number;
  /** Bucket size. Default: 200. */
  burst: number;
  /** Idle eviction threshold in ms. Default: 5 minutes. */
  ttlMs?: number;
}

interface Bucket {
  tokens: number;
  lastMs: number;
}

const DEFAULT_TTL_MS = 5 * 60_000;

export function createRateLimit(cfg: RateLimitConfig): RateLimit {
  const { rate, burst } = cfg;
  const ttlMs = cfg.ttlMs ?? DEFAULT_TTL_MS;
  const buckets = new Map<string, Bucket>();
  let lastSweep = Date.now();

  function maybeSweep(now: number): void {
    if (now - lastSweep < 30_000) return;
    lastSweep = now;
    for (const [k, b] of buckets) {
      if (now - b.lastMs > ttlMs) buckets.delete(k);
    }
  }

  return {
    consume(key: string) {
      const now = Date.now();
      maybeSweep(now);
      let b = buckets.get(key);
      if (!b) {
        b = { tokens: burst, lastMs: now };
        buckets.set(key, b);
      }
      // Refill.
      const dt = (now - b.lastMs) / 1000;
      b.tokens = Math.min(burst, b.tokens + dt * rate);
      b.lastMs = now;
      if (b.tokens >= 1) {
        b.tokens -= 1;
        return null;
      }
      // Time until at least one token is available.
      const need = 1 - b.tokens;
      return need / rate;
    },
  };
}
