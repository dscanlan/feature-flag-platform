import type {
  ApiError,
  Flag,
  FlagStageConfig,
  ResolverResolveResponse,
  Stage,
  Workspace,
} from "@ffp/shared-types";
import {
  adminApiUrl as defaultAdminApiUrl,
  adminEmail as defaultAdminEmail,
  adminPassword as defaultAdminPassword,
  appOrigin,
  defaultStageKey,
  defaultWorkspaceKey,
  resolverUrl as defaultResolverUrl,
  stackTimeoutMs,
} from "./constants.ts";
import { readRuntime, waitForRuntime, type StackRuntime } from "./runtime.ts";

type JsonBody = Record<string, unknown> | undefined;

interface SeedClientOptions {
  adminApiUrl?: string;
  resolverUrl?: string;
  publicKey?: string;
  workspaceKey?: string;
  stageKey?: string;
  adminEmail?: string;
  adminPassword?: string;
}

export interface StageContext {
  workspace: Workspace;
  stage: Stage;
}

export interface FlagDetail {
  flag: Flag;
  configs: FlagStageConfig[];
}

async function parseJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function isApiError(value: unknown): value is ApiError {
  return typeof value === "object" && value !== null && "error" in value;
}

export class SeedClient {
  private cookieHeader: string | null = null;

  constructor(private readonly options: Required<SeedClientOptions>) {}

