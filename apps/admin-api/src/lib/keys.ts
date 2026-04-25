import { randomBytes } from "node:crypto";

const KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isValidKey(key: string): boolean {
  return KEY_RE.test(key);
}

export function generateServerKey(): string {
  return "srv-" + randomBytes(32).toString("base64url");
}

export function generatePublicKey(): string {
  return "pub-" + randomBytes(16).toString("base64url");
}

/** 256-bit HMAC key, base64-encoded to stay printable. */
export function generateSubjectSigningSecret(): string {
  return randomBytes(32).toString("base64");
}
