import { useEffect, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";

interface Props {
  value: unknown;
  onChange: (next: unknown, error: string | null) => void;
  height?: number;
}

export function JsonValueEditor({ value, onChange, height = 160 }: Props) {
  const initial = useRef(stringify(value));
  const [text, setText] = useState(initial.current);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const next = stringify(value);
    if (next !== text) {
      setText(next);
      initial.current = next;
      setError(null);
    }
  }, [value]);

  const handleMount: OnMount = (_editor, monaco) => {
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      allowComments: false,
      schemaValidation: "error",
    });
  };

  return (
    <div className="border border-slate-300 rounded-md overflow-hidden">
      <Editor
        height={height}
        language="json"
        value={text}
        onMount={handleMount}
        onChange={(next) => {
          const t = next ?? "";
          setText(t);
          if (t.trim() === "") {
            setError("value cannot be empty");
            onChange(undefined, "value cannot be empty");
            return;
          }
          try {
            const parsed = JSON.parse(t);
            setError(null);
            onChange(parsed, null);
          } catch (err) {
            const msg = err instanceof Error ? err.message : "invalid JSON";
            setError(msg);
            onChange(undefined, msg);
          }
        }}
        options={{
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 12,
          lineNumbers: "off",
          folding: false,
          automaticLayout: true,
        }}
      />
      {error && <div className="bg-red-50 text-red-700 text-xs px-2 py-1">{error}</div>}
    </div>
  );
}

function stringify(value: unknown): string {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}
