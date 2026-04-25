import type {
  Audience,
  AudienceMember,
  AudienceRule,
  Flag,
  FlagStageConfig,
  FlagValue,
  MatchRule,
  PersistedSubject,
  PinnedSubject,
  ServeSpec,
  Stage,
  SubjectType,
  Workspace,
} from "@ffp/shared-types";

const BASE = "/api/v1";

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const code = body?.error?.code ?? `HTTP_${res.status}`;
    const msg = body?.error?.message ?? res.statusText;
    const err = new Error(`${code}: ${msg}`) as Error & { status: number; code: string };
    err.status = res.status;
    err.code = code;
    throw err;
  }
  return body as T;
}

export const api = {
  // auth
  login: (email: string, password: string) =>
    http<{ ok: true }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => http<{ ok: true }>("/auth/logout", { method: "POST" }),
  me: () => http<{ userId: string | null }>("/me"),

  // workspaces
  listWorkspaces: () => http<Workspace[]>("/workspaces"),
  createWorkspace: (key: string, name: string) =>
    http<Workspace>("/workspaces", { method: "POST", body: JSON.stringify({ key, name }) }),

  // stages
  listStages: (wsKey: string) => http<Stage[]>(`/workspaces/${wsKey}/stages`),
  createStage: (wsKey: string, key: string, name: string) =>
    http<Stage>(`/workspaces/${wsKey}/stages`, {
      method: "POST",
      body: JSON.stringify({ key, name }),
    }),
  resetServerKey: (wsKey: string, stageKey: string) =>
    http<{ serverKey: string }>(`/workspaces/${wsKey}/stages/${stageKey}/server-key/reset`, {
      method: "POST",
    }),
  updateStageCors: (wsKey: string, stageKey: string, corsOrigins: string[]) =>
    http<Stage>(`/workspaces/${wsKey}/stages/${stageKey}`, {
      method: "PATCH",
      body: JSON.stringify({ corsOrigins }),
    }),

  // flags
  listFlags: (wsKey: string) => http<Flag[]>(`/workspaces/${wsKey}/flags`),
  createFlag: (wsKey: string, key: string, name: string, kind: "boolean" | "json" = "boolean") =>
    http<Flag>(`/workspaces/${wsKey}/flags`, {
      method: "POST",
      body: JSON.stringify({ key, name, kind }),
    }),
  createJsonFlag: (wsKey: string, key: string, name: string, values: FlagValue[]) =>
    http<Flag>(`/workspaces/${wsKey}/flags`, {
      method: "POST",
      body: JSON.stringify({ key, name, kind: "json", values }),
    }),
  getFlag: (wsKey: string, flagKey: string) =>
    http<{ flag: Flag; configs: FlagStageConfig[] }>(`/workspaces/${wsKey}/flags/${flagKey}`),
  toggleFlag: (wsKey: string, flagKey: string, stageKey: string, enabled: boolean) =>
    http<FlagStageConfig>(`/workspaces/${wsKey}/flags/${flagKey}/stages/${stageKey}/toggle`, {
      method: "POST",
      body: JSON.stringify({ enabled }),
    }),
  putFlagStageConfig: (
    wsKey: string,
    flagKey: string,
    stageKey: string,
    body: {
      enabled: boolean;
      disabledValueIndex: number;
      defaultServe: ServeSpec;
      pinned: PinnedSubject[];
      rules: MatchRule[];
    },
  ) =>
    http<FlagStageConfig>(`/workspaces/${wsKey}/flags/${flagKey}/stages/${stageKey}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  // subject types
  listSubjectTypes: (wsKey: string) => http<SubjectType[]>(`/workspaces/${wsKey}/subject-types`),
  createSubjectType: (wsKey: string, key: string, name: string, isDefaultSplitKey?: boolean) =>
    http<SubjectType>(`/workspaces/${wsKey}/subject-types`, {
      method: "POST",
      body: JSON.stringify({ key, name, isDefaultSplitKey }),
    }),
  setDefaultSplitKey: (wsKey: string, stKey: string) =>
    http<SubjectType>(`/workspaces/${wsKey}/subject-types/${stKey}`, {
      method: "PATCH",
      body: JSON.stringify({ isDefaultSplitKey: true }),
    }),

  // subjects
  listSubjects: (
    wsKey: string,
    stageKey: string,
    opts: { subjectType?: string; q?: string; limit?: number; cursor?: string } = {},
  ) => {
    const qs = new URLSearchParams();
    if (opts.subjectType) qs.set("subjectType", opts.subjectType);
    if (opts.q) qs.set("q", opts.q);
    if (opts.limit) qs.set("limit", String(opts.limit));
    if (opts.cursor) qs.set("cursor", opts.cursor);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return http<{ items: PersistedSubject[]; nextCursor: string | null }>(
      `/workspaces/${wsKey}/stages/${stageKey}/subjects${suffix}`,
    );
  },
  getSubject: (wsKey: string, stageKey: string, subjectType: string, subjectId: string) =>
    http<PersistedSubject>(
      `/workspaces/${wsKey}/stages/${stageKey}/subjects/${encodeURIComponent(subjectType)}/${encodeURIComponent(subjectId)}`,
    ),

  // audiences
  listAudiences: (wsKey: string) => http<Audience[]>(`/workspaces/${wsKey}/audiences`),
  getAudience: (wsKey: string, audKey: string) =>
    http<Audience>(`/workspaces/${wsKey}/audiences/${audKey}`),
  createAudience: (wsKey: string, key: string, name: string, subjectType: string) =>
    http<Audience>(`/workspaces/${wsKey}/audiences`, {
      method: "POST",
      body: JSON.stringify({ key, name, subjectType }),
    }),
  putAudienceStagePayload: (
    wsKey: string,
    audKey: string,
    stageKey: string,
    body: { members: AudienceMember[]; rules: AudienceRule[] },
  ) =>
    http<{
      audienceId: string;
      stageId: string;
      members: AudienceMember[];
      rules: AudienceRule[];
      updatedAt: string;
    }>(`/workspaces/${wsKey}/audiences/${audKey}/stages/${stageKey}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
};

export type ApiError = Error & { status: number; code: string };
