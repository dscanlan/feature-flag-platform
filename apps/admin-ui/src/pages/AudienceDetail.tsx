import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Audience,
  AudienceMember,
  AudienceRule,
  AttributeClause,
  AttributeOp,
  Stage,
  SubjectType,
} from "@ffp/shared-types";
import { api } from "../api.js";
import { Layout } from "../components/Layout.js";
import { SubjectPicker } from "../components/SubjectPicker.js";
import { Button, Card, CardBody, CardHeader, Field, Input, Pill } from "../components/ui.js";

const OPS: { value: AttributeOp; label: string }[] = [
  { value: "in", label: "is one of" },
  { value: "notIn", label: "is not one of" },
  { value: "startsWith", label: "starts with" },
  { value: "endsWith", label: "ends with" },
  { value: "contains", label: "contains" },
  { value: "matches", label: "matches regex" },
  { value: "lessThan", label: "<" },
  { value: "lessThanOrEqual", label: "≤" },
  { value: "greaterThan", label: ">" },
  { value: "greaterThanOrEqual", label: "≥" },
  { value: "before", label: "before (date)" },
  { value: "after", label: "after (date)" },
  { value: "semVerEqual", label: "semver =" },
  { value: "semVerLessThan", label: "semver <" },
  { value: "semVerGreaterThan", label: "semver >" },
];

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function AudienceDetail() {
  const { wsKey = "", audKey = "" } = useParams<{ wsKey: string; audKey: string }>();
  const queryClient = useQueryClient();
  const audience = useQuery({
    queryKey: ["audience", wsKey, audKey],
    queryFn: () => api.getAudience(wsKey, audKey),
  });
  const stages = useQuery({ queryKey: ["stages", wsKey], queryFn: () => api.listStages(wsKey) });
  const subjectTypes = useQuery({
    queryKey: ["subject-types", wsKey],
    queryFn: () => api.listSubjectTypes(wsKey),
  });

  const [stageKey, setStageKey] = useState<string | null>(null);
  useEffect(() => {
    if (!stageKey && stages.data && stages.data.length > 0) setStageKey(stages.data[0]!.key);
  }, [stages.data, stageKey]);

  const stage = useMemo(
    () => stages.data?.find((s) => s.key === stageKey) ?? null,
    [stages.data, stageKey],
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
        /{" "}
        <Link to={`/workspaces/${wsKey}/audiences`} className="hover:text-slate-900">
          audiences
        </Link>{" "}
        / <span className="font-mono">{audKey}</span>
      </div>
      <h1 className="text-xl font-semibold text-slate-900 mb-1">{audience.data?.name ?? audKey}</h1>
      <div className="text-sm text-slate-500 mb-4 flex items-center gap-2">
        <code className="font-mono">{audKey}</code>
        <Pill>targets {audience.data?.subjectType ?? "…"}</Pill>
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

      {audience.data && stage ? (
        <StagePayloadEditor
          wsKey={wsKey}
          audKey={audKey}
          stage={stage}
          audience={audience.data}
          subjectTypes={subjectTypes.data ?? []}
          onSaved={() =>
            void queryClient.invalidateQueries({ queryKey: ["audience", wsKey, audKey] })
          }
        />
      ) : (
        <div className="text-slate-500 text-sm">Loading…</div>
      )}
    </Layout>
  );
}

