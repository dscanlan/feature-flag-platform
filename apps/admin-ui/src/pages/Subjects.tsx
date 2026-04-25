import { useEffect, useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { PersistedSubject, Stage } from "@ffp/shared-types";
import { api } from "../api.js";
import { Layout } from "../components/Layout.js";
import { Button, Card, CardBody, CardHeader, CodeChip, Input, Pill } from "../components/ui.js";

const PAGE_SIZE = 50;

export function Subjects() {
  const { wsKey = "" } = useParams<{ wsKey: string }>();
  const [params, setParams] = useSearchParams();

  const stages = useQuery({ queryKey: ["stages", wsKey], queryFn: () => api.listStages(wsKey) });
  const subjectTypes = useQuery({
    queryKey: ["subject-types", wsKey],
    queryFn: () => api.listSubjectTypes(wsKey),
  });

  const stageKey = params.get("stage") ?? stages.data?.[0]?.key ?? null;
  const subjectType = params.get("subjectType") ?? "";
  const q = params.get("q") ?? "";

  // Default the URL to the first stage once stages have loaded.
  useEffect(() => {
    if (!params.get("stage") && stages.data && stages.data.length > 0) {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("stage", stages.data![0]!.key);
          return next;
        },
        { replace: true },
      );
    }
  }, [stages.data, params, setParams]);

  function patch(updates: Record<string, string | null>): void {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      // Any filter change resets pagination.
      next.delete("cursor");
      return next;
    });
  }

  const detailKey = params.get("detail"); // "type:id" or null
  const detail = useMemo(() => {
    if (!detailKey) return null;
    const idx = detailKey.indexOf(":");
    if (idx === -1) return null;
    return { type: detailKey.slice(0, idx), id: detailKey.slice(idx + 1) };
  }, [detailKey]);

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
        / subjects
      </div>
      <h1 className="text-xl font-semibold text-slate-900 mb-4">Subjects</h1>

      <div className="flex gap-1 mb-4">
        {stages.data?.map((s) => (
          <StageTab
            key={s.id}
            stage={s}
            active={s.key === stageKey}
            onClick={() => patch({ stage: s.key })}
          />
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Input
              value={q}
              onChange={(e) => patch({ q: e.target.value })}
              placeholder="Search subject id…"
              className="max-w-xs"
            />
            <select
              className="px-3 py-1.5 text-sm rounded-md border border-slate-300"
              value={subjectType}
              onChange={(e) => patch({ subjectType: e.target.value })}
            >
              <option value="">All types</option>
              {subjectTypes.data?.map((t) => (
                <option key={t.id} value={t.key}>
                  {t.key}
                </option>
              ))}
            </select>
            <span className="ml-auto text-xs text-slate-500">
              Subjects are observed by the resolver — read-only.
            </span>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {stageKey ? (
            <SubjectsTable
              wsKey={wsKey}
              stageKey={stageKey}
              subjectType={subjectType || undefined}
              q={q || undefined}
              cursor={params.get("cursor") ?? undefined}
              onCursorChange={(cursor) => patch({ cursor })}
              onOpen={(s) => patch({ detail: `${s.subjectType}:${s.subjectId}` })}
              activeDetail={detailKey}
            />
          ) : (
            <div className="p-4 text-slate-500 text-sm">No stages yet — create one first.</div>
          )}
        </CardBody>
      </Card>

      {detail && stageKey && (
        <SubjectDrawer
          wsKey={wsKey}
          stageKey={stageKey}
          subjectType={detail.type}
          subjectId={detail.id}
          onClose={() => patch({ detail: null })}
        />
      )}
    </Layout>
  );
}

function StageTab({
  stage,
  active,
  onClick,
}: {
  stage: Stage;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "px-3 py-1.5 rounded-md text-sm font-medium border " +
        (active
          ? "bg-slate-900 text-white border-slate-900"
          : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50")
      }
    >
      {stage.name}
    </button>
  );
}

function SubjectsTable({
  wsKey,
  stageKey,
  subjectType,
  q,
  cursor,
  onCursorChange,
  onOpen,
  activeDetail,
}: {
  wsKey: string;
  stageKey: string;
  subjectType: string | undefined;
  q: string | undefined;
  cursor: string | undefined;
  onCursorChange: (cursor: string | null) => void;
  onOpen: (s: PersistedSubject) => void;
  activeDetail: string | null;
}) {
  const list = useQuery({
    queryKey: ["subjects", wsKey, stageKey, subjectType ?? null, q ?? null, cursor ?? null],
    queryFn: () =>
      api.listSubjects(wsKey, stageKey, {
        subjectType,
        q,
        limit: PAGE_SIZE,
        cursor,
      }),
    placeholderData: (prev) => prev,
  });

  if (list.isLoading) return <div className="p-4 text-slate-500 text-sm">Loading…</div>;
  if (list.error)
    return <div className="p-4 text-sm text-red-600">{(list.error as Error).message}</div>;
  const items = list.data?.items ?? [];
  if (items.length === 0)
    return (
      <div className="p-4 text-slate-500 text-sm">
        No subjects yet for this stage. They appear after the resolver sees a `/sdk/resolve` call.
      </div>
    );

  return (
    <div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
          <tr>
            <th className="text-left px-4 py-2 font-medium">Type</th>
            <th className="text-left px-4 py-2 font-medium">Id</th>
            <th className="text-left px-4 py-2 font-medium">Name</th>
            <th className="text-left px-4 py-2 font-medium">Last seen</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {items.map((s) => {
            const key = `${s.subjectType}:${s.subjectId}`;
            return (
              <tr
                key={s.id}
                onClick={() => onOpen(s)}
                className={
                  "cursor-pointer hover:bg-slate-50 " + (key === activeDetail ? "bg-slate-50" : "")
                }
              >
                <td className="px-4 py-2">
                  <Pill>{s.subjectType}</Pill>
                </td>
                <td className="px-4 py-2">
                  <CodeChip>{s.subjectId}</CodeChip>
                </td>
                <td className="px-4 py-2 text-slate-700">
                  {s.name ?? <em className="text-slate-400">—</em>}
                </td>
                <td className="px-4 py-2 text-slate-500 text-xs">{formatRelative(s.lastSeenAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-200">
        {cursor && (
          <Button variant="secondary" onClick={() => onCursorChange(null)}>
            ← First page
          </Button>
        )}
        {list.data?.nextCursor && (
          <Button variant="secondary" onClick={() => onCursorChange(list.data!.nextCursor!)}>
            Next page →
          </Button>
        )}
      </div>
    </div>
  );
}

function SubjectDrawer({
  wsKey,
  stageKey,
  subjectType,
  subjectId,
  onClose,
}: {
  wsKey: string;
  stageKey: string;
  subjectType: string;
  subjectId: string;
  onClose: () => void;
}) {
  const detail = useQuery({
    queryKey: ["subject", wsKey, stageKey, subjectType, subjectId],
    queryFn: () => api.getSubject(wsKey, stageKey, subjectType, subjectId),
  });

  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-30 flex" role="dialog" aria-modal="true">
      <div
        className="flex-1 bg-slate-900/30"
        onClick={onClose}
        aria-label="Close drawer backdrop"
      />
      <aside className="w-full max-w-md bg-white shadow-xl border-l border-slate-200 overflow-y-auto">
        <header className="px-5 py-4 border-b border-slate-200 flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Subject</div>
            <div className="mt-1 flex items-center gap-2">
              <Pill>{subjectType}</Pill>
              <CodeChip>{subjectId}</CodeChip>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <div className="px-5 py-4 space-y-4">
          {detail.isLoading && <div className="text-slate-500 text-sm">Loading…</div>}
          {detail.error && (
            <div className="text-sm text-red-600">{(detail.error as Error).message}</div>
          )}
          {detail.data && (
            <>
              <Section label="Name">
                <span className="text-sm text-slate-900">
                  {detail.data.name ?? <em className="text-slate-400">—</em>}
                </span>
              </Section>
              <Section label="First seen">
                <span className="text-sm text-slate-700">
                  {formatAbsolute(detail.data.firstSeenAt)}
                </span>
              </Section>
              <Section label="Last seen">
                <span className="text-sm text-slate-700">
                  {formatAbsolute(detail.data.lastSeenAt)}{" "}
                  <span className="text-slate-400">({formatRelative(detail.data.lastSeenAt)})</span>
                </span>
              </Section>
              <Section label="Last seen via">
                <span className="text-sm text-slate-700">
                  {detail.data.lastSeenVia ?? <em className="text-slate-400">—</em>}
                </span>
              </Section>
              <Section label="Attributes">
                {Object.keys(detail.data.attributes).length === 0 ? (
                  <span className="text-sm text-slate-400 italic">none</span>
                ) : (
                  <pre className="text-xs bg-slate-50 border border-slate-200 rounded p-3 overflow-auto">
                    {JSON.stringify(detail.data.attributes, null, 2)}
                  </pre>
                )}
              </Section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">{label}</div>
      {children}
    </div>
  );
}

function formatAbsolute(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
