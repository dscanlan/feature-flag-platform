import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api.js";
import { Layout } from "../components/Layout.js";
import { Button, Card, CardBody, CardHeader, Field, Input } from "../components/ui.js";

export function Workspaces() {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ["workspaces"], queryFn: () => api.listWorkspaces() });
  const [creating, setCreating] = useState(false);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api.createWorkspace(key, name),
    onSuccess: () => {
      setKey("");
      setName("");
      setCreating(false);
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Layout>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-slate-900">Workspaces</h1>
        <Button onClick={() => setCreating((c) => !c)}>
          {creating ? "Cancel" : "New workspace"}
        </Button>
      </div>

      {creating && (
        <Card className="mb-4">
          <CardHeader>Create workspace</CardHeader>
          <CardBody>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                create.mutate();
              }}
              className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end"
            >
              <Field label="Key (lowercase, hyphens)">
                <Input
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="demo"
                  required
                />
              </Field>
              <Field label="Name">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Demo"
                  required
                />
              </Field>
              <div>
                <Button type="submit" disabled={create.isPending}>
                  {create.isPending ? "Creating…" : "Create"}
                </Button>
              </div>
              {error && <div className="md:col-span-3 text-sm text-red-600">{error}</div>}
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
              {list.data.map((ws) => (
                <li key={ws.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <Link
                      to={`/workspaces/${ws.key}`}
                      className="font-medium text-slate-900 hover:text-blue-700"
                    >
                      {ws.name}
                    </Link>
                    <div className="text-xs text-slate-500 font-mono">{ws.key}</div>
                  </div>
                  <Link
                    to={`/workspaces/${ws.key}`}
                    className="text-sm text-slate-500 hover:text-slate-900"
                  >
                    Open →
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-4 text-slate-500 text-sm">No workspaces yet. Create one above.</div>
          )}
        </CardBody>
      </Card>
    </Layout>
  );
}
