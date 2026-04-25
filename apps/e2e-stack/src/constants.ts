import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const stackRoot = path.resolve(here, "..");
export const repoRoot = path.resolve(stackRoot, "..", "..");
export const composePath = path.join(stackRoot, "docker-compose.e2e.yml");
export const runtimeDir = path.join(stackRoot, ".runtime");
export const runtimePath = path.join(runtimeDir, "stack.json");

export const adminApiPort = 4100;
export const resolverPort = 4101;
export const appPort = 5180;
export const sidecarPort = 5181;

export const databaseUrl = "postgres://flags:flags@127.0.0.1:5434/flags";
export const redisUrl = "redis://127.0.0.1:6381/15";

export const adminApiUrl = `http://127.0.0.1:${adminApiPort}`;
export const resolverUrl = `http://127.0.0.1:${resolverPort}`;
export const appOrigin = `http://127.0.0.1:${appPort}`;
export const sidecarUrl = `http://127.0.0.1:${sidecarPort}`;

export const adminEmail = "e2e-admin@example.com";
export const adminPassword = "e2e-password-123";
export const cookieSecret = "e2e-cookie-secret-must-be-32-chars-long-aa";
export const streamTokenSecret = "e2e-stream-token-secret-must-be-32-chars-aa";

export const defaultWorkspaceKey = "e2e-web";
export const defaultStageKey = "playwright";
export const defaultWorkspaceName = "E2E Web";
export const defaultStageName = "Playwright";
export const defaultPollIntervalMs = 1_500;

export const users = ["user-anon", "user-pinned", "user-vip"] as const;

export const stackTimeoutMs = 30_000;
