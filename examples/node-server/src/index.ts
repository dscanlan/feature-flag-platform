/* eslint-disable no-console */
import { createServer } from "node:http";
import { createServerClient } from "@ffp/sdk/server";

const RESOLVER_URL = process.env.RESOLVER_URL ?? "http://localhost:8080";
const SERVER_KEY = process.env.SERVER_KEY ?? "srv-replace-me";
const PORT = Number(process.env.PORT ?? 3000);

const flags = createServerClient({
  baseUrl: RESOLVER_URL,
  serverKey: SERVER_KEY,
  subject: { type: "user", id: "anonymous" },
  logger: (level, msg, meta) => console.log(`[ffp:${level}]`, msg, meta ?? ""),
});

await flags.ready();
console.log("ffp ready — initial flags:", flags.allFlags());

const server = createServer(async (req, res) => {
  const userId = new URL(req.url ?? "/", "http://x").searchParams.get("user") ?? "anonymous";
  await flags.setSubject({ type: "user", id: userId });
  const checkout = flags.boolFlag("new-checkout", false);
  const pricing = flags.jsonFlag<{ tier: string }>("pricing", { tier: "free" });
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ user: userId, checkout, pricing }, null, 2));
});

server.listen(PORT, () => console.log(`listening on http://localhost:${PORT}`));

process.on("SIGINT", () => {
  flags.close();
  server.close(() => process.exit(0));
});