  async login(): Promise<string> {
    if (this.cookieHeader) return this.cookieHeader;
    const res = await fetch(`${this.options.adminApiUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: this.options.adminEmail,
        password: this.options.adminPassword,
      }),
    });
    if (!res.ok) {
      throw new Error(`login failed with ${res.status}`);
    }
    const cookie = res.headers.getSetCookie?.()[0] ?? res.headers.get("set-cookie");
    if (!cookie) {
      throw new Error("login response did not include a cookie");
    }
    this.cookieHeader = cookie.split(";", 1)[0] ?? cookie;
    return this.cookieHeader;
  }

  async createWorkspace(key: string, name: string): Promise<Workspace> {
    return this.requestJson<Workspace>("POST", "/api/v1/workspaces", {
      key,
      name,
    });
  }

  async createStage(wsKey: string, key: string, name: string): Promise<Stage> {
    return this.requestJson<Stage>("POST", `/api/v1/workspaces/${wsKey}/stages`, {
      key,
      name,
    });
  }

  async ensureStage(): Promise<StageContext> {
    const workspace = await this.ensureWorkspace(this.options.workspaceKey, "E2E Web");
    const stage = await this.ensureStageForWorkspace(
      workspace.key,
      this.options.stageKey,
      "Playwright",
    );
    return { workspace, stage };
  }

  async ensureWorkspace(key: string, name: string): Promise<Workspace> {
    try {
      return await this.createWorkspace(key, name);
    } catch (err) {
      if (!String(err).includes("409")) throw err;
      return this.requestJson<Workspace>("GET", `/api/v1/workspaces/${key}`);
    }
  }

  async ensureStageForWorkspace(wsKey: string, key: string, name: string): Promise<Stage> {
    try {
      return await this.createStage(wsKey, key, name);
    } catch (err) {
      if (!String(err).includes("409")) throw err;
      const stages = await this.requestJson<Stage[]>("GET", `/api/v1/workspaces/${wsKey}/stages`);
      const stage = stages.find((item) => item.key === key);
      if (!stage) throw err;
      return stage;
    }
  }

  async ensureBooleanFlag(flagKey: string): Promise<FlagDetail> {
    return this.ensureFlag({
      key: flagKey,
      name: titleCase(flagKey),
      kind: "boolean",
    });
  }

  async ensureJsonFlag(
    flagKey: string,
    values: Array<{ value: unknown; name?: string; description?: string }>,
  ): Promise<FlagDetail> {
    return this.ensureFlag({
      key: flagKey,
      name: titleCase(flagKey),
      kind: "json",
      values,
    });
  }

  async getFlag(flagKey: string): Promise<FlagDetail> {
    return this.requestJson<FlagDetail>(
      "GET",
      `/api/v1/workspaces/${this.options.workspaceKey}/flags/${flagKey}`,
    );
  }

  async setFlagConfig(
    flagKey: string,
    config: Pick<
      FlagStageConfig,
      "enabled" | "disabledValueIndex" | "defaultServe" | "pinned" | "rules"
    >,
  ): Promise<FlagStageConfig> {
    return this.requestJson<FlagStageConfig>(
      "PUT",
      `/api/v1/workspaces/${this.options.workspaceKey}/flags/${flagKey}/stages/${this.options.stageKey}`,
      {
        enabled: config.enabled,
        disabledValueIndex: config.disabledValueIndex,
        defaultServe: config.defaultServe,
        pinned: config.pinned,
        rules: config.rules,
      },
    );
  }

  async toggleFlag(flagKey: string, enabled: boolean): Promise<FlagStageConfig> {
    return this.requestJson<FlagStageConfig>(
      "POST",
      `/api/v1/workspaces/${this.options.workspaceKey}/flags/${flagKey}/stages/${this.options.stageKey}/toggle`,
      { enabled },
    );
  }

  async setCorsOrigins(origins: string[]): Promise<Stage> {
    return this.requestJson<Stage>(
      "PATCH",
      `/api/v1/workspaces/${this.options.workspaceKey}/stages/${this.options.stageKey}`,
      { corsOrigins: origins },
    );
  }

  async rotateSubjectSigningSecret(): Promise<{ subjectSigningSecret: string }> {
    return this.requestJson<{ subjectSigningSecret: string }>(
      "POST",
      `/api/v1/workspaces/${this.options.workspaceKey}/stages/${this.options.stageKey}/subject-signing-secret/reset`,
      {},
    );
  }

  async resolve(body: Record<string, unknown>, init?: { origin?: string }): Promise<Response> {
    return fetch(`${this.options.resolverUrl}/sdk/resolve`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.publicKey}`,
        "content-type": "application/json",
        ...(init?.origin ? { origin: init.origin } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  async waitForBooleanFlagValue(
    flagKey: string,
    expected: boolean,
    body: Record<string, unknown> = { subject: { type: "user", id: "user-anon" } },
    timeoutMs: number = stackTimeoutMs,
  ): Promise<void> {
    await this.waitForResolve(
      async () => {
        const res = await this.resolve(body);
        if (!res.ok) return false;
        const payload = (await parseJson<ResolverResolveResponse>(res)).results[flagKey];
        return payload?.value === expected;
      },
      timeoutMs,
      `flag ${flagKey} == ${expected}`,
    );
  }

  async waitForCors(
    origin: string,
    allowed: boolean,
    timeoutMs: number = stackTimeoutMs,
  ): Promise<void> {
    await this.waitForResolve(
      async () => {
        const res = await fetch(`${this.options.resolverUrl}/sdk/resolve`, {
          method: "OPTIONS",
          headers: {
            origin,
            "access-control-request-method": "POST",
            "access-control-request-headers": "authorization,content-type",
          },
        });
        const acao = res.headers.get("access-control-allow-origin");
        return allowed ? acao === origin || acao === "*" : acao === null;
      },
      timeoutMs,
      `cors allowed=${allowed} for ${origin}`,
    );
  }

  private async ensureFlag(body: Record<string, unknown>): Promise<FlagDetail> {
    const flagKey = String(body.key);
    try {
      await this.requestJson<Flag>(
        "POST",
        `/api/v1/workspaces/${this.options.workspaceKey}/flags`,
        body,
      );
    } catch (err) {
      if (!String(err).includes("409")) throw err;
    }
    return this.getFlag(flagKey);
  }

  private async requestJson<T>(method: string, path: string, body?: JsonBody): Promise<T> {
    const cookie = await this.login();
    const res = await fetch(`${this.options.adminApiUrl}${path}`, {
      method,
      headers: {
        cookie,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const contentType = res.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json") ? await parseJson<unknown>(res) : null;

    if (!res.ok) {
      const error = isApiError(payload) ? payload.error.code : "UNKNOWN";
      throw new Error(`${method} ${path} failed with ${res.status} ${error}`);
    }

    return payload as T;
  }

  private async waitForResolve(
    check: () => Promise<boolean>,
    timeoutMs: number,
    label: string,
  ): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await check()) return;
      await sleep(150);
    }
    throw new Error(`timed out waiting for ${label}`);
  }
}

export async function getRuntime(): Promise<StackRuntime> {
  return readRuntime();
}

export async function createSeedClient(
  options: SeedClientOptions = {},
): Promise<{ runtime: StackRuntime; seed: SeedClient }> {
  const runtime = await waitForRuntime();
  return {
    runtime,
    seed: new SeedClient({
      adminApiUrl: options.adminApiUrl ?? runtime.adminApiUrl ?? defaultAdminApiUrl,
      resolverUrl: options.resolverUrl ?? runtime.resolverUrl ?? defaultResolverUrl,
      publicKey: options.publicKey ?? runtime.publicKey,
      workspaceKey: options.workspaceKey ?? runtime.workspaceKey ?? defaultWorkspaceKey,
      stageKey: options.stageKey ?? runtime.stageKey ?? defaultStageKey,
      adminEmail: options.adminEmail ?? runtime.adminEmail ?? defaultAdminEmail,
      adminPassword: options.adminPassword ?? runtime.adminPassword ?? defaultAdminPassword,
    }),
  };
}

export async function waitForStack(): Promise<StackRuntime> {
  return waitForRuntime();
}

export { appOrigin };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function titleCase(input: string): string {
  return input
    .split("-")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}
