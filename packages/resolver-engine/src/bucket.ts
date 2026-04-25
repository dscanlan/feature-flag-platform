import { createHash } from "node:crypto";

/**
 * Deterministic 0..99999 bucket per AGENT.md §9.3.
 * SHA-1 of `${flagKey}.${salt}.${splitKeyId}` → first 15 hex chars → mod 100000.
 */
export function bucket(flagKey: string, salt: string, splitKeyId: string): number {
  const input = `${flagKey}.${salt}.${splitKeyId}`;
  const hex = createHash("sha1").update(input).digest("hex").slice(0, 15);
  const n = BigInt("0x" + hex);
  return Number(n % 100000n);
}

/** Pick the bucket index by walking cumulative weights. Returns null if weights are malformed. */
export function pickBucket(b: number, weights: number[]): number | null {
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i] ?? 0;
    if (b < acc) return i;
  }
  // If weights sum to exactly 100000 we always hit a branch above; this guards
  // against rounding/misconfigured inputs.
  return weights.length > 0 ? weights.length - 1 : null;
}
