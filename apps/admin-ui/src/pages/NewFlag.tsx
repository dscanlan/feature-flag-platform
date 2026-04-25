import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FlagValue } from "@ffp/shared-types";
import { api } from "../api.js";
import { Layout } from "../components/Layout.js";
import { JsonValueEditor } from "../components/JsonValueEditor.js";
import { Button, Card, CardBody, CardHeader, Field, Input } from "../components/ui.js";

const MAX_VALUE_BYTES = 32 * 1024;

interface DraftValue {
  name: string;
  description: string;
  value: unknown;
  error: string | null;
}

const seed = (): DraftValue[] => [
  { name: "off", description: "", value: {}, error: null },
  { name: "on", description: "", value: { enabled: true }, error: null },
];

export function NewFlag() {
  const { wsKey = "" } = useParams<{ wsKey: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"boolean" | "json">("boolean");
  const [values, setValues] = useState<DraftValue[]>(seed);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => {
      if (kind === "boolean") {
        return api.createFlag(wsKey, key, name, "boolean");
      }
      const payload: FlagValue[] = values.map((v) => ({
        value: v.value,
        ...(v.name ? { name: v.name } : {}),
        ...(v.description ? { description: v.description } : {}),
      }));
      return api.createJsonFlag(wsKey, key, name, payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["flags", wsKey] });
      navigate(`/workspaces/${wsKey}/flags/${key}`);
    },
    onError: (err: Error) => setError(err.message),
  });

  const jsonBlocked =
    kind === "json" &&
    (values.length < 2 ||
      values.some((v) => v.error || v.value === undefined || sizeOf(v.value) > MAX_VALUE_BYTES));

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
        / new flag
      </div>
      <h1 className="text-xl font-semibold text-slate-900 mb-4">New flag</h1>
      <Card className="max-w-3xl">
        <CardHeader>Create flag</CardHeader>
        <CardBody>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              create.mutate();
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Flag key">
                <Input
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="pricing-table"
                  required
                  pattern="[a-z0-9][a-z0-9-]{0,63}"
                  title="lowercase letters, digits, hyphens"
                />
              </Field>
              <Field label="Display name">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Pricing table"
                  required
                />
              </Field>
            </div>

            <Field label="Kind">
              <div className="flex gap-2">
                {(["boolean", "json"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={
                      "px-3 py-1.5 rounded-md text-sm font-medium border " +
                      (k === kind
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50")
                    }
                  >
                    {k}
                  </button>
                ))}
              </div>
            </Field>

            {kind === "boolean" ? (
              <p className="text-xs text-slate-500">
                Boolean flags have two fixed values: <code>false</code> (index 0) and{" "}
                <code>true</code> (index 1).
              </p>
            ) : (
              <div className="space-y-3">
                <div className="text-xs font-medium text-slate-600">
                  Values ({values.length}){" "}
                  <span className="text-slate-400">— first match / first index = 0</span>
                </div>
                {values.map((v, i) => (
                  <ValueRow
                    key={i}
                    index={i}
                    draft={v}
                    canRemove={values.length > 2}
                    onChange={(next) => {
                      const copy = [...values];
                      copy[i] = next;
                      setValues(copy);
                    }}
                    onRemove={() => setValues(values.filter((_, idx) => idx !== i))}
                  />
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    setValues([
                      ...values,
                      {
                        name: `value-${values.length}`,
                        description: "",
                        value: {},
                        error: null,
                      },
                    ])
                  }
                >
                  + Add value
                </Button>
                <p className="text-xs text-slate-500">Each value must be valid JSON ≤ 32 KB.</p>
              </div>
            )}

            {error && <div className="text-sm text-red-600">{error}</div>}
            <div className="flex gap-2">
              <Button type="submit" disabled={create.isPending || jsonBlocked}>
                {create.isPending ? "Creating…" : "Create flag"}
              </Button>
              <Link to={`/workspaces/${wsKey}`}>
                <Button type="button" variant="secondary">
                  Cancel
                </Button>
              </Link>
            </div>
          </form>
        </CardBody>
      </Card>
    </Layout>
  );
}

function ValueRow({
  index,
  draft,
  canRemove,
  onChange,
  onRemove,
}: {
  index: number;
  draft: DraftValue;
  canRemove: boolean;
  onChange: (next: DraftValue) => void;
  onRemove: () => void;
}) {
  const bytes = draft.value === undefined ? 0 : sizeOf(draft.value);
  const overSize = bytes > MAX_VALUE_BYTES;
  return (
    <div className="border border-slate-200 rounded-md p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">
          Value <code className="font-mono">[{index}]</code> — {bytes} bytes
          {overSize && <span className="text-red-600 ml-2">over 32 KB limit</span>}
        </div>
        {canRemove && (
          <button type="button" className="text-xs text-red-600 hover:underline" onClick={onRemove}>
            remove
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Field label="Name (optional)">
          <Input
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            placeholder="enterprise"
          />
        </Field>
        <Field label="Description (optional)">
          <Input
            value={draft.description}
            onChange={(e) => onChange({ ...draft, description: e.target.value })}
            placeholder="Pricing for the enterprise tier"
          />
        </Field>
      </div>
      <JsonValueEditor
        value={draft.value}
        onChange={(value, error) => onChange({ ...draft, value, error })}
      />
    </div>
  );
}

function sizeOf(v: unknown): number {
  try {
    return new Blob([JSON.stringify(v)]).size;
  } catch {
    return Infinity;
  }
}
