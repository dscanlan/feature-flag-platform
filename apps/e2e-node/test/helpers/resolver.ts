import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");

export interface ResolverHandle {
  url: string;
  port: number;
  child: ChildProcess;
  stop(): Promise<void>;
  output(): string;
}

export interface SpawnResolverOptions {
  databaseUrl: string;
  redisUrl: string;
  streamTokenSecret: string;
  rateLimitRps?: number;
  rateLimitBurst?: number;
  /** Defaults to ephemeral. Pass to pin (used by the restart test). */
  port?: number;
  readyTimeoutMs?: number;
}

/**
 * Spawn an isolated resolver process via `node --import tsx src/server.ts`.
 * Used by tests that need their own rate-limit configuration or that need to
 * kill / restart the resolver without disturbing the shared stack.
 *
 * Postgres + Redis are shared with the e2e-stack so the spawned resolver
 * sees the same flag config the test seeded via the admin API.
 */
export async function spawnResolver(opts: SpawnResolverOptions): Promise<ResolverHandle> {
  const port = opts.port ?? (await pickPort());
  const env: Record<string, string> = {
    ...filterEnv(process.env),
    PORT: String(port),
    DATABASE_URL: opts.databaseUrl,
    REDIS_URL: opts.redisUrl,
    NODE_ENV: "test",
    LOG_LEVEL: process.env.E2E_DEBUG === "true" ? "debug" : "warn",
    STREAM_TOKEN_SECRET: opts.streamTokenSecret,
    RATE_LIMIT_RPS: String(opts.rateLimitRps ?? 10_000),
    RATE_LIMIT_BURST: String(opts.rateLimitBurst ?? 10_000),
  };

  const child = spawn(
    "pnpm",
    ["--filter", "@ffp/resolver", "exec", "node", "--import", "tsx", "src/server.ts"],
    {
      cwd: repoRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      // Detached so signals targeted at the resolver don't reach sibling
      // host children that share our process group.
      detached: true,
    },
  );
  child.unref();

  let buffer = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  const showLogs = process.env.E2E_DEBUG === "true";
  child.stdout?.on("data", (chunk: string) => {
    buffer += chunk;
    if (showLogs) process.stdout.write(`[resolver] ${chunk}`);
  });
  child.stderr?.on("data", (chunk: string) => {
    buffer += chunk;
    if (showLogs) process.stderr.write(`[resolver] ${chunk}`);
  });

  const url = `http://127.0.0.1:${port}`;
  await waitForUp(child, url, () => buffer, opts.readyTimeoutMs ?? 30_000);

  return {
    url,
    port,
    child,
    output: () => buffer,
    async stop() {
      if (child.exitCode !== null || child.signalCode) return;
      child.kill("SIGTERM");
      await Promise.race([
        once(child, "exit").catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ]);
      if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
    },
  };
}

async function waitForUp(
  child: ChildProcess,
  url: string,
  read: () => string,
  timeoutMs: number,
): Promise<void> {
  const started = Date.now();
  let exited: number | null = null;
  child.once("exit", (code) => {
    exited = code ?? -1;
  });
  while (Date.now() - started < timeoutMs) {
    if (exited !== null) {
      throw new Error(`resolver exited (code=${exited}) before listening:\n${read()}`);
    }
    try {
      const r = await fetch(`${url}/sdk/stream`, { signal: AbortSignal.timeout(500) });
      // Any response (incl. 401) means the server is up; 401 because no auth.
      if (r.status > 0) return;
    } catch {
      /* not yet */
    }
    await sleep(100);
  }
  child.kill("SIGKILL");
  throw new Error(`resolver did not listen within ${timeoutMs}ms:\n${read()}`);
}

function pickPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close();
      if (addr && typeof addr === "object") resolve(addr.port);
      else reject(new Error("no port"));
    });
  });
}

function filterEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
