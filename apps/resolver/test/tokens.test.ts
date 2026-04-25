import { describe, expect, it } from "vitest";
import {
  signStreamToken,
  signSubjectToken,
  subjectFingerprint,
  verifyStreamToken,
  verifySubjectToken,
} from "../src/tokens.js";

const SECRET = "test-secret-must-be-at-least-32-chars-long";

describe("token utilities", () => {
  it("round-trips a stream token", () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = signStreamToken(SECRET, { s: "stage-1", f: "fp-1", exp });
    const v = verifyStreamToken(SECRET, token);
    expect(v).toEqual({ s: "stage-1", f: "fp-1", exp });
  });

  it("rejects a tampered payload", () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = signStreamToken(SECRET, { s: "stage-1", f: "fp-1", exp });
    const [prefix, body] = token.split("-");
    const [payloadB64, sig] = body!.split(".");
    // Flip the stage id in the payload but keep the signature → must reject.
    const evil = Buffer.from(JSON.stringify({ s: "stage-2", f: "fp-1", exp })).toString(
      "base64url",
    );
    const forged = `${prefix}-${evil}.${sig}`;
    expect(verifyStreamToken(SECRET, forged)).toBeNull();
    // Untouched original still verifies.
    expect(verifyStreamToken(SECRET, `${prefix}-${payloadB64}.${sig}`)).not.toBeNull();
  });

  it("rejects the wrong secret", () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = signStreamToken(SECRET, { s: "stage-1", f: "fp-1", exp });
    expect(verifyStreamToken("different-secret-also-32-chars-long-aaa", token)).toBeNull();
  });

  it("rejects an expired token", () => {
    const past = Math.floor(Date.now() / 1000) - 1;
    const token = signStreamToken(SECRET, { s: "stage-1", f: "fp-1", exp: past });
    expect(verifyStreamToken(SECRET, token)).toBeNull();
  });

  it("subject and stream prefixes don't cross-verify", () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const sjt = signSubjectToken(SECRET, {
      sub: { type: "user", id: "u-1" },
      exp,
    });
    expect(verifyStreamToken(SECRET, sjt)).toBeNull();
    const sst = signStreamToken(SECRET, { s: "s", f: "f", exp });
    expect(verifySubjectToken(SECRET, sst)).toBeNull();
  });

  it("round-trips a subject token with composite payload", () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const subject = {
      type: "composite" as const,
      subjects: {
        user: { id: "u-1", plan: "pro" },
        account: { id: "acc-7", tier: "enterprise" },
      },
    };
    const token = signSubjectToken(SECRET, { sub: subject, exp, iat: 0 });
    const v = verifySubjectToken(SECRET, token);
    expect(v?.sub).toEqual(subject);
  });

  it("subjectFingerprint is stable across composite key reorderings", () => {
    const a = subjectFingerprint({
      type: "composite",
      subjects: { user: { id: "u" }, account: { id: "a" } },
    });
    const b = subjectFingerprint({
      type: "composite",
      subjects: { account: { id: "a" }, user: { id: "u" } },
    });
    expect(a).toBe(b);
  });

  it("subjectFingerprint differs for different ids", () => {
    const a = subjectFingerprint({ type: "user", id: "u-1" });
    const b = subjectFingerprint({ type: "user", id: "u-2" });
    expect(a).not.toBe(b);
  });
});
