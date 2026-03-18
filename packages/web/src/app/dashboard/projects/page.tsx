"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ProjectFilters,
  type MinSessionsValue,
  type ScopeFilter,
} from "@/components/projects/project-filters";
import { parseProjectDisplay } from "@/lib/format";
import {
  useReactTable,
  getCoreRowModel,
  type SortingState,
} from "@tanstack/react-table";
import {
  FolderKanban,
  MessageSquare,
  Layers,
  Coins,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { StatGrid, StatCard } from "@/components/dashboard/stat-card";
import { ProjectSidebar } from "@/components/projects/project-sidebar";
import { ProjectDetailPanel } from "@/components/projects/project-detail-panel";
import { ProjectRankingChart } from "@/components/projects/project-ranking-chart";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { getSessionColumns } from "@/components/sessions/session-columns";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTokens } from "@/lib/utils";
import type { SessionCardData } from "@/components/sessions/session-card";
import type { SessionSort, SessionListResponse } from "@/lib/sessions";
import type {
  ProjectItem,
  ProjectOverview,
  ProjectSourceCount,
} from "@/lib/projects";

// ── Sort mapping ─────────────────────────────────────────────

const COLUMN_TO_SORT: Record<string, SessionSort> = {
  total_messages: "total_messages",
  total_input_tokens: "total_input_tokens",
  duration_seconds: "duration_seconds",
  last_message_at: "last_message_at",
  started_at: "started_at",
};

const SORT_TO_COLUMN: Record<SessionSort, string> = {
  total_messages: "total_messages",
  total_input_tokens: "total_input_tokens",
  duration_seconds: "duration_seconds",
  last_message_at: "last_message_at",
  started_at: "started_at",
};

// ── Page component ───────────────────────────────────────────

