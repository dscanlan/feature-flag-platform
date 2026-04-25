import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adminApiUrl, runtimePath, waitForRuntime } from "@ffp/e2e-stack";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");

let stackChild: ChildProcess | null = null;

export async function setup(): Promise<void> {
  if (await stackIsHealthy()) {
    if (!process.env.CI) {
      // Reuse a stack that's already running (developer left it up).
      log(`reusing existing stack at ${adminApiUrl}`);
      return;
    }
    log(`stack appears healthy but CI=true — restarting from clean state`);
  }
  await rm(runtimePath, { force: true });

  stackChild = spawn("pnpm", ["--filter", "@ffp/e2e-stack", "start"], {
    cwd: repoRoot,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
    // New process group so teardown can signal pnpm + node + admin-api +
    // resolver as a tree; SIGTERM to the pnpm wrapper alone is unreliable.
    detached: true,
  });
  stackChild.stdout?.on("data", (c: Buffer) => process.stdout.write(`[stack] ${c}`));
  stackChild.stderr?.on("data", (c: Buffer) => process.stderr.write(`[stack] ${c}`));
  stackChild.once("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      // eslint-disable-next-line no-console
      console.error(`[stack] exited code=${code} signal=${signal}`);
    }
  });

  await waitForRuntime(120_000);
  log(`stack ready`);
}

export async function teardown(): Promise<void> {
  if (!stackChild) return;
  if (stackChild.exitCode !== null || stackChild.signalCode) {
    stackChild = null;
    return;
  }
  const pid = stackChild.pid;
  if (pid === undefined) {
    stackChild = null;
    return;
  }
  killGroup(pid, "SIGTERM");
  await Promise.race([
    once(stackChild, "exit").catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ]);
  if (stackChild.exitCode === null && !stackChild.signalCode) {
    killGroup(pid, "SIGKILL");
  }
  stackChild = null;
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // group already gone
  }
}

async function stackIsHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${adminApiUrl}/api/v1/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[e2e-node global-setup] ${msg}`);
}
