import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api.js";
import { Layout } from "../components/Layout.js";
import { Button, Card, CardBody, CardHeader, Field, Input, Pill } from "../components/ui.js";

export function Audiences() {
  const { wsKey = "" } = useParams<{ wsKey: string }>();
  const queryClient = useQueryClient();
  const audiences = useQuery({
    queryKey: ["audiences", wsKey],
    queryFn: () => api.listAudiences(wsKey),
  });
  const subjectTypes = useQuery({
    queryKey: ["subject-types", wsKey],
    queryFn: () => api.listSubjectTypes(wsKey),
  });

  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [subjectType, setSubjectType] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.createAudience(wsKey, key, name, subjectType),
    onSuccess: () => {
      setKey("");
      setName("");
      setSubjectType("");
      setAdding(false);
      void queryClient.invalidateQueries({ queryKey: ["audiences", wsKey] });
    },
    onError: (err: Error) => setError(err.message),
  });

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
        / audiences
      </div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-slate-900">Audiences</h1>
        <Button onClick={() => setAdding((a) => !a)}>{adding ? "Cancel" : "New audience"}</Button>
      </div>

      {adding && (
        <Card className="mb-4">
          <CardHeader>New audience</CardHeader>
          <CardBody>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                create.mutate();
              }}
              className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end"
            >
              <Field label="Key">
                <Input
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="beta-testers"
                  required
                />
              </Field>
              <Field label="Display name">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Beta testers"
                  required
                />
              </Field>
              <Field label="Subject type">
                <select
                  className="w-full px-3 py-1.5 text-sm rounded-md border border-slate-300"
                  value={subjectType}
                  onChange={(e) => setSubjectType(e.target.value)}
                  required
                >
                  <option value="" disabled>
                    {subjectTypes.isLoading ? "Loading…" : "Select…"}
                  </option>
                  {subjectTypes.data?.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.key}
                    </option>
                  ))}
                </select>
              </Field>
              <Button type="submit" disabled={create.isPending || !subjectType}>
                {create.isPending ? "Creating…" : "Create"}
              </Button>
              {error && <div className="md:col-span-4 text-sm text-red-600">{error}</div>}
              {subjectTypes.data && subjectTypes.data.length === 0 && (
                <div className="md:col-span-4 text-sm text-amber-700">
                  Add a subject type first — audiences must target one.
                </div>
              )}
            </form>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody className="p-0">
          {audiences.isLoading ? (
            <div className="p-4 text-slate-500">Loading…</div>
          ) : audiences.data && audiences.data.length > 0 ? (
            <ul className="divide-y divide-slate-200">
              {audiences.data.map((a) => (
                <li key={a.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <Link
                      to={`/workspaces/${wsKey}/audiences/${a.key}`}
                      className="font-medium text-slate-900 hover:text-blue-700"
                    >
                      {a.name}
                    </Link>
                    <div className="text-xs text-slate-500 font-mono">{a.key}</div>
                  </div>
                  <Pill>{a.subjectType}</Pill>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-4 text-slate-500 text-sm">
              No audiences yet. Create one to group subjects for flag targeting.
            </div>
          )}
        </CardBody>
      </Card>
    </Layout>
  );
}
