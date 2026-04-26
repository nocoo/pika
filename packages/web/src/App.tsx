import { Navigate, Route, Routes } from "react-router";
import { RequireAuth } from "./components/auth/RequireAuth";
import { AppShell } from "./components/layout/app-shell";
import { DashboardPage } from "./pages/dashboard/page";
import { SessionsPage } from "./pages/dashboard/sessions/page";

function Placeholder({ title }: { title: string }) {
  return (
    <div className="text-sm text-muted-foreground">
      <h1 className="text-2xl font-semibold text-foreground mb-2">{title}</h1>
      Coming soon.
    </div>
  );
}

export function App() {
  return (
    <RequireAuth>
      <AppShell>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/dashboard/sessions" element={<SessionsPage />} />
          <Route
            path="/dashboard/projects"
            element={<Placeholder title="Projects" />}
          />
          <Route
            path="/dashboard/trash"
            element={<Placeholder title="Trash" />}
          />
          <Route
            path="/dashboard/settings/tags"
            element={<Placeholder title="Tags" />}
          />
          <Route path="*" element={<Placeholder title="Not found" />} />
        </Routes>
      </AppShell>
    </RequireAuth>
  );
}
