import type {
  AttributeOp,
  Audience,
  AudienceClause,
  Clause,
  MatchRule,
  ServeSpec,
  SubjectType,
} from "@ffp/shared-types";
import { Button, Field, Input, Pill } from "./ui.js";

const OPS: { value: AttributeOp; label: string; group: string }[] = [
  { value: "in", label: "is one of", group: "equality" },
  { value: "notIn", label: "is not one of", group: "equality" },
  { value: "startsWith", label: "starts with", group: "string" },
  { value: "endsWith", label: "ends with", group: "string" },
  { value: "contains", label: "contains", group: "string" },
  { value: "matches", label: "matches regex", group: "string" },
  { value: "lessThan", label: "<", group: "number" },
  { value: "lessThanOrEqual", label: "≤", group: "number" },
  { value: "greaterThan", label: ">", group: "number" },
  { value: "greaterThanOrEqual", label: "≥", group: "number" },
  { value: "before", label: "before (date)", group: "date" },
  { value: "after", label: "after (date)", group: "date" },
  { value: "semVerEqual", label: "semver =", group: "semver" },
  { value: "semVerLessThan", label: "semver <", group: "semver" },
  { value: "semVerGreaterThan", label: "semver >", group: "semver" },
];

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function RuleBuilder({
  rules,
  subjectTypes,
  audiences,
  onChange,
}: {
  rules: MatchRule[];
  subjectTypes: SubjectType[];
  audiences: Audience[];
  onChange: (rules: MatchRule[]) => void;
}) {
  function addRule() {
    onChange([
      ...rules,
      {
        id: uid(),
        clauses: [],
        serve: { kind: "value", valueIndex: 1 },
      },
    ]);
  }

  function updateRule(idx: number, next: MatchRule) {
    onChange(rules.map((r, i) => (i === idx ? next : r)));
  }

  function removeRule(idx: number) {
    onChange(rules.filter((_, i) => i !== idx));
  }

  function moveRule(idx: number, delta: number) {
    const next = [...rules];
    const target = idx + delta;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target]!, next[idx]!];
    onChange(next);
  }

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium text-slate-600">Match rules (first match wins)</div>
      {rules.length === 0 && (
        <div className="text-sm text-slate-500 border border-dashed border-slate-300 rounded p-3">
          No rules. Add one to target by attribute or audience.
        </div>
      )}
      {rules.map((rule, i) => (
        <RuleCard
          key={rule.id}
          index={i}
          isFirst={i === 0}
          isLast={i === rules.length - 1}
          rule={rule}
          subjectTypes={subjectTypes}
          audiences={audiences}
          onChange={(next) => updateRule(i, next)}
          onRemove={() => removeRule(i)}
          onMove={(delta) => moveRule(i, delta)}
        />
      ))}
      <Button type="button" variant="secondary" onClick={addRule}>
        + Add rule
      </Button>
    </div>
  );
}

