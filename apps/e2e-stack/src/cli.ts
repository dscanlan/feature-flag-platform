import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, rm } from "node:fs/promises";
import { Pool } from "pg";
import {
  adminApiPort,
  adminApiUrl,
  adminEmail,
  adminPassword,
  appOrigin,
  composePath,
  cookieSecret,
  databaseUrl,
  defaultPollIntervalMs,
  defaultStageKey,
  defaultStageName,
  defaultWorkspaceKey,
  defaultWorkspaceName,
  redisUrl,
  repoRoot,
  resolverPort,
  resolverUrl,
  runtimeDir,
  runtimePath,
  sidecarUrl,
  stackTimeoutMs,
  streamTokenSecret,
  users,
} from "./constants.ts";
import { SeedClient } from "./seed.ts";
import { writeRuntime } from "./runtime.ts";

async function main(): Promise<void> {
  await mkdir(runtimeDir, { recursive: true });
  await rm(runtimePath, { force: true });

  await runCommand("docker", ["compose", "-f", composePath, "up", "-d", "--wait"]);
  await resetDatabase();

  const admin = spawnService(
    "admin-api",
    ["--filter", "@ffp/admin-api", "exec", "node", "--import", "tsx", "src/server.ts"],
    {
      PORT: String(adminApiPort),
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      MIGRATE_ON_BOOT: "true",
      ADMIN_EMAIL: adminEmail,
      ADMIN_PASSWORD: adminPassword,
      COOKIE_SECRET: cookieSecret,
      NODE_ENV: "test",
      LOG_LEVEL: "warn",
    },
  );
  await waitForHttp(`${adminApiUrl}/api/v1/health`, (res) => res.ok, "admin-api health");

  const resolver = spawnService(
    "resolver",
    ["--filter", "@ffp/resolver", "exec", "node", "--import", "tsx", "src/server.ts"],
    {
      PORT: String(resolverPort),
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      NODE_ENV: "test",
      LOG_LEVEL: "warn",
      STREAM_TOKEN_SECRET: streamTokenSecret,
      RATE_LIMIT_RPS: "10000",
      RATE_LIMIT_BURST: "10000",
    },
  );
  await waitForHttp(`${resolverUrl}/sdk/stream`, () => true, "resolver");

  const seed = new SeedClient({
    adminApiUrl,
    resolverUrl,
    publicKey: "pub-placeholder",
    workspaceKey: defaultWorkspaceKey,
    stageKey: defaultStageKey,
    adminEmail,
    adminPassword,
  });
  const { workspace, stage } = await seed.ensureStage();
  await writeRuntime({
    adminApiUrl,
    resolverUrl,
    appOrigin,
    sidecarUrl,
    adminEmail,
    adminPassword,
    workspaceKey: workspace.key,
    stageKey: stage.key,
    publicKey: stage.publicKey,
    serverKey: stage.serverKey,
    subjectSigningSecret: stage.subjectSigningSecret ?? "",
    pollIntervalMs: defaultPollIntervalMs,
    users: [...users],
  });

  log(`runtime ready at ${runtimePath}`);
  await waitForShutdown([admin, resolver]);
}

function spawnService(name: string, args: string[], env: Record<string, string>): ChildProcess {
  const child = spawn("pnpm", args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipeOutput(name, child);
  child.once("exit", (code, signal) => {
    if (!shuttingDown) {
      // eslint-disable-next-line no-console
      console.error(`[${name}] exited unexpectedly code=${code} signal=${signal}`);
      process.exit(code ?? 1);
    }
  });
  return child;
}

function pipeOutput(name: string, child: ChildProcess): void {
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    process.stdout.write(`[${name}] ${chunk}`);
  });
  child.stderr?.on("data", (chunk: string) => {
    process.stderr.write(`[${name}] ${chunk}`);
  });
}

async function resetDatabase(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query("GRANT ALL ON SCHEMA public TO public");
  } finally {
    await pool.end();
  }
}

async function runCommand(command: string, args: string[]): Promise<void> {
  const child = spawn(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
  });
  const [code, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
  if (code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with code=${code} signal=${signal}`);
  }
}

async function waitForHttp(
  url: string,
  check: (res: Response) => boolean,
  label: string,
): Promise<void> {
  const started = Date.now();
  let lastErr: unknown;
  while (Date.now() - started < stackTimeoutMs) {
    try {
      const res = await fetch(url);
      if (check(res)) return;
      lastErr = `status ${res.status}`;
    } catch (err) {
      lastErr = err;
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${label}: ${String(lastErr)}`);
}

let shuttingDown = false;

async function waitForShutdown(children: ChildProcess[]): Promise<void> {
  await new Promise<void>((resolve) => {
    const onSignal = (signal: NodeJS.Signals) => {
      log(`received ${signal}, shutting down`);
      shuttingDown = true;
      void Promise.all(children.map((child) => stopChild(child))).then(() => resolve());
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.killed || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await once(child, "exit").catch(() => undefined);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[e2e-stack] ${message}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[e2e-stack] fatal", err);
  process.exit(1);
});
