import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { sidecarPort } from "../../e2e-stack/src/constants.ts";
import { waitForRuntime } from "../../e2e-stack/src/runtime.ts";
import { signSubjectToken } from "@ffp/resolver/src/tokens.ts";

interface JsonBody {
  userId?: string;
}

const server = createServer(async (req, res) => {
  try {
    setCorsHeaders(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const runtime = await waitForRuntime();

    if (req.method === "GET" && req.url === "/runtime") {
      return sendJson(res, 200, {
        resolverUrl: "/resolver",
        directResolverUrl: runtime.resolverUrl,
        publicKey: runtime.publicKey,
        pollIntervalMs: runtime.pollIntervalMs,
        users: runtime.users,
      });
    }

    if (req.method === "POST" && (req.url === "/sign-subject-token" || req.url === "/sign-bad-token")) {
      const body = await readBody(req);
      const userId = body.userId ?? runtime.users[0] ?? "user-anon";
      const now = Math.floor(Date.now() / 1000);
      const secret =
        req.url === "/sign-bad-token"
          ? "wrong-secret-for-negative-path-32-chars"
          : runtime.subjectSigningSecret;
      const token = signSubjectToken(secret, {
        sub: { type: "user", id: userId },
        iat: now,
        exp: now + 60,
      });
      return sendJson(res, 200, { token });
    }

    sendJson(res, 404, { error: "not found" });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
});

server.listen(sidecarPort, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`[e2e-sidecar] listening on ${sidecarPort}`);
});

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}

async function readBody(req: IncomingMessage): Promise<JsonBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as JsonBody) : {};
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
