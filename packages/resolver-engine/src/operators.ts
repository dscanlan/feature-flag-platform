import semver from "semver";
import type { AttributeOp } from "@ffp/shared-types";

type Value = string | number | boolean;

const isString = (v: unknown): v is string => typeof v === "string";
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parseDate(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

function coerceSemver(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const c = semver.coerce(String(v));
  return c ? c.version : null;
}

/**
 * Apply an operator. Returns false on type mismatches; never throws. Regexes
 * are cached per evaluation call via the `cache` Map.
 */
export function applyOp(
  op: AttributeOp,
  actual: unknown,
  values: Value[],
  cache: Map<string, RegExp> | null,
): boolean {
  switch (op) {
    case "in":
      return values.some((v) => v === actual);
    case "notIn":
      return !values.some((v) => v === actual);
    case "startsWith":
      return isString(actual) && values.some((v) => isString(v) && actual.startsWith(v));
    case "endsWith":
      return isString(actual) && values.some((v) => isString(v) && actual.endsWith(v));
    case "contains":
      return isString(actual) && values.some((v) => isString(v) && actual.includes(v));
    case "matches":
      if (!isString(actual)) return false;
      return values.some((v) => {
        if (!isString(v)) return false;
        let re = cache?.get(v);
        if (!re) {
          try {
            re = new RegExp(v);
          } catch {
            return false;
          }
          cache?.set(v, re);
        }
        return re.test(actual);
      });
    case "lessThan":
      return isFiniteNumber(actual) && values.some((v) => isFiniteNumber(v) && actual < v);
    case "lessThanOrEqual":
      return isFiniteNumber(actual) && values.some((v) => isFiniteNumber(v) && actual <= v);
    case "greaterThan":
      return isFiniteNumber(actual) && values.some((v) => isFiniteNumber(v) && actual > v);
    case "greaterThanOrEqual":
      return isFiniteNumber(actual) && values.some((v) => isFiniteNumber(v) && actual >= v);
    case "before": {
      const a = parseDate(actual);
      if (a === null) return false;
      return values.some((v) => {
        const b = parseDate(v);
        return b !== null && a < b;
      });
    }
    case "after": {
      const a = parseDate(actual);
      if (a === null) return false;
      return values.some((v) => {
        const b = parseDate(v);
        return b !== null && a > b;
      });
    }
    case "semVerEqual": {
      const a = coerceSemver(actual);
      if (!a) return false;
      return values.some((v) => {
        const b = coerceSemver(v);
        return b !== null && semver.eq(a, b);
      });
    }
    case "semVerLessThan": {
      const a = coerceSemver(actual);
      if (!a) return false;
      return values.some((v) => {
        const b = coerceSemver(v);
        return b !== null && semver.lt(a, b);
      });
    }
    case "semVerGreaterThan": {
      const a = coerceSemver(actual);
      if (!a) return false;
      return values.some((v) => {
        const b = coerceSemver(v);
        return b !== null && semver.gt(a, b);
      });
    }
    default: {
      const _exhaustive: never = op;
      void _exhaustive;
      return false;
    }
  }
}
