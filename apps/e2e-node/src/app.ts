import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createServerClient } from "@ffp/sdk/server";
import type { Subject } from "@ffp/shared-types";

const RESOLVER_URL = required("RESOLVER_URL");
const SERVER_KEY = required("SERVER_KEY");
const PUBLIC_KEY = process.env.PUBLIC_KEY;
const PORT = Number(process.env.PORT ?? 0);

let lastError: unknown = null;
let lastWarn: { msg: string; meta: unknown } | null = null;

const flags = createServerClient({
  baseUrl: RESOLVER_URL,
  serverKey: SERVER_KEY,
  subject: { type: "user", id: "anonymous" },
  streaming: process.env.SDK_STREAMING !== "false",
  pollIntervalMs: process.env.SDK_POLL_MS ? Number(process.env.SDK_POLL_MS) : undefined,
  logger: (level, msg, meta) => {
    if (level === "warn") lastWarn = { msg, meta };
  },
});
flags.on("error", (info) => {
  lastError = info;
});
await flags.ready();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  res.setHeader("content-type", "application/json");

  if (url.pathname === "/debug/last-error") {
    res.end(JSON.stringify({ lastError }));
    return;
  }
  if (url.pathname === "/debug/last-warn") {
    res.end(JSON.stringify({ lastWarn }));
    return;
  }
  if (url.pathname === "/debug/state") {
    res.end(JSON.stringify(flags.getState()));
    return;
  }
  if (url.pathname === "/debug/all") {
    res.end(JSON.stringify(flags.allFlags()));
    return;
  }
  if (url.pathname === "/debug/reset") {
    lastError = null;
    lastWarn = null;
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (url.pathname === "/persist") {
    if (!PUBLIC_KEY) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: "PUBLIC_KEY not set" }));
      return;
    }
    const subject = subjectFromQuery(url);
    const r = await fetch(`${RESOLVER_URL}/sdk/resolve`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${PUBLIC_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ subject }),
    });
    res.statusCode = r.status;
    res.end(await r.text());
    return;
  }

  const subject = subjectFromQuery(url);
  await flags.setSubject(subject);

  const body: Record<string, unknown> = {
    subject,
    checkout: flags.boolFlag("new-checkout", false),
    pricing: flags.jsonFlag<{ tier: string }>("pricing", { tier: "free" }),
  };
  // Used by the wrong-type guard test to force a misuse on the JSON flag.
  if (url.searchParams.get("readPricingAsBool") === "1") {
    body.pricingAsBool = flags.boolFlag("pricing", false);
  }

  res.end(JSON.stringify(body));
});

server.listen(PORT, "127.0.0.1", () => {
  const addr = server.address() as AddressInfo;
  // The spawning helper parses this exact prefix to learn the port.
  process.stdout.write(`E2E_HOST_LISTENING port=${addr.port}\n`);
});

const shutdown = (signal: string): void => {
  process.stdout.write(`E2E_HOST_SHUTDOWN signal=${signal}\n`);
  flags.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2_000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} env required`);
  return v;
}

function subjectFromQuery(url: URL): Subject {
  const user = url.searchParams.get("user");
  const account = url.searchParams.get("account");
  const device = url.searchParams.get("device");
  const attrsRaw = url.searchParams.get("attrs");
  const attrs = attrsRaw ? (JSON.parse(attrsRaw) as Record<string, unknown>) : {};

  if (account || device) {
    const subjects: Record<string, Record<string, unknown>> = {};
    if (user) subjects.user = { id: user, ...attrs };
    if (account) subjects.account = { id: account };
    if (device) subjects.device = { id: device };
    return { type: "composite", subjects } as Subject;
  }
  return { type: "user", id: user ?? "anonymous", ...attrs } as Subject;
}
