import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api.js";
import { Layout } from "../components/Layout.js";
import { Button, Card, CardBody, CardHeader, Field, Input, Pill } from "../components/ui.js";

export function SubjectTypes() {
  const { wsKey = "" } = useParams<{ wsKey: string }>();
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ["subject-types", wsKey],
    queryFn: () => api.listSubjectTypes(wsKey),
  });
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.createSubjectType(wsKey, key, name, isDefault),
    onSuccess: () => {
      setKey("");
      setName("");
      setIsDefault(false);
      setAdding(false);
      void queryClient.invalidateQueries({ queryKey: ["subject-types", wsKey] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const setDefault = useMutation({
    mutationFn: (stKey: string) => api.setDefaultSplitKey(wsKey, stKey),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["subject-types", wsKey] }),
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
        / subject types
      </div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-slate-900">Subject types</h1>
        <Button onClick={() => setAdding((a) => !a)}>
          {adding ? "Cancel" : "Add subject type"}
        </Button>
      </div>

      {adding && (
        <Card className="mb-4">
          <CardHeader>Add subject type</CardHeader>
          <CardBody>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                create.mutate();
              }}
              className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end"
            >
              <Field label="Key (e.g. user, account)">
                <Input
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="user"
                  required
                />
              </Field>
              <Field label="Display name">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="User"
                  required
                />
              </Field>
              <label className="flex items-center gap-2 text-sm text-slate-700 mt-5 md:mt-0">
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                />
                Default split key
              </label>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Adding…" : "Add"}
              </Button>
              {error && <div className="md:col-span-4 text-sm text-red-600">{error}</div>}
            </form>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody className="p-0">
          {list.isLoading ? (
            <div className="p-4 text-slate-500">Loading…</div>
          ) : list.data && list.data.length > 0 ? (
            <ul className="divide-y divide-slate-200">
              {list.data.map((st) => (
                <li key={st.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-slate-900">{st.name}</div>
                    <div className="text-xs text-slate-500 font-mono">{st.key}</div>
                  </div>
                  {st.isDefaultSplitKey ? (
                    <Pill tone="green">default split key</Pill>
                  ) : (
                    <button
                      className="text-xs text-blue-600 hover:underline"
                      onClick={() => setDefault.mutate(st.key)}
                    >
                      make default split key
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-4 text-slate-500 text-sm">
              No subject types yet. Add one (e.g. <code className="font-mono">user</code>) so flags
              can target attributes on it.
            </div>
          )}
        </CardBody>
      </Card>
    </Layout>
  );
}
