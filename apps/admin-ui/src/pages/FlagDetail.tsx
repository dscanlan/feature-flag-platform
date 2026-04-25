import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Audience,
  Flag,
  FlagStageConfig,
  MatchRule,
  PinnedSubject,
  ServeSpec,
  SubjectType,
} from "@ffp/shared-types";
import { api } from "../api.js";
import { Layout } from "../components/Layout.js";
import { RuleBuilder } from "../components/RuleBuilder.js";
import { SubjectPicker } from "../components/SubjectPicker.js";
import { Button, Card, CardBody, CardHeader, Field, Pill } from "../components/ui.js";

export function FlagDetail() {
  const { wsKey = "", flagKey = "" } = useParams<{ wsKey: string; flagKey: string }>();
  const queryClient = useQueryClient();
  const stages = useQuery({ queryKey: ["stages", wsKey], queryFn: () => api.listStages(wsKey) });
  const flag = useQuery({
    queryKey: ["flag", wsKey, flagKey],
    queryFn: () => api.getFlag(wsKey, flagKey),
    refetchInterval: 5_000,
  });

  const subjectTypes = useQuery({
    queryKey: ["subject-types", wsKey],
    queryFn: () => api.listSubjectTypes(wsKey),
  });
  const audiences = useQuery({
    queryKey: ["audiences", wsKey],
    queryFn: () => api.listAudiences(wsKey),
  });

  const [stageKey, setStageKey] = useState<string | null>(null);
  useEffect(() => {
    if (!stageKey && stages.data && stages.data.length > 0) setStageKey(stages.data[0]!.key);
  }, [stages.data, stageKey]);

  const stage = useMemo(
    () => stages.data?.find((s) => s.key === stageKey) ?? null,
    [stages.data, stageKey],
  );
  const config = useMemo(
    () => flag.data?.configs.find((c) => c.stageId === stage?.id) ?? null,
    [flag.data, stage],
  );

  return (
    <Layout>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/workspaces" className="hover:text-slate-900">
          Workspaces
        </Link>{" "}
        /{" "}
        <Link to={`/workspaces/${wsKey}`} className="hover:text-slate-900 font-mono">
          {wsKey}
        </Link>{" "}
        / <span className="font-mono">{flagKey}</span>
      </div>
      <h1 className="text-xl font-semibold text-slate-900 mb-1">
        {flag.data?.flag.name ?? flagKey}
      </h1>
      <div className="text-sm text-slate-500 mb-4 flex items-center gap-2">
        <code className="font-mono">{flagKey}</code>
        <Pill>{flag.data?.flag.kind ?? "…"}</Pill>
      </div>

      <div className="flex gap-1 mb-4">
        {stages.data?.map((s) => (
          <button
            key={s.id}
            onClick={() => setStageKey(s.key)}
            className={
              "px-3 py-1.5 rounded-md text-sm font-medium border " +
              (s.key === stageKey
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50")
            }
          >
            {s.name}
          </button>
        ))}
      </div>

      {stage && config && flag.data ? (
        <StageEditor
          wsKey={wsKey}
          flagKey={flagKey}
          stageKey={stage.key}
          flag={flag.data.flag}
          config={config}
          subjectTypes={subjectTypes.data ?? []}
          audiences={audiences.data ?? []}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: ["flag", wsKey, flagKey] })}
        />
      ) : (
        <div className="text-slate-500 text-sm">Loading…</div>
      )}
    </Layout>
  );
}

