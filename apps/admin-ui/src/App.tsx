import { Navigate, Route, Routes } from "react-router-dom";
import { Login } from "./pages/Login.js";
import { Workspaces } from "./pages/Workspaces.js";
import { WorkspaceHome } from "./pages/WorkspaceHome.js";
import { NewFlag } from "./pages/NewFlag.js";
import { FlagDetail } from "./pages/FlagDetail.js";
import { Audiences } from "./pages/Audiences.js";
import { AudienceDetail } from "./pages/AudienceDetail.js";
import { Subjects } from "./pages/Subjects.js";
import { SubjectTypes } from "./pages/SubjectTypes.js";
import { RequireAuth } from "./auth.js";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/workspaces" replace />} />
      <Route path="/login" element={<Login />} />
      <Route
        path="/workspaces"
        element={
          <RequireAuth>
            <Workspaces />
          </RequireAuth>
        }
      />
      <Route
        path="/workspaces/:wsKey"
        element={
          <RequireAuth>
            <WorkspaceHome />
          </RequireAuth>
        }
      />
      <Route
        path="/workspaces/:wsKey/flags/new"
        element={
          <RequireAuth>
            <NewFlag />
          </RequireAuth>
        }
      />
      <Route
        path="/workspaces/:wsKey/flags/:flagKey"
        element={
          <RequireAuth>
            <FlagDetail />
          </RequireAuth>
        }
      />
      <Route
        path="/workspaces/:wsKey/subject-types"
        element={
          <RequireAuth>
            <SubjectTypes />
          </RequireAuth>
        }
      />
      <Route
        path="/workspaces/:wsKey/subjects"
        element={
          <RequireAuth>
            <Subjects />
          </RequireAuth>
        }
      />
      <Route
        path="/workspaces/:wsKey/audiences"
        element={
          <RequireAuth>
            <Audiences />
          </RequireAuth>
        }
      />
      <Route
        path="/workspaces/:wsKey/audiences/:audKey"
        element={
          <RequireAuth>
            <AudienceDetail />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/workspaces" replace />} />
    </Routes>
  );
}
