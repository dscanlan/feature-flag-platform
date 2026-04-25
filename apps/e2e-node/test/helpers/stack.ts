import {
  adminApiUrl,
  adminEmail,
  adminPassword,
  resolverUrl,
  SeedClient,
  waitForRuntime,
  type StackRuntime,
} from "@ffp/e2e-stack";
import type { Stage, Workspace } from "@ffp/shared-types";

export {
  adminApiUrl,
  adminEmail,
  adminPassword,
  resolverUrl,
  SeedClient,
  waitForRuntime,
  type StackRuntime,
};

export interface IsolatedStage {
  workspace: Workspace;
  stage: Stage;
  publicKey: string;
  serverKey: string;
  subjectSigningSecret: string;
  seed: SeedClient;
  adminApiUrl: string;
  resolverUrl: string;
}

/**
 * Create a fresh workspace + stage scoped to a single test file. The plan
 * locks in unique workspace keys per file so cross-file isolation survives a
 * missed teardown — callers should pass a stable file-scoped key.
 *
 * The returned SeedClient is preconfigured to operate against this isolated
 * workspace/stage so test code reads naturally.
 */
export async function provisionStage(opts: {
  workspaceKey: string;
  workspaceName?: string;
  stageKey?: string;
  stageName?: string;
  resolverUrl?: string;
}): Promise<IsolatedStage> {
  const runtime = await waitForRuntime();
  const stageKey = opts.stageKey ?? "default";
  const stageName = opts.stageName ?? "Default";
  const workspaceName = opts.workspaceName ?? opts.workspaceKey;

  // Bootstrap client uses the runtime's seed config so we can authenticate +
  // create the new workspace/stage. We re-create a properly scoped client
  // afterwards.
  const bootstrap = new SeedClient({
    adminApiUrl: runtime.adminApiUrl,
    resolverUrl: runtime.resolverUrl,
    publicKey: runtime.publicKey,
    workspaceKey: runtime.workspaceKey,
    stageKey: runtime.stageKey,
    adminEmail: runtime.adminEmail,
    adminPassword: runtime.adminPassword,
  });

  const workspace = await bootstrap.ensureWorkspace(opts.workspaceKey, workspaceName);
  const stage = await bootstrap.ensureStageForWorkspace(workspace.key, stageKey, stageName);

  const seed = new SeedClient({
    adminApiUrl: runtime.adminApiUrl,
    resolverUrl: opts.resolverUrl ?? runtime.resolverUrl,
    publicKey: stage.publicKey,
    workspaceKey: workspace.key,
    stageKey: stage.key,
    adminEmail: runtime.adminEmail,
    adminPassword: runtime.adminPassword,
  });

  return {
    workspace,
    stage,
    publicKey: stage.publicKey,
    serverKey: stage.serverKey,
    subjectSigningSecret: stage.subjectSigningSecret ?? "",
    seed,
    adminApiUrl: runtime.adminApiUrl,
    resolverUrl: opts.resolverUrl ?? runtime.resolverUrl,
  };
}
