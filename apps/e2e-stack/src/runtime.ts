import { mkdir, readFile, writeFile } from "node:fs/promises";
import { runtimeDir, runtimePath } from "./constants.ts";

export interface StackRuntime {
  adminApiUrl: string;
  resolverUrl: string;
  appOrigin: string;
  sidecarUrl: string;
  adminEmail: string;
  adminPassword: string;
  workspaceKey: string;
  stageKey: string;
  publicKey: string;
  serverKey: string;
  subjectSigningSecret: string;
  pollIntervalMs: number;
  users: string[];
}

export async function writeRuntime(runtime: StackRuntime): Promise<void> {
  await mkdir(runtimeDir, { recursive: true });
  await writeFile(runtimePath, JSON.stringify(runtime, null, 2) + "\n", "utf8");
}

export async function readRuntime(): Promise<StackRuntime> {
  const raw = await readFile(runtimePath, "utf8");
  return JSON.parse(raw) as StackRuntime;
}

export async function waitForRuntime(timeoutMs: number = 30_000): Promise<StackRuntime> {
  const started = Date.now();
  let lastErr: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      return await readRuntime();
    } catch (err) {
      lastErr = err;
      await sleep(250);
    }
  }
  throw new Error(`timed out waiting for runtime at ${runtimePath}: ${String(lastErr)}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