function StagePayloadEditor({
  wsKey,
  audKey,
  stage,
  audience,
  subjectTypes,
  onSaved,
}: {
  wsKey: string;
  audKey: string;
  stage: Stage;
  audience: Audience;
  subjectTypes: SubjectType[];
  onSaved: () => void;
}) {
  const payload = audience.perStage[stage.id] ?? { members: [], rules: [] };
  const [members, setMembers] = useState<AudienceMember[]>(payload.members);
  const [rules, setRules] = useState<AudienceRule[]>(payload.rules);
  const [addId, setAddId] = useState("");
  const [addIncluded, setAddIncluded] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Rebind when the stage tab changes (different payload below us).
  useEffect(() => {
    setMembers(payload.members);
    setRules(payload.rules);
    setError(null);
  }, [stage.id, audience.id]);

  const save = useMutation({
    mutationFn: () => api.putAudienceStagePayload(wsKey, audKey, stage.key, { members, rules }),
    onSuccess: () => {
      setError(null);
      onSaved();
    },
    onError: (err: Error) => setError(err.message),
  });

  function addMember() {
    const id = addId.trim();
    if (!id) return;
    if (members.some((m) => m.subjectType === audience.subjectType && m.subjectId === id)) {
      setError(`${audience.subjectType}:${id} is already listed`);
      return;
    }
    setMembers([
      ...members,
      { subjectType: audience.subjectType, subjectId: id, included: addIncluded },
    ]);
    setAddId("");
    setError(null);
  }

  function removeMember(i: number) {
    setMembers(members.filter((_, idx) => idx !== i));
  }

  function addRule() {
    setRules([...rules, { id: uid(), clauses: [] }]);
  }

  function updateRule(idx: number, next: AudienceRule) {
    setRules(rules.map((r, i) => (i === idx ? next : r)));
  }

  function removeRule(idx: number) {
    setRules(rules.filter((_, i) => i !== idx));
  }

  const included = members.filter((m) => m.included);
  const excluded = members.filter((m) => !m.included);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <span>
              Included — <code className="font-mono">{audience.subjectType}</code> ids always in the
              audience
            </span>
            <Pill tone="green">{included.length}</Pill>
          </div>
        </CardHeader>
        <CardBody>
          {included.length === 0 && (
            <div className="text-sm text-slate-500 mb-2">No included subjects.</div>
          )}
          <ul className="space-y-1 mb-3">
            {members.map((m, i) =>
              m.included ? (
                <li key={`${m.subjectId}:${i}`} className="flex items-center gap-2 text-sm">
                  <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-xs">
                    {m.subjectType}:{m.subjectId}
                  </code>
                  <button
                    className="ml-auto text-xs text-red-600 hover:underline"
                    onClick={() => removeMember(i)}
                  >
                    remove
                  </button>
                </li>
              ) : null,
            )}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <span>
              Excluded — <code className="font-mono">{audience.subjectType}</code> ids never in the
              audience (wins over includes &amp; rules)
            </span>
            <Pill tone="red">{excluded.length}</Pill>
          </div>
        </CardHeader>
        <CardBody>
          {excluded.length === 0 && (
            <div className="text-sm text-slate-500 mb-2">No excluded subjects.</div>
          )}
          <ul className="space-y-1 mb-3">
            {members.map((m, i) =>
              !m.included ? (
                <li key={`${m.subjectId}:${i}`} className="flex items-center gap-2 text-sm">
                  <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-xs">
                    {m.subjectType}:{m.subjectId}
                  </code>
                  <button
                    className="ml-auto text-xs text-red-600 hover:underline"
                    onClick={() => removeMember(i)}
                  >
                    remove
                  </button>
                </li>
              ) : null,
            )}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>Add member</CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <Field label={`Subject id (${audience.subjectType})`}>
              <SubjectPicker
                wsKey={wsKey}
                stageKey={stage.key}
                subjectType={audience.subjectType}
                value={addId}
                onChange={setAddId}
                placeholder="user-123"
              />
            </Field>
            <Field label="Mode">
              <select
                className="w-full px-3 py-1.5 text-sm rounded-md border border-slate-300"
                value={addIncluded ? "included" : "excluded"}
                onChange={(e) => setAddIncluded(e.target.value === "included")}
              >
                <option value="included">Include</option>
                <option value="excluded">Exclude</option>
              </select>
            </Field>
            <Button type="button" variant="secondary" onClick={addMember}>
              Add
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <span>Rules — any matching rule makes the subject a member</span>
            <Button type="button" variant="secondary" onClick={addRule}>
              + Add rule
            </Button>
          </div>
        </CardHeader>
        <CardBody className="space-y-3">
          {rules.length === 0 && <div className="text-sm text-slate-500">No rules.</div>}
          {rules.map((rule, i) => (
            <RuleEditor
              key={rule.id}
              rule={rule}
              audienceSubjectType={audience.subjectType}
              subjectTypes={subjectTypes}
              onChange={(next) => updateRule(i, next)}
              onRemove={() => removeRule(i)}
            />
          ))}
        </CardBody>
      </Card>

      {error && <div className="text-sm text-red-600">{error}</div>}
      <div className="flex gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : `Save ${stage.key}`}
        </Button>
      </div>
    </div>
  );
}

