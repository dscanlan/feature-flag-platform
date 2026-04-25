import { describe, expect, it } from "vitest";
import type { AttributeOp } from "@ffp/shared-types";
import { applyOp } from "../src/operators.js";

const cache = () => new Map<string, RegExp>();

describe("operators", () => {
  describe("equality", () => {
    it("in / notIn", () => {
      expect(applyOp("in", "a", ["a", "b"], cache())).toBe(true);
      expect(applyOp("in", "c", ["a", "b"], cache())).toBe(false);
      expect(applyOp("notIn", "c", ["a", "b"], cache())).toBe(true);
      expect(applyOp("notIn", "a", ["a", "b"], cache())).toBe(false);
    });
  });

  describe("string ops", () => {
    it("startsWith / endsWith / contains", () => {
      expect(applyOp("startsWith", "abcd", ["ab"], cache())).toBe(true);
      expect(applyOp("startsWith", "abcd", ["xy"], cache())).toBe(false);
      expect(applyOp("endsWith", "abcd", ["cd"], cache())).toBe(true);
      expect(applyOp("contains", "hello world", ["lo wo"], cache())).toBe(true);
    });

    it("type-mismatch is no-match, no throw", () => {
      expect(applyOp("startsWith", 42 as unknown, ["4"], cache())).toBe(false);
      expect(applyOp("contains", null as unknown, ["x"], cache())).toBe(false);
    });

    it("matches: regex with cache", () => {
      const c = cache();
      expect(applyOp("matches", "hello-123", ["^hello-\\d+$"], c)).toBe(true);
      expect(applyOp("matches", "nope", ["^hello-\\d+$"], c)).toBe(false);
      expect(c.size).toBe(1); // cached
    });

    it("matches: invalid regex is no-match", () => {
      expect(applyOp("matches", "x", ["[unterminated"], cache())).toBe(false);
    });
  });

  describe("numeric ops", () => {
    it("lt / lte / gt / gte", () => {
      expect(applyOp("lessThan", 3, [5], cache())).toBe(true);
      expect(applyOp("lessThan", 5, [5], cache())).toBe(false);
      expect(applyOp("lessThanOrEqual", 5, [5], cache())).toBe(true);
      expect(applyOp("greaterThan", 5, [3], cache())).toBe(true);
      expect(applyOp("greaterThanOrEqual", 5, [5], cache())).toBe(true);
    });

    it("non-finite numbers / strings → no match", () => {
      expect(applyOp("lessThan", NaN, [5], cache())).toBe(false);
      expect(applyOp("lessThan", "3" as unknown, [5], cache())).toBe(false);
      expect(applyOp("greaterThan", 5, ["3" as unknown as number], cache())).toBe(false);
    });
  });

  describe("date ops", () => {
    it("before / after with ISO strings", () => {
      expect(applyOp("before", "2026-01-01", ["2026-06-01"], cache())).toBe(true);
      expect(applyOp("after", "2026-06-02", ["2026-06-01"], cache())).toBe(true);
      expect(applyOp("after", "2026-01-01", ["2026-06-01"], cache())).toBe(false);
    });

    it("garbage dates → no match", () => {
      expect(applyOp("before", "not-a-date", ["2026-06-01"], cache())).toBe(false);
      expect(applyOp("after", "2026-06-01", ["nope"], cache())).toBe(false);
    });

    it("numeric ms timestamps work", () => {
      expect(applyOp("before", 1, [10], cache())).toBe(true);
    });
  });

  describe("semver ops", () => {
    it("eq / lt / gt", () => {
      expect(applyOp("semVerEqual", "1.2.3", ["1.2.3"], cache())).toBe(true);
      expect(applyOp("semVerLessThan", "1.2.3", ["1.3.0"], cache())).toBe(true);
      expect(applyOp("semVerGreaterThan", "2.0.0", ["1.9.9"], cache())).toBe(true);
    });

    it("coerces shorthand", () => {
      expect(applyOp("semVerEqual", "1.2", ["1.2.0"], cache())).toBe(true);
    });

    it("garbage → no match", () => {
      expect(applyOp("semVerEqual", "not-a-version", ["1.2.3"], cache())).toBe(false);
      expect(applyOp("semVerLessThan", null as unknown, ["1.2.3"], cache())).toBe(false);
    });
  });

  it("every operator is exhaustively handled", () => {
    const ops: AttributeOp[] = [
      "in",
      "notIn",
      "startsWith",
      "endsWith",
      "contains",
      "matches",
      "lessThan",
      "lessThanOrEqual",
      "greaterThan",
      "greaterThanOrEqual",
      "before",
      "after",
      "semVerEqual",
      "semVerLessThan",
      "semVerGreaterThan",
    ];
    for (const op of ops) {
      // Just ensure no throw.
      expect(() => applyOp(op, "x", ["x"], cache())).not.toThrow();
    }
  });
});
