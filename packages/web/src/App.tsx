import { Navigate, Route, Routes } from "react-router";
import { RequireAuth } from "./components/auth/RequireAuth";
import { AppShell } from "./components/layout/app-shell";
import { DashboardPage } from "./pages/dashboard/page";
import { ProjectsPage } from "./pages/dashboard/projects/page";
import { SearchPage } from "./pages/dashboard/search/page";
import { SessionDetailPage } from "./pages/dashboard/sessions/[id]/page";
import { SessionsPage } from "./pages/dashboard/sessions/page";
import { TagsSettingsPage } from "./pages/dashboard/settings/tags/page";

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
          <Route path="/dashboard/search" element={<SearchPage />} />
          <Route
            path="/dashboard/sessions/:id"
            element={<SessionDetailPage />}
          />
          <Route path="/dashboard/projects" element={<ProjectsPage />} />
          <Route
            path="/dashboard/trash"
            element={<Placeholder title="Trash" />}
          />
          <Route
            path="/dashboard/settings/tags"
            element={<TagsSettingsPage />}
          />
          <Route path="*" element={<Placeholder title="Not found" />} />
        </Routes>
      </AppShell>
    </RequireAuth>
  );
}
