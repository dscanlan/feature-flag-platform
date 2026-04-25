import { createHmac, timingSafeEqual } from "node:crypto";
import type { Subject } from "@ffp/shared-types";

/**
 * Signed-token primitives — PLAN.md §7.6.
 *
 * Two flavors share the same wire format:
 *   <prefix>-<base64url(payloadJson)>.<base64url(hmac)>
 *
 *   - `sst-` (Stream Subscription Token): issued by the resolver from
 *     /sdk/resolve, required by /sdk/stream. Bound to (stage, subject
 *     fingerprint, exp). Verified against an env-scoped resolver secret.
 *
 *   - `sjt-` (Subject Token): issued by the host app's backend, sent by the
 *     SDK in /sdk/resolve. Carries the trusted `subject` claims the browser is
 *     allowed to resolve against. Verified against the per-stage signing
 *     secret stored on `stages.subject_signing_secret`.
 *
 * HMAC-SHA256 over the JSON payload bytes. Constant-time signature compare.
 * Tokens are stateless — verification = signature + exp check.
 */

export interface StreamTokenPayload {
  /** Stage UUID. */
  s: string;
  /** Subject fingerprint — opaque to the client, useful for revocation later. */
  f: string;
  /** Expiry, seconds since epoch. */
  exp: number;
}

export interface SubjectTokenPayload {
  /** Subject claims the host backend trusts the browser to use. */
  sub: Subject;
  /** Expiry, seconds since epoch. */
  exp: number;
  /** Optional issued-at, seconds since epoch. */
  iat?: number;
}

export type TokenPrefix = "sst" | "sjt";

const TOKEN_RE = /^(sst|sjt)-([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;

function b64urlEncode(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

function hmac(secret: string, payloadB64: string): Buffer {
  return createHmac("sha256", secret).update(payloadB64).digest();
}

function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function sign<T>(prefix: TokenPrefix, secret: string, payload: T): string {
  const json = JSON.stringify(payload);
  const payloadB64 = b64urlEncode(json);
  const sig = b64urlEncode(hmac(secret, payloadB64));
  return `${prefix}-${payloadB64}.${sig}`;
}

function verify<T>(
  expectedPrefix: TokenPrefix,
  secret: string,
  token: string,
  nowSec: number,
): T | null {
  const m = TOKEN_RE.exec(token);
  if (!m) return null;
  const [, prefix, payloadB64, sigB64] = m as unknown as [string, TokenPrefix, string, string];
  if (prefix !== expectedPrefix) return null;
  const expected = hmac(secret, payloadB64);
  const actual = b64urlDecode(sigB64);
  if (!constantTimeEqual(expected, actual)) return null;
  let payload: T;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8")) as T;
  } catch {
    return null;
  }
  // exp is seconds since epoch — refuse expired or missing.
  const exp = (payload as unknown as { exp?: unknown }).exp;
  if (typeof exp !== "number" || exp <= nowSec) return null;
  return payload;
}

export function signStreamToken(secret: string, payload: StreamTokenPayload): string {
  return sign("sst", secret, payload);
}

export function verifyStreamToken(
  secret: string,
  token: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): StreamTokenPayload | null {
  return verify<StreamTokenPayload>("sst", secret, token, nowSec);
}

export function signSubjectToken(secret: string, payload: SubjectTokenPayload): string {
  return sign("sjt", secret, payload);
}

export function verifySubjectToken(
  secret: string,
  token: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): SubjectTokenPayload | null {
  return verify<SubjectTokenPayload>("sjt", secret, token, nowSec);
}

/**
 * Stable, opaque fingerprint for a subject — used in stream tokens so
 * verification can later compare the connecting subject to the one the
 * resolve was issued against. We hash the canonical JSON; this is not a
 * security-critical hash so a 64-bit prefix of SHA-256 is plenty.
 */
export function subjectFingerprint(subject: Subject): string {
  // Canonicalise key order for composite subjects so the fingerprint is
  // stable across payload re-orderings. Single subjects use type + id, which
  // is the identity that matters for resolution.
  let canonical: string;
  if (subject.type === "composite") {
    const subs = subject.subjects as unknown as Record<string, Record<string, unknown>>;
    const sorted = Object.keys(subs)
      .sort()
      .map((k) => {
        const id = subs[k]?.id;
        return `${k}:${typeof id === "string" ? id : ""}`;
      });
    canonical = `composite|${sorted.join("|")}`;
  } else {
    const single = subject as unknown as Record<string, unknown>;
    canonical = `${subject.type}|${typeof single.id === "string" ? single.id : ""}`;
  }
  return createHmac("sha256", "ffp-fp").update(canonical).digest("base64url").slice(0, 22);
}