function RuleCard({
  index,
  isFirst,
  isLast,
  rule,
  subjectTypes,
  audiences,
  onChange,
  onRemove,
  onMove,
}: {
  index: number;
  isFirst: boolean;
  isLast: boolean;
  rule: MatchRule;
  subjectTypes: SubjectType[];
  audiences: Audience[];
  onChange: (next: MatchRule) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
}) {
  function setClauses(clauses: Clause[]) {
    onChange({ ...rule, clauses });
  }

  function addAttributeClause() {
    setClauses([
      ...rule.clauses,
      {
        kind: "attribute",
        subjectType: subjectTypes[0]?.key ?? "user",
        attribute: "plan",
        op: "in",
        values: [""],
        negate: false,
      },
    ]);
  }

  function addAudienceClause() {
    if (audiences.length === 0) return;
    setClauses([
      ...rule.clauses,
      {
        kind: "audience",
        op: "inAudience",
        audienceIds: [audiences[0]!.id],
      },
    ]);
  }

  return (
    <div className="border border-slate-300 rounded-md p-3 space-y-3 bg-slate-50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Pill>#{index + 1}</Pill>
          <Input
            className="text-sm"
            placeholder="optional description"
            value={rule.description ?? ""}
            onChange={(e) => onChange({ ...rule, description: e.target.value || undefined })}
          />
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={isFirst}
            onClick={() => onMove(-1)}
            className="text-xs text-slate-600 hover:text-slate-900 disabled:opacity-30"
            title="move up"
          >
            ↑
          </button>
          <button
            type="button"
            disabled={isLast}
            onClick={() => onMove(1)}
            className="text-xs text-slate-600 hover:text-slate-900 disabled:opacity-30"
            title="move down"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-red-600 hover:underline ml-1"
          >
            remove
          </button>
        </div>
      </div>

      {rule.clauses.length === 0 && (
        <div className="text-xs text-slate-500">No clauses — this rule will match everything.</div>
      )}
      {rule.clauses.map((c, i) => (
        <ClauseEditor
          key={i}
          clause={c}
          subjectTypes={subjectTypes}
          audiences={audiences}
          onChange={(next) => setClauses(rule.clauses.map((cur, idx) => (idx === i ? next : cur)))}
          onRemove={() => setClauses(rule.clauses.filter((_, idx) => idx !== i))}
        />
      ))}
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={addAttributeClause}>
          + Attribute clause
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={addAudienceClause}
          disabled={audiences.length === 0}
          title={audiences.length === 0 ? "Create an audience first" : undefined}
        >
          + Audience clause
        </Button>
      </div>

      <div className="border-t border-slate-200 pt-3 grid grid-cols-2 gap-2 items-end">
        <Field label="Serve">
          <select
            className="w-full px-3 py-1.5 text-sm rounded-md border border-slate-300"
            value={rule.serve.kind === "value" ? `value:${rule.serve.valueIndex}` : "split:50"}
            onChange={(e) => {
              const v = e.target.value;
              let serve: ServeSpec;
              if (v === "split:50") {
                serve = {
                  kind: "split",
                  splitKeySubjectType: subjectTypes[0]?.key ?? "user",
                  buckets: [
                    { valueIndex: 0, weight: 50000 },
                    { valueIndex: 1, weight: 50000 },
                  ],
                };
              } else {
                serve = { kind: "value", valueIndex: v.endsWith("1") ? 1 : 0 };
              }
              onChange({ ...rule, serve });
            }}
          >
            <option value="value:1">true (index 1)</option>
            <option value="value:0">false (index 0)</option>
            <option value="split:50">50/50 split</option>
          </select>
        </Field>
        {rule.serve.kind === "split" && (
          <Field label="Split key (subject type)">
            <select
              className="w-full px-3 py-1.5 text-sm rounded-md border border-slate-300"
              value={rule.serve.splitKeySubjectType}
              onChange={(e) =>
                onChange({
                  ...rule,
                  serve: { ...rule.serve, splitKeySubjectType: e.target.value } as ServeSpec,
                })
              }
            >
              {subjectTypes.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.key}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
    </div>
  );
}

function ClauseEditor({
  clause,
  subjectTypes,
  audiences,
  onChange,
  onRemove,
}: {
  clause: Clause;
  subjectTypes: SubjectType[];
  audiences: Audience[];
  onChange: (c: Clause) => void;
  onRemove: () => void;
}) {
  if (clause.kind === "audience") {
    return (
      <AudienceClauseEditor
        clause={clause}
        audiences={audiences}
        onChange={onChange}
        onRemove={onRemove}
      />
    );
  }
  return (
    <div className="grid grid-cols-12 gap-2 items-center text-sm">
      <select
        className="col-span-2 px-2 py-1 rounded border border-slate-300 bg-white"
        value={clause.subjectType}
        onChange={(e) => onChange({ ...clause, subjectType: e.target.value })}
      >
        {(subjectTypes.length > 0 ? subjectTypes.map((t) => t.key) : ["user"]).map((k) => (
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

function AudienceClauseEditor({
  clause,
  audiences,
  onChange,
  onRemove,
}: {
  clause: AudienceClause;
  audiences: Audience[];
  onChange: (c: Clause) => void;
  onRemove: () => void;
}) {
  const selected = new Set(clause.audienceIds);
  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // Keep at least one audience selected; if the user unchecks the last one,
    // the rule would silently match nothing, so we drop the clause instead.
    const ids = [...next];
    if (ids.length === 0) return;
    onChange({ ...clause, audienceIds: ids });
  }
  return (
    <div className="border border-slate-200 rounded-md p-2 bg-white space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-slate-600">Subject is</span>
        <select
          className="px-2 py-1 rounded border border-slate-300 bg-white"
          value={clause.op}
          onChange={(e) => onChange({ ...clause, op: e.target.value as AudienceClause["op"] })}
        >
          <option value="inAudience">in audience</option>
          <option value="notInAudience">not in audience</option>
        </select>
        <button
          type="button"
          onClick={onRemove}
          className="ml-auto text-xs text-red-600 hover:underline"
        >
          remove clause
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {audiences.length === 0 && (
          <span className="text-xs text-slate-500">No audiences in this workspace.</span>
        )}
        {audiences.map((a) => (
          <label
            key={a.id}
            className={
              "inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs cursor-pointer " +
              (selected.has(a.id)
                ? "bg-blue-50 border-blue-300 text-blue-900"
                : "bg-white border-slate-300 text-slate-700")
            }
          >
            <input
              type="checkbox"
              className="accent-blue-600"
              checked={selected.has(a.id)}
              onChange={() => toggle(a.id)}
            />
            <span className="font-mono">{a.key}</span>
            <Pill>{a.subjectType}</Pill>
          </label>
        ))}
      </div>
      <div className="text-xs text-slate-500">
        Multiple audiences OR-match inside one clause; add another clause to require AND.
      </div>
    </div>
  );
}