export default function ProjectsPage() {
  // Project list state
  const [overview, setOverview] = useState<ProjectOverview | null>(null);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [sourceDistribution, setSourceDistribution] = useState<
    Record<string, ProjectSourceCount[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [minSessions, setMinSessions] = useState<MinSessionsValue>(10);
  const [scope, setScope] = useState<ScopeFilter>("");

  // Selection state
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Session drill-down state
  const [sessions, setSessions] = useState<SessionCardData[]>([]);
  const [sessionsTotalCount, setSessionsTotalCount] = useState(0);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionsPage, setSessionsPage] = useState(1);
  const [sessionsPageSize, setSessionsPageSize] = useState(25);
  const [sessionsSort, setSessionsSort] = useState<SessionSort>("last_message_at");

  // Star state (optimistic)
  const [starredMap, setStarredMap] = useState<Map<string, boolean>>(new Map());

  // Overview collapsible
  const [overviewOpen, setOverviewOpen] = useState(true);

  // ── Fetch projects ─────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function fetchProjects() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/projects");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setOverview(data.overview);
          setProjects(data.projects);
          setSourceDistribution(data.sourceDistribution);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load projects");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchProjects();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Handle project card click ──────────────────────────────

  const handleProjectClick = useCallback(
    (key: string) => {
      if (selectedKey === key) {
        setSelectedKey(null);
        setSessions([]);
        setSessionsTotalCount(0);
      } else {
        setSelectedKey(key);
        setSessionsPage(1);
        setSessionsSort("last_message_at");
      }
    },
    [selectedKey],
  );

  // ── Fetch sessions for selected project ────────────────────

  const buildSessionsUrl = useCallback(() => {
    if (!selectedKey) return null;
    const params = new URLSearchParams();
    params.set("projectKey", selectedKey);
    params.set("sort", sessionsSort);
    params.set("page", String(sessionsPage));
    params.set("limit", String(sessionsPageSize));
    return `/api/sessions?${params.toString()}`;
  }, [selectedKey, sessionsSort, sessionsPage, sessionsPageSize]);

  const fetchSessions = useCallback(async () => {
    const url = buildSessionsUrl();
    if (!url) return;

    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SessionListResponse = await res.json();
      setSessions(data.sessions as unknown as SessionCardData[]);
      setSessionsTotalCount(data.totalCount ?? 0);
    } catch (err) {
      setSessionsError(
        err instanceof Error ? err.message : "Failed to load sessions",
      );
    } finally {
      setSessionsLoading(false);
    }
  }, [buildSessionsUrl]);

  useEffect(() => {
    if (selectedKey) {
      fetchSessions();
    }
  }, [selectedKey, fetchSessions]);

  // ── Star toggle ────────────────────────────────────────────

  const handleToggleStar = useCallback(
    async (sessionId: string, newStarred: boolean) => {
      setStarredMap((prev) => new Map(prev).set(sessionId, newStarred));

      try {
        const res = await fetch(`/api/sessions/${sessionId}/star`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ starred: newStarred }),
        });
        if (!res.ok) {
          setStarredMap((prev) => new Map(prev).set(sessionId, !newStarred));
        }
      } catch {
        setStarredMap((prev) => new Map(prev).set(sessionId, !newStarred));
      }
    },
    [],
  );

  // ── Filtered projects ─────────────────────────────────────────

  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      if (p.session_count < minSessions) return false;
      if (scope) {
        const parsed = parseProjectDisplay(p.project_name);
        if (parsed.scope !== scope) return false;
      }
      return true;
    });
  }, [projects, minSessions, scope]);

  const filteredOverview = useMemo<ProjectOverview | null>(() => {
    if (!overview) return null;
    return filteredProjects.reduce<ProjectOverview>(
      (acc, p) => ({
        totalProjects: acc.totalProjects + 1,
        totalSessions: acc.totalSessions + p.session_count,
        totalMessages: acc.totalMessages + p.total_messages,
        totalInputTokens: acc.totalInputTokens + p.total_input_tokens,
        totalOutputTokens: acc.totalOutputTokens + p.total_output_tokens,
      }),
      {
        totalProjects: 0,
        totalSessions: 0,
        totalMessages: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
      },
    );
  }, [overview, filteredProjects]);

  const filteredSourceDistribution = useMemo(() => {
    const keys = new Set(filteredProjects.map((p) => p.project_key));
    const result: Record<string, ProjectSourceCount[]> = {};
    for (const [key, value] of Object.entries(sourceDistribution)) {
      if (keys.has(key)) result[key] = value;
    }
    return result;
  }, [filteredProjects, sourceDistribution]);

  // Auto-deselect when selected project is filtered out
  useEffect(() => {
    if (
      selectedKey &&
      !filteredProjects.some((p) => p.project_key === selectedKey)
    ) {
      setSelectedKey(null);
      setSessions([]);
      setSessionsTotalCount(0);
    }
  }, [filteredProjects, selectedKey]);

  // ── Sessions table setup ───────────────────────────────────

  const columns = useMemo(
    () => getSessionColumns(starredMap, handleToggleStar),
    [starredMap, handleToggleStar],
  );

  const sorting: SortingState = useMemo(() => {
    const columnId = SORT_TO_COLUMN[sessionsSort];
    return columnId ? [{ id: columnId, desc: true }] : [];
  }, [sessionsSort]);

  const onSortingChange = useCallback(
    (updaterOrValue: SortingState | ((old: SortingState) => SortingState)) => {
      const newSorting =
        typeof updaterOrValue === "function"
          ? updaterOrValue(sorting)
          : updaterOrValue;

      if (newSorting.length > 0) {
        const apiSort = COLUMN_TO_SORT[newSorting[0]!.id];
        if (apiSort) {
          setSessionsSort(apiSort);
          setSessionsPage(1);
        }
      }
    },
    [sorting],
  );

  const table = useReactTable({
    data: sessions,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    state: { sorting },
    onSortingChange,
    enableSortingRemoval: false,
    getRowId: (row) => row.id,
  });

  // ── Selected project name for header ───────────────────────

  const selectedProject = filteredProjects.find((p) => p.project_key === selectedKey);

  const handleClose = useCallback(() => {
    setSelectedKey(null);
    setSessions([]);
    setSessionsTotalCount(0);
  }, []);

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight font-display">
          Projects
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Explore your coding projects and their session activity
        </p>
      </div>

      {/* Error state */}
      {error && (
        <div className="text-sm text-destructive py-4">{error}</div>
      )}

      {/* Filters */}
      {!loading && projects.length > 0 && (
        <ProjectFilters
          minSessions={minSessions}
          scope={scope}
          onMinSessionsChange={setMinSessions}
          onScopeChange={setScope}
        />
      )}

      {/* Main body: left/right split */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-10">
        {/* Left: Project list */}
        <div className="lg:col-span-3">
          {loading ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-[96px] rounded-xl" />
              ))}
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-12">
              {projects.length === 0
                ? "No projects found. Sessions will appear here once they have a project reference."
                : "No projects match the current filters."}
            </div>
          ) : (
            <ProjectSidebar
              projects={filteredProjects}
              sourceDistribution={filteredSourceDistribution}
              selectedKey={selectedKey}
              onProjectClick={handleProjectClick}
            />
          )}
        </div>

        {/* Right: Overview + Detail */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          {/* Collapsible overview */}
          {!loading && (
            <Collapsible open={overviewOpen} onOpenChange={setOverviewOpen}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronRight
                    className={cn(
                      "h-4 w-4 transition-transform",
                      overviewOpen && "rotate-90",
                    )}
                  />
                  Overview
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="flex flex-col gap-4 pt-3">
                  {filteredOverview && (
                    <StatGrid className="lg:grid-cols-2 xl:grid-cols-4">
                      <StatCard
                        label="Total Projects"
                        value={filteredOverview.totalProjects.toLocaleString()}
                        icon={<FolderKanban className="h-4 w-4" />}
                      />
                      <StatCard
                        label="Total Sessions"
                        value={filteredOverview.totalSessions.toLocaleString()}
                        icon={<Layers className="h-4 w-4" />}
                      />
                      <StatCard
                        label="Total Tokens"
                        value={formatTokens(
                          filteredOverview.totalInputTokens +
                            filteredOverview.totalOutputTokens,
                        )}
                        icon={<Coins className="h-4 w-4" />}
                      />
                      <StatCard
                        label="Total Messages"
                        value={filteredOverview.totalMessages.toLocaleString()}
                        icon={<MessageSquare className="h-4 w-4" />}
                      />
                    </StatGrid>
                  )}
                  <ProjectRankingChart projects={filteredProjects} />
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {loading && (
            <div className="flex flex-col gap-4">
              <StatGrid className="lg:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-[88px] rounded-xl" />
                ))}
              </StatGrid>
              <Skeleton className="h-[380px] rounded-xl" />
            </div>
          )}

          {/* Detail area */}
          <ProjectDetailPanel
            selectedKey={selectedKey}
            selectedProject={selectedProject}
            sessionsError={sessionsError}
            sessionsLoading={sessionsLoading}
            table={table}
            columns={columns}
            sessionsPage={sessionsPage}
            sessionsPageSize={sessionsPageSize}
            sessionsTotalCount={sessionsTotalCount}
            onPageChange={setSessionsPage}
            onPageSizeChange={setSessionsPageSize}
            onClose={handleClose}
          />
        </div>
      </div>
    </div>
  );
}
