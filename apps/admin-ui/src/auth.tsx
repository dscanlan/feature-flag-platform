import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api } from "./api.js";

type Status = "checking" | "authed" | "anon";

export function useAuthStatus(): Status {
  const [status, setStatus] = useState<Status>("checking");
  useEffect(() => {
    let active = true;
    api
      .me()
      .then(() => active && setStatus("authed"))
      .catch(() => active && setStatus("anon"));
    return () => {
      active = false;
    };
  }, []);
  return status;
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const status = useAuthStatus();
  const loc = useLocation();
  if (status === "checking") {
    return <div className="p-8 text-slate-500">Checking session…</div>;
  }
  if (status === "anon") {
    return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  }
  return <>{children}</>;
}
