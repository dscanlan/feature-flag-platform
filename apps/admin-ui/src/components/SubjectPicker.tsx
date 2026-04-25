import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PersistedSubject } from "@ffp/shared-types";
import { api } from "../api.js";

interface Props {
  wsKey: string;
  stageKey: string;
  /** When set, only subjects of this type are searched. */
  subjectType?: string;
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  /** Optional id used for the input element; helpful when wrapped in a Field. */
  id?: string;
}

const DEBOUNCE_MS = 200;
const MAX_HITS = 8;

/**
 * Combobox that searches the persisted-subjects endpoint as the user types,
 * but always allows free-form id entry — subjects that haven't been seen by
 * the resolver yet must still be addable as pinned subjects / audience
 * members. The value the parent sees is always the raw text in the input.
 */
export function SubjectPicker({
  wsKey,
  stageKey,
  subjectType,
  value,
  onChange,
  placeholder,
  id,
}: Props) {
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounce the typed value before firing search.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value]);

  // Close when the user clicks outside.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const search = useQuery({
    queryKey: ["subject-search", wsKey, stageKey, subjectType ?? null, debounced],
    queryFn: () =>
      api.listSubjects(wsKey, stageKey, {
        subjectType,
        q: debounced || undefined,
        limit: MAX_HITS,
      }),
    enabled: open,
    placeholderData: (prev) => prev,
  });

  const items: PersistedSubject[] = search.data?.items ?? [];
  // Show a hint row if the typed value isn't an exact match for any hit so the
  // user knows pressing Enter / clicking Add will use it as a free-form id.
  const exact = items.some((s) => s.subjectId === value);
  const showFreeform = open && value.length > 0 && !exact;

  return (
    <div ref={containerRef} className="relative">
      <input
        id={id}
        type="text"
        value={value}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full px-3 py-1.5 text-sm rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400"
      />
      {open && (search.isLoading || items.length > 0 || showFreeform) && (
        <ul
          className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-md border border-slate-200 bg-white shadow-lg"
          role="listbox"
        >
          {search.isLoading && <li className="px-3 py-2 text-xs text-slate-500">Searching…</li>}
          {items.map((s) => (
            <li
              key={s.id}
              role="option"
              aria-selected={s.subjectId === value}
              className="px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer flex items-center gap-2"
              onMouseDown={(e) => {
                // mousedown rather than click so we beat the input's blur.
                e.preventDefault();
                onChange(s.subjectId);
                setOpen(false);
              }}
            >
              <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                {s.subjectId}
              </code>
              {s.name && <span className="text-slate-600 text-xs">{s.name}</span>}
              {!subjectType && (
                <span className="ml-auto text-[10px] uppercase text-slate-400">
                  {s.subjectType}
                </span>
              )}
            </li>
          ))}
          {showFreeform && (
            <li
              role="option"
              aria-selected={false}
              className="px-3 py-2 text-xs text-slate-600 border-t border-slate-200 italic"
              onMouseDown={(e) => {
                e.preventDefault();
                setOpen(false);
              }}
            >
              Use “{value}” as a new subject id (not yet seen by the resolver)
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
