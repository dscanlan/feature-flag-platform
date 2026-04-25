import { useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@ffp/sdk/client";
import { FlagsProvider, useFlagClient, useFlags } from "@ffp/sdk/react";

const RESOLVER_URL = (import.meta.env.VITE_RESOLVER_URL as string) ?? "http://localhost:8080";
const PUBLIC_KEY = (import.meta.env.VITE_PUBLIC_KEY as string) ?? "pub-replace-me";

const client = createClient({
  baseUrl: RESOLVER_URL,
  publicKey: PUBLIC_KEY,
  subject: { type: "user", id: "user-anon" },
});

function App() {
  const [user, setUser] = useState("user-anon");
  const flags = useFlags();
  const flagClient = useFlagClient();

  const handleUserChange = (next: string): void => {
    setUser(next);
    void flagClient.setSubject({ type: "user", id: next });
  };

  if (flags.loading) return <p>loading flags…</p>;

  const checkout = flags.boolFlag("new-checkout", false);
  return (
    <main style={{ fontFamily: "sans-serif", padding: 24 }}>
      <h1>FFP demo</h1>
      <label>
        user id: <input value={user} onChange={(e) => handleUserChange(e.target.value)} />
      </label>
      <p>new-checkout: {checkout ? "on" : "off"}</p>
      <pre>{JSON.stringify(flags.allFlags(), null, 2)}</pre>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <FlagsProvider client={client}>
    <App />
  </FlagsProvider>,
);