function RuleEditor({
  rule,
  audienceSubjectType,
  subjectTypes,
  onChange,
  onRemove,
}: {
  rule: AudienceRule;
  audienceSubjectType: string;
  subjectTypes: SubjectType[];
  onChange: (next: AudienceRule) => void;
  onRemove: () => void;
}) {
  function setClauses(clauses: AttributeClause[]) {
    onChange({ ...rule, clauses });
  }

  function addClause() {
    setClauses([
      ...(rule.clauses as AttributeClause[]),
      {
        kind: "attribute",
        subjectType: audienceSubjectType,
        attribute: "plan",
        op: "in",
        values: [""],
        negate: false,
      },
    ]);
  }

  return (
    <div className="border border-slate-300 rounded-md p-3 space-y-2 bg-slate-50">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">Rule — all clauses AND</span>
        <button type="button" onClick={onRemove} className="text-xs text-red-600 hover:underline">
          remove rule
        </button>
      </div>
      {rule.clauses.length === 0 && (
        <div className="text-xs text-slate-500">No clauses — this rule matches everything.</div>
      )}
      {(rule.clauses as AttributeClause[]).map((c, i) => (
        <ClauseEditor
          key={i}
          clause={c}
          subjectTypes={subjectTypes}
          onChange={(next) =>
            setClauses(
              (rule.clauses as AttributeClause[]).map((cur, idx) => (idx === i ? next : cur)),
            )
          }
          onRemove={() =>
            setClauses((rule.clauses as AttributeClause[]).filter((_, idx) => idx !== i))
          }
        />
      ))}
      <Button type="button" variant="secondary" onClick={addClause}>
        + Attribute clause
      </Button>
    </div>
  );
}

function ClauseEditor({
  clause,
  subjectTypes,
  onChange,
  onRemove,
}: {
  clause: AttributeClause;
  subjectTypes: SubjectType[];
  onChange: (c: AttributeClause) => void;
  onRemove: () => void;
}) {
  const typeKeys = subjectTypes.length > 0 ? subjectTypes.map((t) => t.key) : [clause.subjectType];
  return (
    <div className="grid grid-cols-12 gap-2 items-center text-sm">
      <select
        className="col-span-2 px-2 py-1 rounded border border-slate-300 bg-white"
        value={clause.subjectType}
        onChange={(e) => onChange({ ...clause, subjectType: e.target.value })}
      >
        {typeKeys.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
      <Input
        className="col-span-2 text-sm"
        value={clause.attribute}
        onChange={(e) => onChange({ ...clause, attribute: e.target.value })}
        placeholder="attribute"
      />
      <select
        className="col-span-3 px-2 py-1 rounded border border-slate-300 bg-white"
        value={clause.op}
        onChange={(e) => onChange({ ...clause, op: e.target.value as AttributeOp })}
      >
        {OPS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Input
        className="col-span-3 text-sm"
        value={clause.values.join(",")}
        onChange={(e) =>
          onChange({
            ...clause,
            values: e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          })
        }
        placeholder="value, value, …"
      />
      <label className="col-span-1 text-xs flex items-center gap-1">
        <input
          type="checkbox"
          checked={clause.negate}
          onChange={(e) => onChange({ ...clause, negate: e.target.checked })}
        />
        not
      </label>
      <button
        type="button"
        onClick={onRemove}
        className="col-span-1 text-xs text-red-600 hover:underline text-right"
      >
        remove
      </button>
    </div>
  );
}
