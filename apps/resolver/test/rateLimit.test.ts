import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRateLimit } from "../src/rateLimit.js";

describe("token-bucket rate limit", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("allows up to `burst` back-to-back then rejects with a wait hint", () => {
    const rl = createRateLimit({ rate: 10, burst: 3 });
    expect(rl.consume("k")).toBeNull();
    expect(rl.consume("k")).toBeNull();
    expect(rl.consume("k")).toBeNull();
    const wait = rl.consume("k");
    expect(wait).not.toBeNull();
    // One token worth of wait at 10/s = 0.1s.
    expect(wait!).toBeCloseTo(0.1, 1);
  });

  it("refills at `rate` tokens/s", () => {
    vi.setSystemTime(0);
    const rl = createRateLimit({ rate: 10, burst: 1 });
    expect(rl.consume("k")).toBeNull();
    expect(rl.consume("k")).not.toBeNull(); // burst exhausted

    vi.setSystemTime(100); // 0.1s later → +1 token
    expect(rl.consume("k")).toBeNull();
  });

  it("keys are isolated", () => {
    const rl = createRateLimit({ rate: 1, burst: 1 });
    expect(rl.consume("a")).toBeNull();
    expect(rl.consume("b")).toBeNull();
    expect(rl.consume("a")).not.toBeNull();
    expect(rl.consume("b")).not.toBeNull();
  });
});
