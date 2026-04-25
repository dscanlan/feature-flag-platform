import type { FastifyReply, FastifyRequest } from "fastify";
import type { RulesetStore, StageRuleset } from "./store.js";
import { verifyStreamToken } from "./tokens.js";

export type KeyKind = "server" | "public" | "stream";

declare module "fastify" {
  interface FastifyRequest {
    ruleset?: StageRuleset;
    keyKind?: KeyKind;
    /** Set when authenticated via an `sst-` token. */
    streamSubjectFingerprint?: string;
  }
}

export function bearer(req: FastifyRequest): string | null {
  const auth = req.headers.authorization;
  if (!auth) return null;
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return m?.[1] ?? null;
}

export interface AuthHookOptions {
  /** When set, `sst-` tokens are also accepted (verified with this secret). */
  streamTokenSecret?: string;
}

export function makeAuthHook(
  store: RulesetStore,
  allowed: KeyKind[],
  options: AuthHookOptions = {},
) {
  return async function authHook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const key = bearer(req);
    if (!key) {
      reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "missing bearer" } });
      return;
    }
    let kind: KeyKind | null = null;
    let ruleset: StageRuleset | undefined;
    let streamFp: string | undefined;
    if (key.startsWith("srv-")) {
      kind = "server";
      ruleset = store.byServerKey.get(key);
    } else if (key.startsWith("pub-")) {
      kind = "public";
      ruleset = store.byPublicKey.get(key);
    } else if (key.startsWith("sst-") && options.streamTokenSecret) {
      const payload = verifyStreamToken(options.streamTokenSecret, key);
      if (payload) {
        ruleset = store.byStageId.get(payload.s);
        if (ruleset) {
          kind = "stream";
          streamFp = payload.f;
        }
      }
    }
    if (!ruleset || !kind) {
      reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "invalid key" } });
      return;
    }
    if (!allowed.includes(kind)) {
      reply
        .code(403)
        .send({ error: { code: "FORBIDDEN", message: `${kind} key not allowed here` } });
      return;
    }
    req.ruleset = ruleset;
    req.keyKind = kind;
    if (streamFp) req.streamSubjectFingerprint = streamFp;
  };
}