function StageEditor({
  wsKey,
  flagKey,
  stageKey,
  flag,
  config,
  subjectTypes,
  audiences,
  onSaved,
}: {
  wsKey: string;
  flagKey: string;
  stageKey: string;
  flag: Flag;
  config: FlagStageConfig;
  subjectTypes: SubjectType[];
  audiences: Audience[];
  onSaved: () => void;
}) {
  const [enabled, setEnabled] = useState(config.enabled);
  const [defaultIndex, setDefaultIndex] = useState(
    config.defaultServe.kind === "value" ? config.defaultServe.valueIndex : 1,
  );
  const [disabledIndex, setDisabledIndex] = useState(config.disabledValueIndex);
  const [pinned, setPinned] = useState<PinnedSubject[]>(config.pinned);
  const [rules, setRules] = useState<MatchRule[]>(config.rules);
  const [pinType, setPinType] = useState(() => subjectTypes[0]?.key ?? "");
  const [pinId, setPinId] = useState("");
  const [pinValue, setPinValue] = useState(0);

  useEffect(() => {
    if (!pinType && subjectTypes.length > 0) setPinType(subjectTypes[0]!.key);
  }, [subjectTypes, pinType]);
  const [error, setError] = useState<string | null>(null);

  const valueOptions = flag.values.map((v, i) => ({
    index: i,
    label: valueLabel(flag, i),
  }));

  // Re-sync local state if config changes underneath us (poll refresh).
  useEffect(() => {
    setEnabled(config.enabled);
    setDefaultIndex(config.defaultServe.kind === "value" ? config.defaultServe.valueIndex : 1);
    setDisabledIndex(config.disabledValueIndex);
    setPinned(config.pinned);
    setRules(config.rules);
  }, [config.version]);

  const toggle = useMutation({
    mutationFn: (next: boolean) => api.toggleFlag(wsKey, flagKey, stageKey, next),
    onSuccess: (cfg) => {
      setEnabled(cfg.enabled);
      onSaved();
    },
    onError: (err: Error) => setError(err.message),
  });

  const save = useMutation({
    mutationFn: () => {
      const defaultServe: ServeSpec = { kind: "value", valueIndex: defaultIndex };
      return api.putFlagStageConfig(wsKey, flagKey, stageKey, {
        enabled,
        disabledValueIndex: disabledIndex,
        defaultServe,
        pinned,
        rules,
      });
    },
    onSuccess: () => {
      setError(null);
      onSaved();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <span>
            Stage: <code className="font-mono">{stageKey}</code>
          </span>
          <Pill>v{config.version}</Pill>
        </div>
      </CardHeader>
      <CardBody className="space-y-5">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-slate-700">Enabled</span>
          <button
            onClick={() => toggle.mutate(!enabled)}
            disabled={toggle.isPending}
            className={
              "relative inline-flex h-6 w-11 items-center rounded-full transition " +
              (enabled ? "bg-green-600" : "bg-slate-300")
            }
            aria-pressed={enabled}
          >
            <span
              className={
                "inline-block h-5 w-5 transform rounded-full bg-white transition " +
                (enabled ? "translate-x-5" : "translate-x-1")
              }
            />
          </button>
          <Pill tone={enabled ? "green" : "red"}>{enabled ? "ON" : "OFF"}</Pill>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Default value (when no rule matches)">
            <select
              className="w-full px-3 py-1.5 text-sm rounded-md border border-slate-300"
              value={defaultIndex}
              onChange={(e) => setDefaultIndex(Number(e.target.value))}
            >
              {valueOptions.map((o) => (
                <option key={o.index} value={o.index}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Disabled value (when flag is OFF)">
            <select
              className="w-full px-3 py-1.5 text-sm rounded-md border border-slate-300"
              value={disabledIndex}
              onChange={(e) => setDisabledIndex(Number(e.target.value))}
            >
              {valueOptions.map((o) => (
                <option key={o.index} value={o.index}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {flag.kind === "json" && (
          <details className="text-xs text-slate-600">
            <summary className="cursor-pointer">View {flag.values.length} JSON values</summary>
            <div className="mt-2 space-y-2">
              {flag.values.map((v, i) => (
                <div key={i} className="border border-slate-200 rounded p-2 bg-slate-50">
                  <div className="text-slate-500 mb-1">
                    [{i}] {v.name ?? <em>(no name)</em>}
                  </div>
                  <pre className="font-mono text-[11px] whitespace-pre-wrap break-all">
                    {JSON.stringify(v.value, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          </details>
        )}

        <div>
          <div className="text-xs font-medium text-slate-600 mb-1">Pinned subjects</div>
          <div className="space-y-2">
            {pinned.length === 0 && <div className="text-sm text-slate-500">No pins.</div>}
            {pinned.map((p, i) => (
              <div
                key={`${p.subjectType}:${p.subjectId}:${i}`}
                className="flex items-center gap-2 text-sm"
              >
                <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-xs">
                  {p.subjectType}:{p.subjectId}
                </code>
                <span>→</span>
                {flag.kind === "boolean" ? (
                  <Pill tone={p.valueIndex === 1 ? "green" : "red"}>
                    {p.valueIndex === 1 ? "true" : "false"}
                  </Pill>
                ) : (
                  <Pill>{valueLabel(flag, p.valueIndex)}</Pill>
                )}
                <button
                  className="ml-auto text-xs text-red-600 hover:underline"
                  onClick={() => setPinned(pinned.filter((_, idx) => idx !== i))}
                >
                  remove
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
            <Field label="Subject type">
              <select
                className="w-full px-3 py-1.5 text-sm rounded-md border border-slate-300"
                value={pinType}
                onChange={(e) => setPinType(e.target.value)}
              >
                {subjectTypes.map((st) => (
                  <option key={st.id} value={st.key}>
                    {st.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Subject id">
              <SubjectPicker
                wsKey={wsKey}
                stageKey={stageKey}
                subjectType={pinType || undefined}
                value={pinId}
                onChange={setPinId}
                placeholder="user-123"
              />
            </Field>
            <Field label="Value">
              <select
                className="w-full px-3 py-1.5 text-sm rounded-md border border-slate-300"
                value={pinValue}
                onChange={(e) => setPinValue(Number(e.target.value))}
              >
                {valueOptions.map((o) => (
                  <option key={o.index} value={o.index}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Button
              type="button"
              variant="secondary"
              disabled={!pinType || !pinId}
              onClick={() => {
                setPinned([
                  ...pinned,
                  { subjectType: pinType, subjectId: pinId, valueIndex: pinValue },
                ]);
                setPinId("");
              }}
            >
              Add pin
            </Button>
          </div>
        </div>

        <RuleBuilder
          rules={rules}
          subjectTypes={subjectTypes}
          audiences={audiences}
          onChange={setRules}
        />

        {error && <div className="text-sm text-red-600">{error}</div>}
        <div className="flex gap-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function valueLabel(flag: Flag, index: number): string {
  const v = flag.values[index];
  if (!v) return `(missing index ${index})`;
  const named = v.name ? v.name : flag.kind === "boolean" ? String(v.value) : `value ${index}`;
  return `${named} (index ${index})`;
}
