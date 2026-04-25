import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appPath = path.resolve(here, "..", "..", "src", "app.ts");

export interface HostHandle {
  url: string;
  port: number;
  child: ChildProcess;
  stop(): Promise<void>;
  /** Returns the stdout/stderr accumulated so far. */
  output(): string;
}

export interface SpawnHostOptions {
  resolverUrl: string;
  serverKey: string;
  publicKey?: string;
  /** Extra env to inject (e.g. logging). */
  env?: Record<string, string | undefined>;
  /** Listening timeout. Defaults to 15s. */
  readyTimeoutMs?: number;
}

/**
 * Spawn the host application as a child process, parse its announced port
 * from stdout, and return a handle for HTTP calls + teardown. Child processes
 * are spawned via `node --import tsx` so we don't need a build step.
 */
export async function spawnHost(opts: SpawnHostOptions): Promise<HostHandle> {
  const env: Record<string, string> = {
    ...filterEnv(process.env),
    RESOLVER_URL: opts.resolverUrl,
    SERVER_KEY: opts.serverKey,
    E2E: "true",
    PORT: "0",
  };
  if (opts.publicKey) env.PUBLIC_KEY = opts.publicKey;
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      if (v !== undefined) env[k] = v;
    }
  }

  const child = spawn("node", ["--import", "tsx", appPath], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    // Detached so the host gets its own process group — protects it from
    // signals targeted at sibling resolver children (which we kill/restart
    // mid-test).
    detached: true,
  });
  child.unref();

  let buffer = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  const showLogs = process.env.E2E_DEBUG === "true";
  child.stdout?.on("data", (chunk: string) => {
    buffer += chunk;
    if (showLogs) process.stdout.write(`[host] ${chunk}`);
  });
  child.stderr?.on("data", (chunk: string) => {
    buffer += chunk;
    if (showLogs) process.stderr.write(`[host] ${chunk}`);
  });

  const port = await waitForListening(child, () => buffer, opts.readyTimeoutMs ?? 15_000);

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    child,
    output: () => buffer,
    async stop() {
      if (child.exitCode !== null || child.signalCode) return;
      child.kill("SIGTERM");
      await Promise.race([
        once(child, "exit").catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 3_000)),
      ]);
      if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
    },
  };
}

async function waitForListening(
  child: ChildProcess,
  read: () => string,
  timeoutMs: number,
): Promise<number> {
  const started = Date.now();
  let exited: number | null = null;
  child.once("exit", (code) => {
    exited = code ?? -1;
  });
  while (Date.now() - started < timeoutMs) {
    const m = /E2E_HOST_LISTENING port=(\d+)/.exec(read());
    if (m) return Number(m[1]);
    if (exited !== null) {
      throw new Error(`host app exited (code=${exited}) before listening:\n${read()}`);
    }
    await sleep(50);
  }
  child.kill("SIGKILL");
  throw new Error(`host app did not listen within ${timeoutMs}ms:\n${read()}`);
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
