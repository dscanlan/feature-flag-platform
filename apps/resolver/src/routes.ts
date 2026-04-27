import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Pool } from "pg";
import { resolve } from "@ffp/resolver-engine";
import type {
  Resolution,
  ResolverFlagsResponse,
  ResolverResolveResponse,
  Subject,
} from "@ffp/shared-types";
import { bearer, makeAuthHook } from "./auth.js";
import type { RulesetStore } from "./store.js";
import type { StreamHub } from "./streamHub.js";
import type { RateLimit } from "./rateLimit.js";
import { persistSubjects } from "./subjects.js";
import { signStreamToken, subjectFingerprint, verifySubjectToken } from "./tokens.js";

const subjectSchema: z.ZodType<Subject> = z.union([
  z.object({
    type: z.literal("composite"),
    subjects: z.record(z.record(z.unknown())),
  }) as z.ZodType<Subject>,
  z
    .object({
      type: z
        .string()
        .refine((s) => s !== "composite", "use { type: 'composite', subjects: {...} }"),
      id: z.string().min(1),
    })
    .passthrough() as z.ZodType<Subject>,
]);

// One of `subject` or `subjectToken` must be present. We accept both for ease
// of incremental migration but if subjectToken verifies, it wins (it's the
// trusted form).
const resolveBodySchema = z.object({
  subject: subjectSchema.optional(),
  subjectToken: z.string().min(1).optional(),
});

export interface SdkRoutesOptions {
  streamTokenSecret: string;
  streamTokenTtlSec: number;
}

export function registerSdkRoutes(
  app: FastifyInstance,
  store: RulesetStore,
  hub: StreamHub,
  rateLimit: RateLimit,
  pool: Pool,
  opts: SdkRoutesOptions,
): void {
  const requireServer = makeAuthHook(store, ["server"]);
  const requirePublic = makeAuthHook(store, ["public"]);
  // /sdk/stream additionally accepts `sst-` tokens issued from /sdk/resolve.
  const requireStreamAuth = makeAuthHook(store, ["server", "public", "stream"], {
    streamTokenSecret: opts.streamTokenSecret,
  });

  // Rate-limit hook: keys the token bucket by the Bearer token so
  // per-workspace traffic can't starve other workspaces. Returns 429 with a
  // Retry-After header (rounded up to whole seconds) when exhausted.
  async function rateLimitHook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const key = bearer(req);
    if (!key) return;
    const wait = rateLimit.consume(key);
    if (wait !== null) {
      reply
        .code(429)
        .header("Retry-After", String(Math.max(1, Math.ceil(wait))))
        .send({ error: { code: "RATE_LIMITED", message: "rate limit exceeded" } });
    }
  }

  app.get("/sdk/flags", { preHandler: [requireServer, rateLimitHook] }, async (req) => {
    const ruleset = req.ruleset!;
    const body: ResolverFlagsResponse = {
      stage: { id: ruleset.stage.id, key: ruleset.stage.key, version: ruleset.stage.version },
      flags: ruleset.flags,
      configs: ruleset.configs,
      audiences: ruleset.audiences,
      subjectTypes: ruleset.subjectTypes,
    };
    return body;
  });

  app.post("/sdk/resolve", { preHandler: [requirePublic, rateLimitHook] }, async (req, reply) => {
    const ruleset = req.ruleset!;
    const parsed = resolveBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: "MALFORMED_SUBJECT",
          message: "invalid body",
          details: parsed.error.issues,
        },
      });
    }

    // Resolve the subject: signed token wins if present and valid.
    let subject: Subject | null = null;
    if (parsed.data.subjectToken) {
      const secret = ruleset.stage.subjectSigningSecret;
      const tokenPayload = secret ? verifySubjectToken(secret, parsed.data.subjectToken) : null;
      if (!tokenPayload) {
        return reply.code(401).send({
          error: { code: "BAD_SUBJECT_TOKEN", message: "subjectToken invalid or expired" },
        });
      }
      // Validate the embedded subject shape — a host backend could in theory
      // sign garbage, and we don't want garbage flowing into evaluation.
      const subjectCheck = subjectSchema.safeParse(tokenPayload.sub);
      if (!subjectCheck.success) {
        return reply.code(400).send({
          error: { code: "MALFORMED_SUBJECT", message: "subjectToken payload is malformed" },
        });
      }
      subject = subjectCheck.data;
    } else if (parsed.data.subject) {
      subject = parsed.data.subject;
    } else {
      return reply.code(400).send({
        error: { code: "MALFORMED_SUBJECT", message: "subject or subjectToken required" },
      });
    }

    // Fire subject persistence in parallel with resolution. We `void` the
    // promise — flag evaluation must not wait on (or fail on) Postgres
    // writes. Failures are logged inside persistSubjects.
    void persistSubjects({
      pool,
      workspaceId: ruleset.stage.workspaceId,
      stageId: ruleset.stage.id,
      subject,
      source: "sdk-resolve",
      log: req.log,
    });

    const results: ResolverResolveResponse["results"] = {};
    for (const flag of ruleset.flags) {
      const config = ruleset.configsByFlagId.get(flag.id);
      if (!config) {
        results[flag.key] = {
          value: null,
          valueIndex: null,
          reason: { kind: "error", code: "FLAG_NOT_FOUND" },
          kind: flag.kind,
        };
        continue;
      }
      const r: Resolution = resolve({
        flag,
        config,
        subject,
        audiencesById: ruleset.audiencesById,
        stageId: ruleset.stage.id,
        subjectTypes: ruleset.subjectTypes,
      });
      results[flag.key] = {
        value: r.value,
        valueIndex: r.valueIndex,
        reason: r.reason,
        kind: flag.kind,
      };
    }

    // Issue a stream token bound to (stage, subject fingerprint, exp).
    const exp = Math.floor(Date.now() / 1000) + opts.streamTokenTtlSec;
    const streamToken = signStreamToken(opts.streamTokenSecret, {
      s: ruleset.stage.id,
      f: subjectFingerprint(subject),
      exp,
    });

    const body: ResolverResolveResponse = {
      stage: { id: ruleset.stage.id, key: ruleset.stage.key, version: ruleset.stage.version },
      streamToken,
      streamTokenExp: exp,
      results,
    };
    return body;
  });

  app.get("/sdk/stream", { preHandler: [requireStreamAuth, rateLimitHook] }, async (req, reply) => {
    const ruleset = req.ruleset!;
    // Set headers via reply so @fastify/cors's onSend hook can attach
    // Access-Control-Allow-Origin etc. Then hijack and flush so we own the
    // socket for the lifetime of the stream.
    reply.header("Content-Type", "text/event-stream");
    reply.header("Cache-Control", "no-cache, no-transform");
    reply.header("Connection", "keep-alive");
    reply.header("X-Accel-Buffering", "no");
    reply.hijack();
    reply.raw.writeHead(200, reply.getHeaders() as Record<string, string | string[]>);
    const send = (event: string, data: unknown): void => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    send("ready", { version: ruleset.stage.version });

    const off = hub.onChange(ruleset.stage.id, (version) => {
      send("change", { version });
    });
    const heartbeat = setInterval(() => send("ping", {}), 25_000);
    req.raw.on("close", () => {
      clearInterval(heartbeat);
      off();
    });

    return reply;
  });
}
