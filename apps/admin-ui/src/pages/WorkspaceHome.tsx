import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Stage } from "@ffp/shared-types";
import { api } from "../api.js";
import { Layout } from "../components/Layout.js";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CodeChip,
  Field,
  Input,
  Pill,
} from "../components/ui.js";

export function WorkspaceHome() {
  const { wsKey = "" } = useParams<{ wsKey: string }>();
  const queryClient = useQueryClient();
  const stages = useQuery({ queryKey: ["stages", wsKey], queryFn: () => api.listStages(wsKey) });
  const flags = useQuery({ queryKey: ["flags", wsKey], queryFn: () => api.listFlags(wsKey) });

  const [showStageForm, setShowStageForm] = useState(false);
  const [stageKey, setStageKey] = useState("");
  const [stageName, setStageName] = useState("");
  const [stageError, setStageError] = useState<string | null>(null);
  const [rotated, setRotated] = useState<{ stageKey: string; serverKey: string } | null>(null);

  const createStage = useMutation({
    mutationFn: () => api.createStage(wsKey, stageKey, stageName),
    onSuccess: () => {
      setStageKey("");
      setStageName("");
      setShowStageForm(false);
      void queryClient.invalidateQueries({ queryKey: ["stages", wsKey] });
    },
    onError: (err: Error) => setStageError(err.message),
  });

  const resetServerKey = useMutation({
    mutationFn: (sk: string) => api.resetServerKey(wsKey, sk).then((res) => ({ sk, ...res })),
    onSuccess: (data) => {
      setRotated({ stageKey: data.sk, serverKey: data.serverKey });
      void queryClient.invalidateQueries({ queryKey: ["stages", wsKey] });
    },
  });

  return (
    <Layout>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/workspaces" className="hover:text-slate-900">
          Workspaces
        </Link>{" "}
        / <span className="font-mono">{wsKey}</span>
      </div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-slate-900">{wsKey}</h1>
        <div className="flex items-center gap-4 text-sm">
          <Link to={`/workspaces/${wsKey}/subject-types`} className="text-blue-600 hover:underline">
            Subject types →
          </Link>
          <Link to={`/workspaces/${wsKey}/subjects`} className="text-blue-600 hover:underline">
            Subjects →
          </Link>
          <Link to={`/workspaces/${wsKey}/audiences`} className="text-blue-600 hover:underline">
            Audiences →
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <span>Stages</span>
              <Button variant="secondary" onClick={() => setShowStageForm((s) => !s)}>
                {showStageForm ? "Cancel" : "Add stage"}
              </Button>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            {showStageForm && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setStageError(null);
                  createStage.mutate();
                }}
                className="p-4 border-b border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-3 items-end"
              >
                <Field label="Key">
                  <Input
                    value={stageKey}
                    onChange={(e) => setStageKey(e.target.value)}
                    placeholder="production"
                    required
                  />
                </Field>
                <Field label="Name">
                  <Input
                    value={stageName}
                    onChange={(e) => setStageName(e.target.value)}
                    placeholder="Production"
                    required
                  />
                </Field>
                <div>
                  <Button type="submit" disabled={createStage.isPending}>
                    {createStage.isPending ? "Creating…" : "Create"}
                  </Button>
                </div>
                {stageError && (
                  <div className="md:col-span-3 text-sm text-red-600">{stageError}</div>
                )}
              </form>
            )}
            {stages.isLoading ? (
              <div className="p-4 text-slate-500">Loading…</div>
            ) : stages.data && stages.data.length > 0 ? (
              <ul className="divide-y divide-slate-200">
                {stages.data.map((s) => (
                  <StageRow
                    key={s.id}
                    stage={s}
                    wsKey={wsKey}
                    rotatedKey={rotated?.stageKey === s.key ? rotated.serverKey : null}
                    onRotate={() => {
                      if (
                        confirm(
                          `Rotate the Server Key for "${s.key}"? Old key stops working immediately.`,
                        )
                      )
                        resetServerKey.mutate(s.key);
                    }}
                    onDismissRotated={() => setRotated(null)}
                  />
                ))}
              </ul>
            ) : (
              <div className="p-4 text-slate-500 text-sm">No stages yet.</div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <span>Flags</span>
              <Link to={`/workspaces/${wsKey}/flags/new`}>
                <Button variant="secondary">New flag</Button>
              </Link>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            {flags.isLoading ? (
              <div className="p-4 text-slate-500">Loading…</div>
            ) : flags.data && flags.data.length > 0 ? (
              <ul className="divide-y divide-slate-200">
                {flags.data.map((f) => (
                  <li key={f.id} className="px-4 py-3 flex items-center justify-between">
                    <div>
                      <Link
                        to={`/workspaces/${wsKey}/flags/${f.key}`}
                        className="font-medium text-slate-900 hover:text-blue-700"
                      >
                        {f.name}
                      </Link>
                      <div className="text-xs text-slate-500 font-mono">{f.key}</div>
                    </div>
                    <Pill>{f.kind}</Pill>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-4 text-slate-500 text-sm">No flags yet.</div>
            )}
          </CardBody>
        </Card>
      </div>
    </Layout>
  );
}

function StageRow({
  stage,
  wsKey,
  rotatedKey,
  onRotate,
  onDismissRotated,
}: {
  stage: Stage;
  wsKey: string;
  rotatedKey: string | null;
  onRotate: () => void;
  onDismissRotated: () => void;
}) {
  const [editingCors, setEditingCors] = useState(false);
  const [corsText, setCorsText] = useState(stage.corsOrigins.join(", "));
  const [corsError, setCorsError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const saveCors = useMutation({
    mutationFn: (origins: string[]) => api.updateStageCors(wsKey, stage.key, origins),
    onSuccess: () => {
      setEditingCors(false);
      setCorsError(null);
      void queryClient.invalidateQueries({ queryKey: ["stages", wsKey] });
    },
    onError: (err: Error) => setCorsError(err.message),
  });

  function submitCors(e: React.FormEvent) {
    e.preventDefault();
    const parts = corsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) {
      setCorsError("at least one origin is required (use * to allow any)");
      return;
    }
    saveCors.mutate(parts);
  }

  return (
    <li className="p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium text-slate-900">{stage.name}</div>
          <div className="text-xs text-slate-500 font-mono">{stage.key}</div>
        </div>
        <Pill>v{stage.version}</Pill>
      </div>
      <div className="text-xs space-y-1">
        <div>
          <span className="text-slate-500">Public Key:</span> <CodeChip>{stage.publicKey}</CodeChip>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-slate-500">Server Key:</span> <CodeChip>{stage.serverKey}</CodeChip>
          <button className="text-xs text-blue-600 hover:underline" onClick={onRotate}>
            rotate
          </button>
        </div>
        {rotatedKey && (
          <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">
            <div className="font-medium mb-1">
              New Server Key — copy it now, we won't show it again
            </div>
            <div className="flex items-center gap-2">
              <CodeChip>{rotatedKey}</CodeChip>
              <button className="ml-auto text-xs underline" onClick={onDismissRotated}>
                dismiss
              </button>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 pt-1">
          <span className="text-slate-500">CORS:</span>
          {editingCors ? (
            <form onSubmit={submitCors} className="flex items-center gap-2 flex-1">
              <Input
                value={corsText}
                onChange={(e) => setCorsText(e.target.value)}
                placeholder="*, https://app.example.com"
                className="flex-1 text-xs"
              />
              <Button type="submit" disabled={saveCors.isPending}>
                {saveCors.isPending ? "Saving…" : "Save"}
              </Button>
              <button
                type="button"
                className="text-xs text-slate-500 hover:underline"
                onClick={() => {
                  setEditingCors(false);
                  setCorsText(stage.corsOrigins.join(", "));
                  setCorsError(null);
                }}
              >
                cancel
              </button>
            </form>
          ) : (
            <>
              <CodeChip>{stage.corsOrigins.join(", ")}</CodeChip>
              <button
                className="text-xs text-blue-600 hover:underline"
                onClick={() => setEditingCors(true)}
              >
                edit
              </button>
            </>
          )}
        </div>
        {corsError && <div className="text-xs text-red-600">{corsError}</div>}
      </div>
    </li>
  );
}
