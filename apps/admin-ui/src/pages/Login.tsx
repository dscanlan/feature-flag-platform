import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { api } from "../api.js";
import { Button, Card, CardBody, CardHeader, Field, Input } from "../components/ui.js";

export function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const login = useMutation({
    mutationFn: () => api.login(email, password),
    onSuccess: () => navigate("/workspaces"),
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>Sign in</CardHeader>
        <CardBody>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              login.mutate();
            }}
            className="space-y-3"
          >
            <Field label="Email">
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                autoFocus
              />
            </Field>
            <Field label="Password">
              <Input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
              />
            </Field>
            {error && <div className="text-sm text-red-600">{error}</div>}
            <Button type="submit" disabled={login.isPending} className="w-full">
              {login.isPending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
