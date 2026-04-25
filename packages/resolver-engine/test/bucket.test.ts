import { describe, expect, it } from "vitest";
import { bucket, pickBucket } from "../src/bucket.js";

describe("bucket()", () => {
  it("is deterministic for the same inputs", () => {
    const a = bucket("flag-1", "salt", "user-1");
    const b = bucket("flag-1", "salt", "user-1");
    expect(a).toBe(b);
  });

  it("produces different buckets for different keys", () => {
    expect(bucket("flag-1", "salt", "user-1")).not.toBe(bucket("flag-1", "salt", "user-2"));
  });

  it("stays within [0, 99999]", () => {
    for (let i = 0; i < 1_000; i++) {
      const b = bucket("flag-x", "s", `user-${i}`);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100_000);
    }
  });

  // Golden vector — change only if the §9.3 algorithm changes.
  it("matches golden vector for known inputs", () => {
    expect(bucket("flag-a", "salt-a", "user-a")).toBe(2613);
    expect(bucket("flag-a", "salt-a", "user-b")).toBe(3607);
    expect(bucket("new-checkout", "11111111-1111-1111-1111-111111111111", "user-1")).toBe(70782);
  });
});

describe("pickBucket()", () => {
  it("walks cumulative weights", () => {
    expect(pickBucket(0, [50_000, 50_000])).toBe(0);
    expect(pickBucket(49_999, [50_000, 50_000])).toBe(0);
    expect(pickBucket(50_000, [50_000, 50_000])).toBe(1);
    expect(pickBucket(99_999, [50_000, 50_000])).toBe(1);
  });

  it("3-way split", () => {
    expect(pickBucket(0, [33_333, 33_333, 33_334])).toBe(0);
    expect(pickBucket(33_333, [33_333, 33_333, 33_334])).toBe(1);
    expect(pickBucket(99_999, [33_333, 33_333, 33_334])).toBe(2);
  });

  it("falls back to last bucket if weights underflow", () => {
    expect(pickBucket(99_999, [10, 10])).toBe(1);
  });
});

describe("split distribution sanity", () => {
  it("50/50 across 10k random ids lands in 49–51 percent", () => {
    let zeroes = 0;
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      const b = bucket("flag-x", "salt", `user-${i}`);
      const idx = pickBucket(b, [50_000, 50_000])!;
      if (idx === 0) zeroes++;
    }
    const pct = (zeroes / N) * 100;
    expect(pct).toBeGreaterThanOrEqual(49);
    expect(pct).toBeLessThanOrEqual(51);
  });
});
